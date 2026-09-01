import { describe, expect, it } from "vitest";

import {
  hashRow,
  isAffirmative,
  normalizeEmail,
  normalizeName,
  normalizeText,
  normalizeUrl,
  normalizeYear,
  parseChoiceRank,
} from "../../src/lib/import/normalize.ts";
import type { RawRow } from "../../src/lib/import/types.ts";

describe("normalizeEmail", () => {
  it("trims and lowercases so a repeat applicant is recognised", () => {
    expect(normalizeEmail("  ADA@Andrew.CMU.edu ")).toBe("ada@andrew.cmu.edu");
  });

  it("returns null for blank cells", () => {
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail("   ")).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
  });

  it.each(["not-an-email", "ada@andrew", "ada @andrew.cmu.edu", "@andrew.cmu.edu", "ada@", "a@b."])(
    "rejects the badly shaped address %j",
    (input) => {
      expect(normalizeEmail(input)).toBeNull();
    },
  );

  it("accepts plus addressing and subdomains", () => {
    expect(normalizeEmail("ada+recruit@cs.andrew.cmu.edu")).toBe("ada+recruit@cs.andrew.cmu.edu");
  });
});

describe("normalizeName", () => {
  it("collapses internal whitespace and trims", () => {
    expect(normalizeName("  Ada   Test person ")).toBe("Ada Test person");
    expect(normalizeName("Ada\n\tLovelace")).toBe("Ada Lovelace");
  });

  it("returns null for blank cells", () => {
    expect(normalizeName("   ")).toBeNull();
    expect(normalizeName(null)).toBeNull();
  });
});

describe("normalizeText", () => {
  it("preserves internal formatting so prose is displayed verbatim", () => {
    expect(normalizeText("  first line\n\nsecond   line  ")).toBe("first line\n\nsecond   line");
  });

  it("returns null rather than an empty string for a blank answer", () => {
    expect(normalizeText("")).toBeNull();
    expect(normalizeText("\n \t ")).toBeNull();
    expect(normalizeText(null)).toBeNull();
  });

  it("stringifies numeric cells", () => {
    expect(normalizeText(5)).toBe("5");
  });
});

describe("parseChoiceRank", () => {
  it.each([
    ["1st Choice", 1],
    ["2nd Choice", 2],
    ["3rd Choice", 3],
    ["4th Choice", 4],
    ["5th Choice", 5],
    ["6th Choice", 6],
    ["7th Choice", 7],
  ])("reads the label %s as %i", (input, expected) => {
    expect(parseChoiceRank(input)).toBe(expected);
  });

  it("is case and whitespace insensitive", () => {
    expect(parseChoiceRank("  3RD   choice ")).toBe(3);
    expect(parseChoiceRank("1ST CHOICE")).toBe(1);
    expect(parseChoiceRank("2 choice")).toBe(2);
  });

  it("accepts the bare numbers the Finance sub-team block exports", () => {
    expect(parseChoiceRank(1)).toBe(1);
    expect(parseChoiceRank(6)).toBe(6);
    expect(parseChoiceRank("4")).toBe(4);
    expect(parseChoiceRank(" 5 ")).toBe(5);
  });

  it.each([0, 8, 99, -1, 1.5, Number.NaN])("rejects the out-of-range number %s", (input) => {
    expect(parseChoiceRank(input)).toBeNull();
  });

  it.each([
    "Top pick honestly",
    "8th Choice",
    "first",
    "choice",
    "1st",
    "",
    "   ",
    "1st Choice or 2nd",
  ])("refuses to coerce %j into a rank", (input) => {
    expect(parseChoiceRank(input)).toBeNull();
  });

  it("returns null for a blank cell", () => {
    expect(parseChoiceRank(null)).toBeNull();
    expect(parseChoiceRank(undefined)).toBeNull();
  });
});

describe("normalizeYear", () => {
  it.each([
    ["First Year", "first_year"],
    ["Sophomore", "sophomore"],
    ["Junior", "junior"],
    ["Senior", "senior"],
    ["Grad", "grad"],
  ] as const)("maps the Fall 2026 option %s", (input, expected) => {
    expect(normalizeYear(input)).toBe(expected);
  });

  it.each([
    ["  first year  ", "first_year"],
    ["freshman", "first_year"],
    ["1st Year", "first_year"],
    ["Second Year", "sophomore"],
    ["graduate student", "grad"],
    ["PhD", "grad"],
  ] as const)("tolerates the variant %j", (input, expected) => {
    expect(normalizeYear(input)).toBe(expected);
  });

  it("falls back to unknown instead of guessing", () => {
    expect(normalizeYear("Not sure yet")).toBe("unknown");
    expect(normalizeYear("")).toBe("unknown");
    expect(normalizeYear(null)).toBe("unknown");
    expect(normalizeYear(2029)).toBe("unknown");
  });
});

describe("normalizeUrl", () => {
  it("keeps a well-formed http(s) link", () => {
    expect(normalizeUrl("https://github.com/fake-person")).toBe("https://github.com/fake-person");
    expect(normalizeUrl("http://example.com/a?b=c#d")).toBe("http://example.com/a?b=c#d");
  });

  it("adds https to a bare domain", () => {
    expect(normalizeUrl("github.com/foo")).toBe("https://github.com/foo");
    expect(normalizeUrl(" figma.com/@fake-iris-faux ")).toBe("https://figma.com/@fake-iris-faux");
    expect(normalizeUrl("//github.com/foo")).toBe("https://github.com/foo");
  });

  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "JAVASCRIPT:alert(document.cookie)",
    "data:text/html;base64,PHNjcmlwdD4=",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "ftp://example.com/x",
    "mailto:ada@andrew.cmu.edu",
  ])("rejects the non-http scheme in %j", (input) => {
    expect(normalizeUrl(input)).toBeNull();
  });

  it("never rescues a rejected scheme by prefixing https", () => {
    // The dangerous failure mode would be turning "javascript:..." into
    // "https://javascript:...", so assert on the exact null rather than falsy.
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
  });

  it("returns null for blanks and for prose", () => {
    expect(normalizeUrl("")).toBeNull();
    expect(normalizeUrl("   ")).toBeNull();
    expect(normalizeUrl(null)).toBeNull();
    expect(normalizeUrl("N/A")).toBeNull();
    expect(normalizeUrl("none yet")).toBeNull();
    expect(normalizeUrl("my site is github.com/foo")).toBeNull();
    expect(normalizeUrl("localhost/foo")).toBeNull();
  });
});

describe("isAffirmative", () => {
  it("reads yes and no", () => {
    expect(isAffirmative("Yes")).toBe(true);
    expect(isAffirmative("  YES ")).toBe(true);
    expect(isAffirmative("No")).toBe(false);
  });

  it("reads the Events block's longer refusal", () => {
    expect(isAffirmative("No, let me be done")).toBe(false);
    expect(isAffirmative("Yes, ask me the questions")).toBe(true);
  });

  it("returns null when the applicant did not say", () => {
    expect(isAffirmative("")).toBeNull();
    expect(isAffirmative(null)).toBeNull();
    expect(isAffirmative("maybe")).toBeNull();
    expect(isAffirmative("nope")).toBeNull();
  });
});

function row(cells: Record<string, string | number | null>, sourceRowNumber = 2): RawRow {
  return { ...cells, sourceRowNumber };
}

describe("hashRow", () => {
  it("is stable for the same content", () => {
    const cells = { "Email Address": "ada@andrew.cmu.edu", Year: "First Year" };
    expect(hashRow(row(cells))).toBe(hashRow(row({ ...cells })));
  });

  it("ignores key order and spreadsheet position", () => {
    const a = row({ "Email Address": "ada@andrew.cmu.edu", Year: "First Year" }, 2);
    const b = row({ Year: "First Year", "Email Address": "ada@andrew.cmu.edu" }, 57);
    expect(hashRow(a)).toBe(hashRow(b));
  });

  it("ignores blank cells and surrounding whitespace", () => {
    const a = row({ "Email Address": "ada@andrew.cmu.edu", Notes: "" });
    const b = row({ "Email Address": "  ada@andrew.cmu.edu  ", Notes: null });
    expect(hashRow(a)).toBe(hashRow(b));
  });

  it("treats a number and its string form as the same value across formats", () => {
    expect(hashRow(row({ Rank: 1 }))).toBe(hashRow(row({ Rank: "1" })));
  });

  it("changes when any answer changes", () => {
    const before = hashRow(row({ "Email Address": "ada@andrew.cmu.edu", Year: "First Year" }));
    const after = hashRow(row({ "Email Address": "ada@andrew.cmu.edu", Year: "Sophomore" }));
    expect(after).not.toBe(before);
  });

  it("changes when a new answer appears", () => {
    const before = hashRow(row({ Year: "First Year" }));
    const after = hashRow(row({ Year: "First Year", Notes: "added later" }));
    expect(after).not.toBe(before);
  });

  it("returns a sha256 hex digest", () => {
    expect(hashRow(row({ Year: "First Year" }))).toMatch(/^[0-9a-f]{64}$/);
  });
});
