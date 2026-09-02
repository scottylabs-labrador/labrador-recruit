import { describe, expect, it } from "vitest";

import { csvFilename, escapeCsvField, toCsv } from "@/lib/csv.ts";

/**
 * These are direct unit tests rather than assertions about a rendered screen,
 * because the bug they exist to catch — `values.join(",")` — produces a file
 * that opens perfectly well and simply says something different from the data.
 */

interface Row {
  name: string | null;
  note: string | null;
  score: number | null;
  flagged: boolean;
}

const COLUMNS = [
  { header: "Name", value: (row: Row) => row.name },
  { header: "Note", value: (row: Row) => row.note },
  { header: "Score", value: (row: Row) => row.score },
  { header: "Flagged", value: (row: Row) => row.flagged },
];

describe("escapeCsvField", () => {
  it("leaves an ordinary field untouched", () => {
    expect(escapeCsvField("Robin Fixture")).toBe("Robin Fixture");
    expect(escapeCsvField(42)).toBe("42");
    expect(escapeCsvField(0)).toBe("0");
    expect(escapeCsvField(false)).toBe("false");
  });

  it("quotes a field containing a comma", () => {
    expect(escapeCsvField("Fixture, Robin")).toBe('"Fixture, Robin"');
  });

  it("quotes a field containing a double quote and doubles the quote", () => {
    expect(escapeCsvField('He said "yes"')).toBe('"He said ""yes"""');
  });

  it("quotes a field containing a line feed, a carriage return, or both", () => {
    expect(escapeCsvField("first\nsecond")).toBe('"first\nsecond"');
    expect(escapeCsvField("first\rsecond")).toBe('"first\rsecond"');
    expect(escapeCsvField("first\r\nsecond")).toBe('"first\r\nsecond"');
  });

  it("renders null and undefined as an empty field, never as the word", () => {
    expect(escapeCsvField(null)).toBe("");
    expect(escapeCsvField(undefined)).toBe("");
  });

  it("quotes a field that is only a double quote", () => {
    expect(escapeCsvField('"')).toBe('""""');
  });
});

describe("toCsv", () => {
  it("writes a header record and separates records with CRLF", () => {
    const csv = toCsv(COLUMNS, [{ name: "Robin", note: "fine", score: 3.5, flagged: false }]);

    expect(csv).toBe("Name,Note,Score,Flagged\r\nRobin,fine,3.5,false");
  });

  it("does not let a comma in a cell shift the columns", () => {
    const csv = toCsv(COLUMNS, [
      { name: "Fixture, Robin", note: "a, b, c", score: 1, flagged: true },
    ]);

    expect(csv).toBe('Name,Note,Score,Flagged\r\n"Fixture, Robin","a, b, c",1,true');
  });

  it("keeps a newline inside a quoted field rather than splitting the record", () => {
    const csv = toCsv(COLUMNS, [
      { name: "Robin", note: "line one\nline two", score: null, flagged: false },
    ]);

    expect(csv).toBe('Name,Note,Score,Flagged\r\nRobin,"line one\nline two",,false');
    // Exactly two records: the header, and the one row whose newline is quoted.
    expect(csv.split("\r\n")).toHaveLength(2);
  });

  it("escapes quotes by doubling them", () => {
    const csv = toCsv(COLUMNS, [{ name: 'Robin "Rob"', note: null, score: 2, flagged: false }]);

    expect(csv).toBe('Name,Note,Score,Flagged\r\n"Robin ""Rob""",,2,false');
  });

  it("writes an empty field for a missing value", () => {
    const csv = toCsv(COLUMNS, [{ name: null, note: null, score: null, flagged: false }]);

    expect(csv).toBe("Name,Note,Score,Flagged\r\n,,,false");
  });

  it("quotes a header that needs it, and emits only the header for no rows", () => {
    const csv = toCsv([{ header: 'Weird, "header"', value: () => "x" }], []);

    expect(csv).toBe('"Weird, ""header"""');
  });

  it("writes one record per row with no trailing separator", () => {
    const csv = toCsv(COLUMNS, [
      { name: "A", note: null, score: 1, flagged: false },
      { name: "B", note: null, score: 2, flagged: true },
    ]);

    expect(csv.split("\r\n")).toEqual(["Name,Note,Score,Flagged", "A,,1,false", "B,,2,true"]);
    expect(csv.endsWith("\r\n")).toBe(false);
  });
});

describe("csvFilename", () => {
  it("slugifies each part and joins them with hyphens", () => {
    expect(csvFilename("Fall 2026", "Tech", "ranking")).toBe("fall-2026-tech-ranking.csv");
    expect(csvFilename("fall-2026", "reviewer-load")).toBe("fall-2026-reviewer-load.csv");
  });

  it("falls back rather than producing an empty segment", () => {
    expect(csvFilename("???", "decisions")).toBe("export-decisions.csv");
  });
});
