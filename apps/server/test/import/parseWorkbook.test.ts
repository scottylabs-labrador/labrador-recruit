import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Workbook } from "exceljs";
import { describe, expect, it } from "vitest";

import { FALL_2026_MAPPING } from "../../src/lib/import/headerMap.ts";
import { decodeCsv, parseCsv, parseXlsx } from "../../src/lib/import/parseWorkbook.ts";

const FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "fall-2026-sample.xlsx",
);

describe("parseCsv", () => {
  it("keeps commas that sit inside quotes", () => {
    const sheet = parseCsv('a,b\n"one, two",three\n');
    expect(sheet.headers).toEqual(["a", "b"]);
    expect(sheet.rows[0]?.["a"]).toBe("one, two");
    expect(sheet.rows[0]?.["b"]).toBe("three");
  });

  it("keeps newlines that sit inside quotes", () => {
    const sheet = parseCsv('a,b\n"line one\nline two",tail\n');
    expect(sheet.rows).toHaveLength(1);
    expect(sheet.rows[0]?.["a"]).toBe("line one\nline two");
    expect(sheet.rows[0]?.["b"]).toBe("tail");
  });

  it("counts a record with an embedded newline as one spreadsheet row", () => {
    const sheet = parseCsv('a\n"x\ny"\nz\n');
    expect(sheet.rows.map((row) => row.sourceRowNumber)).toEqual([2, 3]);
    expect(sheet.rows[1]?.["a"]).toBe("z");
  });

  it('unescapes doubled "" quotes', () => {
    const sheet = parseCsv('a\n"she said ""hi"" loudly"\n');
    expect(sheet.rows[0]?.["a"]).toBe('she said "hi" loudly');
  });

  it("handles a field that is only an escaped quote", () => {
    const sheet = parseCsv('a,b\n"""",x\n');
    expect(sheet.rows[0]?.["a"]).toBe('"');
    expect(sheet.rows[0]?.["b"]).toBe("x");
  });

  it("accepts CRLF, lone CR, and LF line endings", () => {
    expect(parseCsv("a,b\r\n1,2\r\n").rows).toHaveLength(1);
    expect(parseCsv("a,b\r1,2\r").rows).toHaveLength(1);
    expect(parseCsv("a,b\n1,2\n").rows).toHaveLength(1);
  });

  it("keeps a CRLF that sits inside a quoted answer verbatim", () => {
    const sheet = parseCsv('a\n"line one\r\nline two"\n');
    expect(sheet.rows[0]?.["a"]).toBe("line one\r\nline two");
  });

  it("reads a final record that has no trailing newline", () => {
    const sheet = parseCsv("a,b\n1,2");
    expect(sheet.rows).toHaveLength(1);
    expect(sheet.rows[0]?.["b"]).toBe("2");
  });

  it("reads a final record whose last field is empty", () => {
    const sheet = parseCsv("a,b\n1,");
    expect(sheet.rows[0]?.["a"]).toBe("1");
    expect(sheet.rows[0]?.["b"]).toBeNull();
  });

  it("treats an empty field as unanswered rather than as an empty string", () => {
    const sheet = parseCsv('a,b\n"",x\n');
    expect(sheet.rows[0]?.["a"]).toBeNull();
  });

  it("drops a UTF-8 BOM instead of gluing it to the first header", () => {
    const sheet = parseCsv("\uFEFFTimestamp,Email Address\n1,ada@andrew.cmu.edu\n");
    expect(sheet.headers[0]).toBe("Timestamp");
  });

  it("skips a wholly empty row", () => {
    const sheet = parseCsv("a,b\n1,2\n,\n3,4\n");
    expect(sheet.rows.map((row) => row.sourceRowNumber)).toEqual([2, 4]);
  });

  it("trims header padding but keeps newlines inside a header", () => {
    const sheet = parseCsv('"  Pick your team\n\n*Note [Talent]  ",b\nx,y\n');
    expect(sheet.headers[0]).toBe("Pick your team\n\n*Note [Talent]");
  });

  it("ignores blank and duplicated header columns rather than overwriting", () => {
    const sheet = parseCsv("a,,a\n1,2,3\n");
    expect(sheet.headers).toEqual(["a"]);
    expect(sheet.rows[0]?.["a"]).toBe("1");
  });

  it("returns an empty sheet for empty input", () => {
    const sheet = parseCsv("");
    expect(sheet.headers).toEqual([]);
    expect(sheet.rows).toEqual([]);
  });

  it("does not split on a comma when a naive split would", () => {
    const sheet = parseCsv('name,answer\nAda,"I like a, b, and c"\n');
    expect(Object.keys(sheet.rows[0] ?? {})).toHaveLength(3);
    expect(sheet.rows[0]?.["answer"]).toBe("I like a, b, and c");
  });
});

describe("parseXlsx", () => {
  it("reads the Fall 2026 fixture with all 66 columns", async () => {
    const sheet = await parseXlsx(await readFile(FIXTURE_PATH));
    expect(sheet.sheetName).toBe("Form Responses 1");
    expect(sheet.headers).toHaveLength(66);
    expect(sheet.headers).toEqual(FALL_2026_MAPPING.map((known) => known.header));
  });

  it("numbers data rows from 2, because the header is spreadsheet row 1", async () => {
    const sheet = await parseXlsx(await readFile(FIXTURE_PATH));
    expect(sheet.rows.map((row) => row.sourceRowNumber)).toEqual([
      2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
    ]);
  });

  it("preserves the newlines inside the Foundry grid headers", async () => {
    const sheet = await parseXlsx(await readFile(FIXTURE_PATH));
    const foundryHeader = sheet.headers.find((header) => header.startsWith("Pick your team"));
    expect(foundryHeader).toContain("\n");
  });

  it("keeps the Finance sub-team ranks as numbers", async () => {
    const sheet = await parseXlsx(await readFile(FIXTURE_PATH));
    const header = FALL_2026_MAPPING.find(
      (known) => known.key === "finance_subteam_rank_local_sponsorship",
    )?.header;
    const financeRow = sheet.rows.find((row) => row["Email Address"] === "gia@andrew.cmu.edu");
    expect(header).toBeDefined();
    expect(financeRow?.[header ?? ""]).toBe(1);
  });

  /**
   * The live Fall 2026 export leads with a hand-written `Instructions` tab, so
   * "first worksheet" was the wrong default: it imported cleanly and produced
   * no applicants at all. Nothing errored and no column was reported unmapped,
   * which made it look like a correct import of an empty form.
   */
  it("skips a leading sheet that is not the form responses", async () => {
    const workbook = new Workbook();
    const instructions = workbook.addWorksheet("Instructions");
    instructions.addRow(["How to use this sheet"]);
    instructions.addRow(["Do not edit the Form Responses tab directly."]);

    const responses = workbook.addWorksheet("Form Responses 1");
    responses.addRow(FALL_2026_MAPPING.map((known) => known.header));
    responses.addRow(FALL_2026_MAPPING.map((known) => (known.key === "email" ? "a@b.edu" : null)));

    const buffer = await workbook.xlsx.writeBuffer();
    const sheet = await parseXlsx(Buffer.from(buffer));

    expect(sheet.sheetName).toBe("Form Responses 1");
    expect(sheet.rows).toHaveLength(1);
  });

  it("still honours an explicitly named sheet over the better-matching one", async () => {
    const workbook = new Workbook();
    const notes = workbook.addWorksheet("Notes");
    notes.addRow(["Committee Ranking [Tech]"]);
    notes.addRow(["1st Choice"]);

    const responses = workbook.addWorksheet("Form Responses 1");
    responses.addRow(FALL_2026_MAPPING.map((known) => known.header));

    const buffer = await workbook.xlsx.writeBuffer();
    const sheet = await parseXlsx(Buffer.from(buffer), "Notes");

    expect(sheet.sheetName).toBe("Notes");
  });

  it("accepts an ArrayBuffer as well as a Buffer", async () => {
    const buffer = await readFile(FIXTURE_PATH);
    const arrayBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer;
    const sheet = await parseXlsx(arrayBuffer);
    expect(sheet.rows).toHaveLength(12);
  });

  it("selects a worksheet by name", async () => {
    const sheet = await parseXlsx(await readFile(FIXTURE_PATH), "Form Responses 1");
    expect(sheet.rows).toHaveLength(12);
  });

  it("reports a missing worksheet rather than importing the wrong one", async () => {
    const buffer = await readFile(FIXTURE_PATH);
    await expect(parseXlsx(buffer, "Sheet 9")).rejects.toThrow(/Sheet 9/u);
  });
});

/**
 * A `.csv` is bytes plus a convention, and an admin's spreadsheet program picks
 * the convention for them. Reading everything as UTF-8 corrupted applicant
 * names silently, which is the one thing this system must not do.
 */
describe("decodeCsv", () => {
  const NAME = "Jos\u00e9 M\u00fcller";
  const BODY = `Email Address,Full Name\r\na@andrew.cmu.edu,${NAME}`;

  function nameFrom(bytes: Buffer): string | undefined {
    const sheet = parseCsv(decodeCsv(bytes));
    expect(sheet.headers).toEqual(["Email Address", "Full Name"]);
    const value = sheet.rows[0]?.["Full Name"];
    return typeof value === "string" ? value : undefined;
  }

  /** What Google Sheets exports, and what Excel's "CSV UTF-8" writes. */
  it("reads UTF-8, with or without a byte-order mark", () => {
    const utf8 = Buffer.from(BODY, "utf8");
    expect(nameFrom(utf8)).toBe(NAME);
    expect(nameFrom(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), utf8]))).toBe(NAME);
  });

  /**
   * Excel's plain "Save As -> CSV" on a Windows machine. Decoded as UTF-8 this
   * imported perfectly with every accented character replaced by U+FFFD, so an
   * applicant's name was quietly wrong in the database and nothing on screen
   * said so.
   */
  it("reads Windows-1252 rather than replacing what it cannot decode", () => {
    const bytes = Buffer.from(BODY, "latin1");
    expect(nameFrom(bytes)).toBe(NAME);
    expect(nameFrom(bytes)).not.toContain("\uFFFD");
  });

  /**
   * Excel's "Unicode Text". Decoded as UTF-8 the header row itself became
   * mojibake, so every column read as unrecognised and the preview blamed the
   * form for having been renamed.
   */
  it("reads UTF-16 in either byte order", () => {
    const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(BODY, "utf16le")]);
    expect(nameFrom(le)).toBe(NAME);

    const beBody = Buffer.from(BODY, "utf16le");
    beBody.swap16();
    expect(nameFrom(Buffer.concat([Buffer.from([0xfe, 0xff]), beBody]))).toBe(NAME);
  });

  /** Plain ASCII is valid UTF-8, so the common case takes the first branch. */
  it("reads plain ASCII unchanged", () => {
    const sheet = parseCsv(decodeCsv(Buffer.from("Email Address\r\na@andrew.cmu.edu", "ascii")));
    expect(sheet.rows[0]?.["Email Address"]).toBe("a@andrew.cmu.edu");
  });
});
