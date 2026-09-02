import { describe, expect, it } from "vitest";

import { detectMapping, FALL_2026_MAPPING } from "../../src/lib/import/headerMap.ts";
import { normalizeRow } from "../../src/lib/import/normalizeRow.ts";
import type {
  HeaderMapping,
  ImportRowResult,
  RawCell,
  RawRow,
} from "../../src/lib/import/types.ts";

const ALL_HEADERS = FALL_2026_MAPPING.map((known) => known.header);
const MAPPING: HeaderMapping = detectMapping([...ALL_HEADERS]);

function headerFor(key: string): string {
  const known = FALL_2026_MAPPING.find((entry) => entry.key === key);
  if (known === undefined) {
    throw new Error(`No declared header for key ${key}`);
  }
  return known.header;
}

/** Builds a row from stable field keys so a test never repeats a long header. */
function rowFor(byKey: Record<string, RawCell>, sourceRowNumber = 2): RawRow {
  const cells: Record<string, RawCell> = {};
  for (const [key, value] of Object.entries(byKey)) {
    cells[headerFor(key)] = value;
  }
  return { ...cells, sourceRowNumber };
}

const VALID = {
  email: "ada@andrew.cmu.edu",
  full_name: "Ada Testperson",
  year: "First Year",
} as const;

function expectOk(result: ImportRowResult) {
  if (!result.ok) {
    throw new Error(`Expected an ok row, got: ${JSON.stringify(result.errors)}`);
  }
  return result.application;
}

describe("normalizeRow identity", () => {
  it("normalises the email but keeps the raw one for audit", () => {
    const application = expectOk(
      normalizeRow(rowFor({ ...VALID, email: "  ADA@Andrew.CMU.edu " }), MAPPING),
    );
    expect(application.email).toBe("ada@andrew.cmu.edu");
    expect(application.rawEmail).toBe("ADA@Andrew.CMU.edu");
  });

  it("collapses whitespace in the name", () => {
    const application = expectOk(
      normalizeRow(rowFor({ ...VALID, full_name: "Dorian  Placeholder" }), MAPPING),
    );
    expect(application.fullName).toBe("Dorian Placeholder");
  });

  it("keeps the raw year alongside an unrecognised enum value", () => {
    const application = expectOk(normalizeRow(rowFor({ ...VALID, year: "Not sure yet" }), MAPPING));
    expect(application.year).toBe("unknown");
    expect(application.rawYear).toBe("Not sure yet");
  });

  it("carries the source row number through so an error can name the line", () => {
    const application = expectOk(normalizeRow(rowFor(VALID, 57), MAPPING));
    expect(application.sourceRowNumber).toBe(57);
  });
});

describe("normalizeRow validation", () => {
  it("rejects a row with no email, naming the column", () => {
    const result = normalizeRow(rowFor({ full_name: "Bruno Fakename" }), MAPPING);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.column).toBe("Email Address");
    expect(result.errors[0]?.field).toBe("email");
  });

  it("rejects an email that is not shaped like one", () => {
    const result = normalizeRow(rowFor({ ...VALID, email: "ada at andrew" }), MAPPING);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.errors[0]?.value).toBe("ada at andrew");
  });

  it("rejects a row with no name", () => {
    const result = normalizeRow(rowFor({ email: "ada@andrew.cmu.edu" }), MAPPING);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.errors[0]?.field).toBe("full_name");
  });

  it("reports every missing identity column at once", () => {
    const result = normalizeRow(rowFor({ year: "Junior" }), MAPPING);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.errors.map((error) => error.field)).toEqual(["email", "full_name"]);
  });

  it("rejects an unreadable ranking, naming the ranking column", () => {
    const result = normalizeRow(
      rowFor({ ...VALID, committee_rank_tech: "Top pick honestly" }),
      MAPPING,
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.errors[0]?.column).toBe("Committee Ranking [Tech]");
    expect(result.errors[0]?.value).toBe("Top pick honestly");
  });

  it("rejects an out-of-range rank rather than clamping it", () => {
    const result = normalizeRow(rowFor({ ...VALID, committee_rank_tech: "9th Choice" }), MAPPING);
    expect(result.ok).toBe(false);
  });

  it("never throws on a hostile row", () => {
    const hostile: RawRow = {
      ...rowFor({ ...VALID }),
      "Committee Ranking [Tech]": "\u0000\u0000",
      Year: 42,
    };
    expect(() => normalizeRow(hostile, MAPPING)).not.toThrow();
  });

  it("still hashes a rejected row, so a repaired re-upload is detectable", () => {
    const result = normalizeRow(rowFor({ full_name: "Bruno Fakename" }), MAPPING);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.rowHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("treats a blank ranking as unranked rather than as an error", () => {
    const application = expectOk(
      normalizeRow(rowFor({ ...VALID, committee_rank_tech: "  " }), MAPPING),
    );
    expect(application.committeePreferences).toEqual({});
  });
});

describe("normalizeRow preferences", () => {
  it("reads the seven committee rankings as 1..7 with their raw labels", () => {
    const application = expectOk(
      normalizeRow(
        rowFor({
          ...VALID,
          committee_rank_tech: "1st Choice",
          committee_rank_design: "2nd Choice",
          committee_rank_finance: "3rd Choice",
          committee_rank_events: "4th Choice",
          committee_rank_outreach: "5th Choice",
          committee_rank_labrador: "6th Choice",
          committee_rank_foundry: "7th Choice",
        }),
        MAPPING,
      ),
    );

    expect(
      Object.fromEntries(
        Object.entries(application.committeePreferences).map(([slug, pref]) => [slug, pref.rank]),
      ),
    ).toEqual({
      tech: 1,
      design: 2,
      finance: 3,
      events: 4,
      outreach: 5,
      labrador: 6,
      foundry: 7,
    });
    expect(application.committeePreferences["outreach"]?.rawLabel).toBe("5th Choice");
  });

  it("reads the Foundry sub-team labels and the Finance sub-team numbers alike", () => {
    const application = expectOk(
      normalizeRow(
        rowFor({
          ...VALID,
          foundry_subteam_rank_talent: "2nd Choice",
          foundry_subteam_rank_accelerator: "1st Choice",
          finance_subteam_rank_local_sponsorship: 1,
          finance_subteam_rank_documentation: "5",
        }),
        MAPPING,
      ),
    );

    expect(application.subteamPreferences).toEqual([
      { committeeSlug: "foundry", subteamKey: "talent", rank: 2, rawLabel: "2nd Choice" },
      { committeeSlug: "foundry", subteamKey: "accelerator", rank: 1, rawLabel: "1st Choice" },
      { committeeSlug: "finance", subteamKey: "local-sponsorship", rank: 1, rawLabel: "1" },
      { committeeSlug: "finance", subteamKey: "documentation", rank: 5, rawLabel: "5" },
    ]);
  });

  it("records opt-ins, including the Events block's longer refusal", () => {
    const application = expectOk(
      normalizeRow(
        rowFor({
          ...VALID,
          tech_opt_in: "Yes",
          events_opt_in: "No, let me be done",
          design_opt_in: "   ",
        }),
        MAPPING,
      ),
    );

    expect(application.committeeOptIns).toEqual({ tech: true, events: false });
  });
});

describe("normalizeRow answers", () => {
  it("omits blank optional answers instead of storing empty strings", () => {
    const application = expectOk(
      normalizeRow(
        rowFor({ ...VALID, tech_project: "   ", tech_projects_of_interest: "Rust" }),
        MAPPING,
      ),
    );
    expect(application.answers).toEqual([
      { questionKey: "tech_projects_of_interest", answerText: "Rust" },
    ]);
  });

  it("keeps prose verbatim apart from the outer whitespace", () => {
    const application = expectOk(
      normalizeRow(rowFor({ ...VALID, tech_project: "  one\n\n  two  " }), MAPPING),
    );
    expect(application.answers[0]?.answerText).toBe("one\n\n  two");
  });

  it("shape-checks a link and upgrades a bare domain, without resolving it", () => {
    const application = expectOk(
      normalizeRow(rowFor({ ...VALID, labrador_github_link: "github.com/fake-echo" }), MAPPING),
    );
    const answer = application.answers.find((a) => a.questionKey === "labrador_github_link");
    expect(answer?.answerText).toBe("github.com/fake-echo");
    expect(answer?.answerJson).toEqual({ url: "https://github.com/fake-echo" });
  });

  it("keeps a dangerous link as inert text with a null url", () => {
    const application = expectOk(
      normalizeRow(
        rowFor({ ...VALID, design_portfolio_link: "javascript:alert(document.cookie)" }),
        MAPPING,
      ),
    );
    const answer = application.answers.find((a) => a.questionKey === "design_portfolio_link");
    expect(answer?.answerText).toBe("javascript:alert(document.cookie)");
    expect(answer?.answerJson).toEqual({ url: null });
  });

  it("does not treat an identity column as an answer", () => {
    const application = expectOk(
      normalizeRow(rowFor({ ...VALID, ranking_explanation: "Tech first." }), MAPPING),
    );
    expect(application.answers).toEqual([]);
    expect(application.rankingExplanation).toBe("Tech first.");
  });
});

describe("normalizeRow hashing", () => {
  it("is unchanged by a re-upload of the same content at a different position", () => {
    const first = expectOk(normalizeRow(rowFor(VALID, 2), MAPPING));
    const second = expectOk(normalizeRow(rowFor(VALID, 91), MAPPING));
    expect(second.rowHash).toBe(first.rowHash);
  });

  it("changes when an answer changes", () => {
    const before = expectOk(normalizeRow(rowFor({ ...VALID, tech_project: "a" }), MAPPING));
    const after = expectOk(normalizeRow(rowFor({ ...VALID, tech_project: "b" }), MAPPING));
    expect(after.rowHash).not.toBe(before.rowHash);
  });
});

describe("normalizeRow with a degraded mapping", () => {
  it("imports what it can when a committee's questions are absent from the sheet", () => {
    const partial = detectMapping([
      "Email Address",
      "Full Name",
      "Year",
      "Committee Ranking [Outreach]",
    ]);
    const application = expectOk(
      normalizeRow(
        {
          "Email Address": "jules@andrew.cmu.edu",
          "Full Name": "Jules Stand-In",
          Year: "Sophomore",
          "Committee Ranking [Outreach]": "1st Choice",
          sourceRowNumber: 4,
        },
        partial,
      ),
    );

    expect(application.committeePreferences).toEqual({
      outreach: { rank: 1, rawLabel: "1st Choice" },
    });
    expect(application.answers).toEqual([]);
    expect(application.committeeOptIns).toEqual({});
    expect(partial.missingHeaders.length).toBeGreaterThan(0);
  });
});
