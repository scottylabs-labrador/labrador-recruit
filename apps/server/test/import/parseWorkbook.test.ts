import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { FALL_2026_MAPPING } from "../../src/lib/import/headerMap.ts";
import { parseCsv, parseXlsx } from "../../src/lib/import/parseWorkbook.ts";

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
