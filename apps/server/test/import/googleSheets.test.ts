import { generateKeyPairSync } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchSheet,
  parseServiceAccountKey,
  parseSpreadsheetId,
  type ServiceAccountKey,
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

/**
 * Which worksheet a sync reads when the cycle names no explicit range.
 *
 * A real RSA key is generated rather than mocked, so the assertion covers the
 * whole of `fetchSheet` - including the token exchange - and not just the part
 * under test.
 */
describe("fetchSheet worksheet selection", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const key: ServiceAccountKey = {
    client_email: "recruit@project.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };

  /** Headers the Fall 2026 mapping recognises, so a tab can score above zero. */
  const FORM_HEADERS = ["Timestamp", "Email Address", "Full Name", "Year"];

  function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * Answers the three requests `fetchSheet` can make, recording every URL so a
   * test can assert on what was asked as well as what came back.
   */
  function stubGoogle(handlers: {
    titles: string[];
    headerRows?: Record<string, string[]>;
    values?: Record<string, string[][]>;
    batchGetStatus?: number;
  }) {
    const calls: string[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation((input: Parameters<typeof fetch>[0]) => {
      // Every call in this module passes a string; anything else is a change
      // worth failing on rather than stringifying into something unreadable.
      if (typeof input !== "string") {
        throw new TypeError("expected fetch to be called with a URL string");
      }
      const url = input;
      calls.push(url);

      if (url.startsWith("https://oauth2.googleapis.com/token")) {
        return Promise.resolve(json({ access_token: "test-token" }));
      }

      if (url.includes("values:batchGet")) {
        const status = handlers.batchGetStatus ?? 200;
        if (status !== 200) {
          return Promise.resolve(json({ error: "nope" }, status));
        }
        return Promise.resolve(
          json({
            valueRanges: handlers.titles.map((title) => ({
              values: [handlers.headerRows?.[title] ?? []],
            })),
          }),
        );
      }

      if (url.includes("?fields=sheets.properties.title")) {
        return Promise.resolve(
          json({ sheets: handlers.titles.map((title) => ({ properties: { title } })) }),
        );
      }

      // A single-range values read. The range is the last path segment.
      const range = decodeURIComponent(url.slice(url.lastIndexOf("/values/") + "/values/".length));
      return Promise.resolve(json({ values: handlers.values?.[range] ?? [] }));
    });

    return calls;
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * The failure this exists to prevent. The live Fall 2026 export leads with a
   * hand-written `Instructions` tab, so taking the first worksheet staged a
   * preview of zero applicants with no error and nothing on screen to say the
   * wrong tab had been read.
   */
  it("skips a leading Instructions tab for the one holding the form responses", async () => {
    stubGoogle({
      titles: ["Instructions", "Form Responses 1"],
      headerRows: {
        Instructions: ["Tech", "Labrador", "Design"],
        "Form Responses 1": FORM_HEADERS,
      },
      values: {
        "Form Responses 1": [FORM_HEADERS, ["2026-09-01", "a@andrew.cmu.edu", "Ada", "Sophomore"]],
      },
    });

    const sheet = await fetchSheet(key, "sheet-id", null);

    expect(sheet.sheetName).toBe("Form Responses 1");
    expect(sheet.rows).toHaveLength(1);
    expect(sheet.rows[0]?.["Full Name"]).toBe("Ada");
  });

  /** The ordinary case must not have grown a request it does not need. */
  it("asks for no header rows when there is only one worksheet", async () => {
    const calls = stubGoogle({
      titles: ["Form Responses 1"],
      values: { "Form Responses 1": [FORM_HEADERS] },
    });

    const sheet = await fetchSheet(key, "sheet-id", null);

    expect(sheet.sheetName).toBe("Form Responses 1");
    expect(calls.some((url) => url.includes("values:batchGet"))).toBe(false);
  });

  /**
   * A quote in a tab name closes the A1 range early, which would make Google
   * reject the whole batch and silently cost the choice.
   */
  it("doubles an apostrophe in a worksheet name", async () => {
    const calls = stubGoogle({
      titles: ["Reviewers' notes", "Form Responses 1"],
      headerRows: { "Form Responses 1": FORM_HEADERS },
      values: { "Form Responses 1": [FORM_HEADERS] },
    });

    await fetchSheet(key, "sheet-id", null);

    const batch = calls.find((url) => url.includes("values:batchGet")) ?? "";
    expect(decodeURIComponent(batch)).toContain("'Reviewers'' notes'!1:1");
  });

  /** Choosing well is an improvement on choosing first, never a new way to fail. */
  it("falls back to the first worksheet when the header read fails", async () => {
    stubGoogle({
      titles: ["Sheet1", "Sheet2"],
      batchGetStatus: 500,
      values: { Sheet1: [FORM_HEADERS] },
    });

    const sheet = await fetchSheet(key, "sheet-id", null);

    expect(sheet.sheetName).toBe("Sheet1");
  });

  /** A range the admin typed is a deliberate choice and always wins. */
  it("honours an explicit range without inspecting the worksheets", async () => {
    const calls = stubGoogle({
      titles: ["Instructions", "Form Responses 1"],
      values: { "Responses!A:ZZ": [FORM_HEADERS] },
    });

    const sheet = await fetchSheet(key, "sheet-id", "Responses!A:ZZ");

    expect(sheet.sheetName).toBe("Responses!A:ZZ");
    expect(calls.some((url) => url.includes("fields=sheets.properties.title"))).toBe(false);
  });
});
