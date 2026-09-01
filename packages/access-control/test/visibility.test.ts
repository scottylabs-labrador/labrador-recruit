import { committeeCandidacy, reviewAssignment } from "@labrador/db/schema";
import { describe, expect, it } from "vitest";

import type { Membership, RecruitmentUser } from "../src/types.ts";
import {
  assignmentVisibilityWhere,
  candidacyVisibilityWhere,
  reviewVisibilityWhere,
} from "../src/visibility.ts";

const TECH = "committee-tech";

function makeUser(
  id: string,
  memberships: Membership[],
  overrides: { role?: RecruitmentUser["role"]; unblindedCandidacyIds?: string[] } = {},
): RecruitmentUser {
  return {
    id,
    role: overrides.role ?? "user",
    recruitment: {
      cycleId: "cycle-1",
      memberships,
      ...(overrides.unblindedCandidacyIds !== undefined && {
        unblindedCandidacyIds: overrides.unblindedCandidacyIds,
      }),
    },
  };
}

const reviewer = makeUser("alice", [{ role: "reviewer", committeeId: TECH }]);
const techLead = makeUser("lead", [{ role: "committee_lead", committeeId: TECH }]);
const recruitmentAdmin = makeUser("radmin", [{ role: "recruitment_admin", committeeId: null }]);

describe("candidacyVisibilityWhere", () => {
  it("filters a committee lead to their committee", () => {
    expect(candidacyVisibilityWhere(techLead, committeeCandidacy)).toBeDefined();
  });

  it("does not filter a recruitment admin", () => {
    expect(candidacyVisibilityWhere(recruitmentAdmin, committeeCandidacy)).toBeUndefined();
  });

  it("throws for a user with no recruitment standing", () => {
    const outsider = makeUser("nobody", []);
    expect(() => candidacyVisibilityWhere(outsider, committeeCandidacy)).toThrow();
  });
});

describe("reviewVisibilityWhere", () => {
  it("filters a reviewer to their own reviews before they submit", () => {
    expect(reviewVisibilityWhere(reviewer, reviewAssignment, committeeCandidacy)).toBeDefined();
  });

  it("still filters a reviewer after they submit, since peers stay scoped", () => {
    const submitted = makeUser("alice", [{ role: "reviewer", committeeId: TECH }], {
      unblindedCandidacyIds: ["cand-1"],
    });

    expect(reviewVisibilityWhere(submitted, reviewAssignment, committeeCandidacy)).toBeDefined();
  });

  /**
   * The regression this file exists for. A committee lead's `read Review` rule
   * carries no assignment condition, so compiling it alone yields no filter at
   * all. Composing it with the candidacy predicate is what keeps a lead inside
   * their own committee.
   */
  it("filters a committee lead even though their review rule is unconditional", () => {
    expect(reviewVisibilityWhere(techLead, reviewAssignment, committeeCandidacy)).toBeDefined();
  });

  it("does not filter a recruitment admin, who holds full aggregate visibility", () => {
    expect(
      reviewVisibilityWhere(recruitmentAdmin, reviewAssignment, committeeCandidacy),
    ).toBeUndefined();
  });
});

describe("assignmentVisibilityWhere", () => {
  it("filters a reviewer to their own assignments", () => {
    expect(assignmentVisibilityWhere(reviewer, reviewAssignment, committeeCandidacy)).toBeDefined();
  });

  it("filters a committee lead by committee", () => {
    expect(assignmentVisibilityWhere(techLead, reviewAssignment, committeeCandidacy)).toBeDefined();
  });

  it("does not filter a recruitment admin", () => {
    expect(
      assignmentVisibilityWhere(recruitmentAdmin, reviewAssignment, committeeCandidacy),
    ).toBeUndefined();
  });
});
