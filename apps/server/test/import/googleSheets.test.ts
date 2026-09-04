import { describe, expect, it } from "vitest";

import {
  parseServiceAccountKey,
  parseSpreadsheetId,
  toParsedSheet,
} from "../../src/lib/sheets/googleSheets.ts";

describe("parseSpreadsheetId", () => {
  /** What an admin actually has: the link out of their browser. */
  it("takes the id out of a pasted sheet URL", () => {
    expect(
      parseSpreadsheetId(
        "https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBd_BF5B/edit#gid=0",
      ),
    ).toBe("1BxiMVs0XRA5nFMdKvBd_BF5B");
  });

  it("accepts a bare id", () => {
    expect(parseSpreadsheetId("1BxiMVs0XRA5nFMdKvBd_BF5Bbbbbbbbbb")).toBe(
      "1BxiMVs0XRA5nFMdKvBd_BF5Bbbbbbbbbb",
    );
  });

  /**
   * Guessing here would produce a sync that 404s with nothing on screen to say
   * why, so anything that is neither a sheet URL nor an id is refused.
   */
  it("refuses something that is neither", () => {
    expect(parseSpreadsheetId("https://example.com/not-a-sheet")).toBeNull();
    expect(parseSpreadsheetId("short")).toBeNull();
    expect(parseSpreadsheetId("")).toBeNull();
  });
});

describe("parseServiceAccountKey", () => {
  const key = {
    client_email: "recruit@project.iam.gserviceaccount.com",
    private_key: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n",
  };

  /**
   * Pasting the key JSON into an environment variable usually leaves the
   * newlines escaped, which signs nothing and fails with an error about the
   * key's format rather than about how it was pasted.
   */
  it("repairs escaped newlines in the private key", () => {
    const parsed = parseServiceAccountKey(JSON.stringify(key));
    expect(parsed.private_key).toContain("\n");
    expect(parsed.private_key).not.toContain("\\n");
  });

  it("says so when the JSON is not a key", () => {
    expect(() => parseServiceAccountKey("{}")).toThrow(/client_email/u);
    expect(() => parseServiceAccountKey("not json")).toThrow(/valid JSON/u);
  });
});

describe("toParsedSheet", () => {
  const values = [
    ["Email", "Full name", "Year"],
    ["a@andrew.cmu.edu", "Ada", "2028"],
    ["b@andrew.cmu.edu", "Blaise", "2027"],
  ];

  it("reads the header row and the rows under it", () => {
    const sheet = toParsedSheet(values, "Form Responses 1");

    expect(sheet.sheetName).toBe("Form Responses 1");
    expect(sheet.headers).toEqual(["Email", "Full name", "Year"]);
    expect(sheet.rows).toHaveLength(2);
    expect(sheet.rows[0]?.["Full name"]).toBe("Ada");
  });

  /**
   * The header is row 1, so the first applicant is row 2 - the number the
   * person looking at the sheet sees, which is what an error must quote.
   */
  it("numbers rows as the spreadsheet does", () => {
    const sheet = toParsedSheet(values, "s");
    expect(sheet.rows[0]?.sourceRowNumber).toBe(2);
    expect(sheet.rows[1]?.sourceRowNumber).toBe(3);
  });

  /**
   * The Sheets API omits trailing empty cells, so a row is often shorter than
   * the header. Every column must still be present, or a normaliser that reads
   * a missing key would see `undefined` where the sheet shows a blank.
   */
  it("fills cells the API omitted from the end of a row", () => {
    const sheet = toParsedSheet(
      [
        ["Email", "Full name", "Year"],
        ["a@andrew.cmu.edu", "Ada"],
      ],
      "s",
    );

    expect(sheet.rows[0]?.["Year"]).toBe("");
    expect(Object.keys(sheet.rows[0] ?? {})).toContain("Year");
  });

  it("drops blank and duplicate headers, as the workbook parser does", () => {
    const sheet = toParsedSheet(
      [
        ["Email", "", "Email", "Year"],
        ["a@andrew.cmu.edu", "ignored", "duplicate", "2028"],
      ],
      "s",
    );

    expect(sheet.headers).toEqual(["Email", "Year"]);
    expect(sheet.rows[0]?.["Email"]).toBe("a@andrew.cmu.edu");
    expect(sheet.rows[0]?.["Year"]).toBe("2028");
  });

  /** A sheet has trailing blank rows below the data; they are not applicants. */
  it("ignores rows that are entirely empty", () => {
    const sheet = toParsedSheet(
      [["Email", "Full name"], ["a@andrew.cmu.edu", "Ada"], ["", ""], []],
      "s",
    );

    expect(sheet.rows).toHaveLength(1);
  });

  it("reads an empty sheet as no rows rather than failing", () => {
    expect(toParsedSheet([], "s").rows).toEqual([]);
    expect(toParsedSheet([], "s").headers).toEqual([]);
  });
});
