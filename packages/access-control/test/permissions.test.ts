import { describe, expect, it } from "vitest";

import {
  canAssignReviewers,
  canConfigureCycle,
  canCreateCycle,
  canDecidePlacement,
  canImportApplications,
  canReadApplicantIdentity,
  canReadCandidacy,
  canReadPeerReview,
  canReadReview,
  canReopenReview,
  canSubmitReview,
  canUpdateCandidacy,
  canUpdateReview,
} from "../src/permissions.ts";
import type { Membership, RecruitmentUser } from "../src/types.ts";

const CYCLE = "cycle-1";
const TECH = "committee-tech";
const DESIGN = "committee-design";

function makeUser(
  id: string,
  memberships: Membership[],
  overrides: {
    role?: RecruitmentUser["role"];
    unblindedCandidacyIds?: string[];
    blindReviewEnabled?: boolean;
  } = {},
): RecruitmentUser {
  return {
    id,
    role: overrides.role ?? "user",
    recruitment: {
      cycleId: CYCLE,
      memberships,
      ...(overrides.unblindedCandidacyIds !== undefined && {
        unblindedCandidacyIds: overrides.unblindedCandidacyIds,
      }),
      ...(overrides.blindReviewEnabled !== undefined && {
        blindReviewEnabled: overrides.blindReviewEnabled,
      }),
    },
  };
}

const guest = makeUser("", [], { role: "guest" });
const outsider = makeUser("outsider", []);
const globalAdmin = makeUser("globaladmin", [], { role: "admin" });
const reviewer = makeUser("alice", [{ role: "reviewer", committeeId: TECH }]);
const techLead = makeUser("lead", [{ role: "committee_lead", committeeId: TECH }]);
const recruitmentAdmin = makeUser("radmin", [{ role: "recruitment_admin", committeeId: null }]);

describe("cycle administration", () => {
  it("lets a global admin bootstrap a cycle but not read applicant data", () => {
    expect(canCreateCycle({ user: globalAdmin })).toBe(true);
    expect(canConfigureCycle({ user: globalAdmin })).toBe(true);

    // The separation that matters: bootstrap rights are not data rights.
    expect(canReadApplicantIdentity({ user: globalAdmin, cycleId: CYCLE })).toBe(false);
    expect(canImportApplications({ user: globalAdmin })).toBe(false);
    expect(
      canReadCandidacy({ user: globalAdmin, candidacy: { committeeId: TECH, active: true } }),
    ).toBe(false);
  });

  it("lets a recruitment admin configure and import", () => {
    expect(canConfigureCycle({ user: recruitmentAdmin })).toBe(true);
    expect(canImportApplications({ user: recruitmentAdmin })).toBe(true);
    expect(canDecidePlacement({ user: recruitmentAdmin })).toBe(true);
  });

  it("denies everything to a guest and to a user with no membership", () => {
    for (const user of [guest, outsider]) {
      expect(canConfigureCycle({ user })).toBe(false);
      expect(canImportApplications({ user })).toBe(false);
      expect(canAssignReviewers({ user })).toBe(false);
      expect(canDecidePlacement({ user })).toBe(false);
      expect(canReadCandidacy({ user, candidacy: { committeeId: TECH, active: true } })).toBe(
        false,
      );
      expect(
        canReadReview({ user, review: { reviewerUserId: user.id, candidacyId: "cand-1" } }),
      ).toBe(false);
    }
  });
});

describe("committee scoping", () => {
  it("scopes a committee lead to their own committee", () => {
    expect(
      canReadCandidacy({ user: techLead, candidacy: { committeeId: TECH, active: true } }),
    ).toBe(true);
    expect(
      canReadCandidacy({ user: techLead, candidacy: { committeeId: DESIGN, active: true } }),
    ).toBe(false);
    expect(
      canUpdateCandidacy({ user: techLead, candidacy: { committeeId: DESIGN, active: true } }),
    ).toBe(false);
  });

  it("lets a lead of two committees act on both", () => {
    const twoCommittees = makeUser("lead2", [
      { role: "committee_lead", committeeId: TECH },
      { role: "committee_lead", committeeId: DESIGN },
    ]);

    expect(
      canReadCandidacy({ user: twoCommittees, candidacy: { committeeId: TECH, active: true } }),
    ).toBe(true);
    expect(
      canReadCandidacy({ user: twoCommittees, candidacy: { committeeId: DESIGN, active: true } }),
    ).toBe(true);
  });

  it("gives a recruitment admin every committee", () => {
    for (const committeeId of [TECH, DESIGN]) {
      expect(
        canReadCandidacy({
          user: recruitmentAdmin,
          candidacy: { committeeId, active: true },
        }),
      ).toBe(true);
    }
  });

  it("scopes a reviewer to the committees they were enrolled in", () => {
    expect(
      canReadCandidacy({ user: reviewer, candidacy: { committeeId: TECH, active: true } }),
    ).toBe(true);
    expect(
      canReadCandidacy({ user: reviewer, candidacy: { committeeId: DESIGN, active: true } }),
    ).toBe(false);
  });

  /**
   * CASL ORs its rules, so granting candidacy access once per role would let a
   * user who both leads Tech and reviews for Tech pick up a second, broader
   * rule and stop being constrained by either.
   */
  it("does not widen a lead's scope when they also hold a reviewer membership", () => {
    const leadAndReviewer = makeUser("both", [
      { role: "committee_lead", committeeId: TECH },
      { role: "reviewer", committeeId: TECH },
    ]);

    expect(
      canReadCandidacy({ user: leadAndReviewer, candidacy: { committeeId: TECH, active: true } }),
    ).toBe(true);
    expect(
      canReadCandidacy({
        user: leadAndReviewer,
        candidacy: { committeeId: DESIGN, active: true },
      }),
    ).toBe(false);
  });

  it("gives a cycle-wide reviewer every committee", () => {
    const cycleWide = makeUser("floater", [{ role: "reviewer", committeeId: null }]);

    expect(
      canReadCandidacy({ user: cycleWide, candidacy: { committeeId: DESIGN, active: true } }),
    ).toBe(true);
  });

  it("does not let an ordinary reviewer assign reviewers or decide", () => {
    expect(canAssignReviewers({ user: reviewer })).toBe(false);
    expect(canDecidePlacement({ user: reviewer })).toBe(false);
    expect(canReopenReview({ user: reviewer })).toBe(false);
  });
});

describe("independent review", () => {
  const own = { reviewerUserId: "alice", candidacyId: "cand-1" };
  const peer = { reviewerUserId: "bob", candidacyId: "cand-1" };

  it("lets a reviewer read and submit their own review", () => {
    expect(canReadReview({ user: reviewer, review: own })).toBe(true);
    expect(canSubmitReview({ user: reviewer, review: own })).toBe(true);
  });

  it("hides a peer's review before the reviewer has submitted their own", () => {
    expect(canReadReview({ user: reviewer, review: peer })).toBe(false);
    expect(canReadPeerReview({ user: reviewer, review: peer })).toBe(false);
  });

  it("reveals peer reviews once the reviewer has submitted for that candidacy", () => {
    const submitted = makeUser("alice", [{ role: "reviewer", committeeId: TECH }], {
      unblindedCandidacyIds: ["cand-1"],
    });

    expect(canReadPeerReview({ user: submitted, review: peer })).toBe(true);
  });

  it("unblinds only the candidacy that was submitted, not every candidacy", () => {
    const submitted = makeUser("alice", [{ role: "reviewer", committeeId: TECH }], {
      unblindedCandidacyIds: ["cand-1"],
    });

    expect(
      canReadPeerReview({
        user: submitted,
        review: { reviewerUserId: "bob", candidacyId: "cand-2" },
      }),
    ).toBe(false);
  });

  it("never lets a reviewer submit another reviewer's review", () => {
    expect(canSubmitReview({ user: reviewer, review: peer })).toBe(false);
  });

  it("lets a committee lead and a recruitment admin see peer reviews immediately", () => {
    expect(canReadPeerReview({ user: techLead, review: peer })).toBe(true);
    expect(canReadPeerReview({ user: recruitmentAdmin, review: peer })).toBe(true);
  });

  it("restricts reopening a submitted review to recruitment admins", () => {
    expect(canReopenReview({ user: recruitmentAdmin })).toBe(true);
    expect(canReopenReview({ user: techLead })).toBe(false);
    expect(canReopenReview({ user: reviewer })).toBe(false);
  });
});

describe("blind review", () => {
  it("hides applicant identity from an ordinary reviewer when enabled", () => {
    const blinded = makeUser("alice", [{ role: "reviewer", committeeId: TECH }], {
      blindReviewEnabled: true,
    });

    expect(canReadApplicantIdentity({ user: blinded, cycleId: CYCLE })).toBe(false);
  });

  it("shows applicant identity to an ordinary reviewer when disabled", () => {
    expect(canReadApplicantIdentity({ user: reviewer, cycleId: CYCLE })).toBe(true);
  });

  it("always shows applicant identity to a recruitment admin", () => {
    const blindedAdmin = makeUser("radmin", [{ role: "recruitment_admin", committeeId: null }], {
      blindReviewEnabled: true,
    });

    expect(canReadApplicantIdentity({ user: blindedAdmin, cycleId: CYCLE })).toBe(true);
  });
});

/**
 * A recruitment admin is very often also a reviewer with their own queue - on
 * Fall 2026 the admin carries nineteen assignments. The admin branch of the
 * ability returns early, so anything it does not grant is simply absent, and
 * "submit" was absent: they could open a review, score it, write a rationale,
 * and only then be told they were not allowed to submit it. The work is lost at
 * the one moment it cannot be recovered.
 */
describe("an admin who also reviews", () => {
  const adminReviewer = makeUser("radmin", [
    { role: "recruitment_admin", committeeId: null },
    { role: "reviewer", committeeId: TECH },
  ]);

  it("may submit their own review", () => {
    expect(
      canSubmitReview({
        user: adminReviewer,
        review: { reviewerUserId: "radmin", candidacyId: "candidacy-1" },
      }),
    ).toBe(true);
  });

  it("may still not submit somebody else's", () => {
    expect(
      canSubmitReview({
        user: adminReviewer,
        review: { reviewerUserId: "someone-else", candidacyId: "candidacy-1" },
      }),
    ).toBe(false);
  });

  /** The same hole existed for saving a draft through the ability. */
  it("may update their own review", () => {
    expect(
      canUpdateReview({
        user: adminReviewer,
        review: { reviewerUserId: "radmin", candidacyId: "candidacy-1" },
      }),
    ).toBe(true);
  });

  it("keeps the reopen power that being an admin grants", () => {
    expect(canReopenReview({ user: adminReviewer })).toBe(true);
  });
});
