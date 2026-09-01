import { describe, expect, it } from "vitest";

import { detectMapping, FALL_2026_MAPPING } from "../../src/lib/import/headerMap.ts";

const ALL_HEADERS = FALL_2026_MAPPING.map((known) => known.header);

function headerFor(key: string): string {
  const known = FALL_2026_MAPPING.find((entry) => entry.key === key);
  if (known === undefined) {
    throw new Error(`No declared header for key ${key}`);
  }
  return known.header;
}

describe("FALL_2026_MAPPING", () => {
  it("declares the 66 columns of the Fall 2026 export", () => {
    expect(FALL_2026_MAPPING).toHaveLength(66);
  });

  it("uses a unique stable key and a unique header for every column", () => {
    expect(new Set(FALL_2026_MAPPING.map((known) => known.key)).size).toBe(66);
    expect(new Set(ALL_HEADERS).size).toBe(66);
  });

  it("gives all seven committees a top-level ranking column", () => {
    const ranked = FALL_2026_MAPPING.filter((known) => known.role === "committee_rank").map(
      (known) => known.committeeSlug,
    );
    expect(ranked).toEqual([
      "tech",
      "design",
      "finance",
      "events",
      "outreach",
      "labrador",
      "foundry",
    ]);
  });

  it("gives Outreach a ranking column and no question block", () => {
    const outreachFields = FALL_2026_MAPPING.filter(
      (known) => known.committeeSlug === "outreach" && known.role !== "committee_rank",
    );
    expect(outreachFields).toEqual([]);
  });

  it("ties every committee-specific column to a committee slug", () => {
    const orphans = FALL_2026_MAPPING.filter(
      (known) =>
        (known.role === "opt_in" || known.role === "subteam_rank") &&
        known.committeeSlug === undefined,
    );
    expect(orphans).toEqual([]);
  });
});

describe("detectMapping", () => {
  it("matches the untouched export exactly, with nothing missing or unmapped", () => {
    const mapping = detectMapping([...ALL_HEADERS]);
    expect(mapping.fields).toHaveLength(66);
    expect(mapping.unmappedHeaders).toEqual([]);
    expect(mapping.missingHeaders).toEqual([]);
    expect(mapping.fields.every((field) => field.matchedBy === "exact")).toBe(true);
  });

  it("preserves the sheet's column order", () => {
    const mapping = detectMapping([...ALL_HEADERS]);
    expect(mapping.fields.map((field) => field.header)).toEqual([...ALL_HEADERS]);
  });

  it("still maps a header whose spacing or case an admin edited", () => {
    const headers = ALL_HEADERS.map((header) =>
      header === "Full Name" ? "  full   NAME " : header,
    );
    const mapping = detectMapping(headers);

    const field = mapping.fields.find((entry) => entry.key === "full_name");
    expect(field?.matchedBy).toBe("normalized");
    expect(field?.header).toBe("  full   NAME ");
    expect(mapping.unmappedHeaders).toEqual([]);
    expect(mapping.missingHeaders).toEqual([]);
  });

  it("still maps a Foundry grid header that lost its newlines in transit", () => {
    const original = headerFor("foundry_subteam_rank_talent");
    const rewrapped = original.replaceAll(/\s+/gu, " ");
    const mapping = detectMapping(ALL_HEADERS.map((h) => (h === original ? rewrapped : h)));

    const field = mapping.fields.find((entry) => entry.key === "foundry_subteam_rank_talent");
    expect(field?.matchedBy).toBe("normalized");
    expect(field?.committeeSlug).toBe("foundry");
    expect(field?.subteamKey).toBe("talent");
  });

  it("recognises a committee that did not exist when this code was written", () => {
    const mapping = detectMapping([...ALL_HEADERS, "Committee Ranking [Robotics]"]);
    const field = mapping.fields.find((entry) => entry.key === "committee_rank_robotics");

    expect(field?.matchedBy).toBe("pattern");
    expect(field?.role).toBe("committee_rank");
    expect(field?.committeeSlug).toBe("robotics");
    expect(field?.answerType).toBe("rank");
    expect(mapping.unmappedHeaders).toEqual([]);
  });

  it("recognises a new sub-team inside an existing ranking grid", () => {
    const stem = headerFor("finance_subteam_rank_documentation").replace("[Documentation]", "");
    const mapping = detectMapping([...ALL_HEADERS, `${stem}[Merch + Swag]`]);
    const field = mapping.fields.find((entry) => entry.key === "finance_subteam_rank_merch_swag");

    expect(field?.matchedBy).toBe("pattern");
    expect(field?.role).toBe("subteam_rank");
    expect(field?.committeeSlug).toBe("finance");
    expect(field?.subteamKey).toBe("merch-swag");
  });

  it("reports an unrecognised header instead of throwing", () => {
    const mapping = detectMapping([...ALL_HEADERS, "What is your quest?"]);
    expect(mapping.unmappedHeaders).toEqual(["What is your quest?"]);
    expect(mapping.fields).toHaveLength(66);
  });

  it("reports a missing header instead of throwing", () => {
    const mapping = detectMapping(ALL_HEADERS.filter((header) => header !== "Email Address"));
    expect(mapping.missingHeaders).toEqual(["Email Address"]);
    expect(mapping.unmappedHeaders).toEqual([]);
  });

  it("refuses to let two columns collapse onto one key", () => {
    const mapping = detectMapping(["Full Name", "full name"]);
    expect(mapping.fields).toHaveLength(1);
    expect(mapping.unmappedHeaders).toEqual(["full name"]);
  });

  it("returns every declared header as missing for an unrelated sheet", () => {
    const mapping = detectMapping(["Name", "Score"]);
    expect(mapping.fields).toEqual([]);
    expect(mapping.unmappedHeaders).toEqual(["Name", "Score"]);
    expect(mapping.missingHeaders).toHaveLength(66);
  });
});
