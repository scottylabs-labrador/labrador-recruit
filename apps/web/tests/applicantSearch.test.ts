import { describe, expect, it } from "vitest";

import { foldForSearch, matchesApplicantSearch } from "@/lib/recruitment.ts";

/**
 * Names are typed by applicants, so they arrive in every shape the form
 * allowed. These are real shapes from the Fall 2026 cycle, which is why they
 * are the cases worth pinning: the search that shipped before this found none
 * of them unless you reproduced the punctuation exactly.
 */
function person(
  applicantName: string,
  extra: Partial<Record<"major" | "year" | "email", string>> = {},
) {
  return {
    applicantName,
    major: extra.major ?? "Computer Science",
    year: extra.year ?? "sophomore",
    email: extra.email ?? "someone@andrew.cmu.edu",
  };
}

describe("foldForSearch", () => {
  it("reduces punctuation and spacing to single spaces", () => {
    expect(foldForSearch("Jia Yi, Hu")).toBe("jia yi hu");
    expect(foldForSearch("Kantinant (Casey) Laiprasert")).toBe("kantinant casey laiprasert");
    expect(foldForSearch("Yu-Min  Cho")).toBe("yu min cho");
    expect(foldForSearch("first_year")).toBe("first year");
  });

  /** None in this cycle, but a search that cannot find José by typing Jose
   *  fails silently - the reader concludes the applicant is not there. */
  it("strips diacritics", () => {
    expect(foldForSearch("José Núñez")).toBe("jose nunez");
  });
});

describe("matchesApplicantSearch", () => {
  it("matches a name written surname-first with a comma", () => {
    expect(matchesApplicantSearch(person("Jia Yi, Hu"), "hu jia yi")).toBe(true);
    expect(matchesApplicantSearch(person("Jia Yi, Hu"), "jia yi hu")).toBe(true);
  });

  it("matches a preferred name in parentheses", () => {
    expect(matchesApplicantSearch(person("Kantinant (Casey) Laiprasert"), "casey laiprasert")).toBe(
      true,
    );
  });

  it("matches a hyphenated name typed with a space", () => {
    expect(matchesApplicantSearch(person("Yu-Min Cho"), "yu min")).toBe(true);
    expect(matchesApplicantSearch(person("Yu-Min Cho"), "yumin")).toBe(false);
  });

  it("matches a name stored with a double space", () => {
    expect(matchesApplicantSearch(person("Sam  Mathew"), "sam mathew")).toBe(true);
  });

  it("does not care what order the words are typed in", () => {
    expect(matchesApplicantSearch(person("Sam Mathew"), "mathew sam")).toBe(true);
  });

  it("matches words drawn from different fields", () => {
    const item = person("Yu-Min Cho", { year: "senior", major: "Statistics" });
    expect(matchesApplicantSearch(item, "cho senior")).toBe(true);
    expect(matchesApplicantSearch(item, "cho statistics")).toBe(true);
    expect(matchesApplicantSearch(item, "cho junior")).toBe(false);
  });

  it("matches the year a person would actually type", () => {
    expect(matchesApplicantSearch(person("A B", { year: "first_year" }), "first year")).toBe(true);
  });

  it("matches on email, and on a fragment of one", () => {
    const item = person("A B", { email: "semathew@andrew.cmu.edu" });
    expect(matchesApplicantSearch(item, "semathew")).toBe(true);
    expect(matchesApplicantSearch(item, "SEMATHEW@ANDREW.CMU.EDU")).toBe(true);
  });

  it("requires every word, so extra words narrow rather than widen", () => {
    expect(matchesApplicantSearch(person("Sam Mathew"), "sam nonsense")).toBe(false);
  });

  it("treats an empty or punctuation-only search as no filter", () => {
    expect(matchesApplicantSearch(person("Sam Mathew"), "")).toBe(true);
    expect(matchesApplicantSearch(person("Sam Mathew"), "   ")).toBe(true);
    expect(matchesApplicantSearch(person("Sam Mathew"), "-,()")).toBe(true);
  });

  it("tolerates a null name, major or email rather than throwing", () => {
    const item = { applicantName: null, major: null, year: "senior", email: null };
    expect(matchesApplicantSearch(item, "senior")).toBe(true);
    expect(matchesApplicantSearch(item, "sam")).toBe(false);
  });
});
