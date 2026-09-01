import { AbilityBuilder, createMongoAbility, type MongoAbility } from "@casl/ability";

import type {
  ApplicationSubject,
  CandidacySubject,
  DecisionSubject,
  IdentitySubject,
  RecruitmentAction,
  RecruitmentUser,
  ReviewSubject,
} from "./types.ts";

export type RecruitmentPermission =
  | [RecruitmentAction, ApplicationSubject | "Application"]
  | [RecruitmentAction, IdentitySubject | "Identity"]
  | [RecruitmentAction, CandidacySubject | "Candidacy"]
  | [RecruitmentAction, ReviewSubject | "Assignment"]
  | [RecruitmentAction, ReviewSubject | "Review"]
  | [RecruitmentAction, DecisionSubject | "Decision"]
  | [RecruitmentAction, DecisionSubject | "Placement"]
  | [RecruitmentAction, "Cycle"];

export type RecruitmentAbility = MongoAbility<RecruitmentPermission>;

/**
 * Builds the caller's recruitment permissions for one cycle.
 *
 * Conditions are deliberately expressed over the columns of a single table per
 * subject, so `drizzleWhere` can compile each into SQL:
 *
 * - `Candidacy` conditions reference `committee_candidacy` columns.
 * - `Assignment` and `Review` conditions reference `review_assignment` columns,
 *   because a review's visibility is decided by its assignment. Services join
 *   `review` to `review_assignment` and apply the predicate there.
 *
 * A service that needs both scopes compiles both and combines them with `and()`,
 * rather than trying to express a cross-table rule in one condition.
 */
export function getRecruitmentAbility(user: RecruitmentUser): RecruitmentAbility {
  const { build, can: allow } = new AbilityBuilder<RecruitmentAbility>(createMongoAbility);

  const memberships = user.recruitment.memberships;
  const unblinded = user.recruitment.unblindedCandidacyIds ?? [];

  const isGlobalAdmin = user.role === "admin";
  const isRecruitmentAdmin = memberships.some((m) => m.role === "recruitment_admin");
  const leadCommitteeIds = memberships
    .filter((m) => m.role === "committee_lead" && m.committeeId !== null)
    .map((m) => m.committeeId as string);
  const isReviewer = memberships.some((m) => m.role === "reviewer");

  // A reviewer sees the candidacies of the committees they were enrolled in.
  // Assigning a reviewer outside those committees therefore requires granting
  // the corresponding membership too, which keeps the scope explicit and
  // auditable rather than implied by an assignment row.
  const reviewerCommitteeIds = memberships
    .filter((m) => m.role === "reviewer")
    .map((m) => m.committeeId);
  const hasCycleWideReviewer = reviewerCommitteeIds.includes(null);
  const visibleCommitteeIds = [
    ...new Set([
      ...leadCommitteeIds,
      ...reviewerCommitteeIds.filter((id): id is string => id !== null),
    ]),
  ];

  // A guest has no recruitment standing whatsoever.
  if (user.id === "" || user.role === "guest") {
    return build();
  }

  // Bootstrap only. A global ScottyLabs admin can create a cycle and grant
  // recruitment memberships, but that does not by itself give them access to
  // applicant data: they must grant themselves a membership, which is audited.
  if (isGlobalAdmin) {
    allow("create", "Cycle");
    allow("configure", "Cycle");
  }

  if (isRecruitmentAdmin) {
    allow(["read", "configure", "import"], "Cycle");
    allow("read", "Application");
    allow("readIdentity", "Identity");
    allow(["read", "update"], "Candidacy");
    allow(["read", "assign"], "Assignment");
    // Admins hold aggregate visibility, so peer reviews are never blinded.
    allow(["read", "readPeerReview", "reopen"], "Review");
    allow(["read", "decide"], "Decision");
    allow(["read", "decide"], "Placement");
    return build();
  }

  // Candidacy visibility is granted once, from the union of every committee the
  // caller is enrolled in. Granting it separately per role would let a user who
  // is both a lead and a reviewer pick up an unconditional rule, and CASL ORs
  // rules together, so the narrower one would stop constraining anything.
  if (hasCycleWideReviewer) {
    allow("read", "Candidacy");
  } else if (visibleCommitteeIds.length > 0) {
    allow("read", "Candidacy", { committeeId: { $in: visibleCommitteeIds } });
  }

  if (leadCommitteeIds.length > 0) {
    allow("read", "Cycle");
    allow("read", "Application");
    allow("update", "Candidacy", { committeeId: { $in: leadCommitteeIds } });
    allow(["read", "assign"], "Assignment");
    // A lead inspects disagreement, so they see peer reviews for their
    // committee. The committee scope itself is applied through the Candidacy
    // predicate, which services `and()` alongside this one.
    allow(["read", "readPeerReview"], "Review");
    allow(["read", "decide"], "Decision");
    allow("read", "Placement");
  }

  if (isReviewer || leadCommitteeIds.length > 0) {
    allow("read", "Cycle");
    // Reviewers reach applications only through their own assignments; the
    // assignment predicate below is what actually narrows the rows.
    allow("read", "Application");
    allow("read", "Assignment", { reviewerUserId: user.id });
    allow("update", "Assignment", { reviewerUserId: user.id });

    // A reviewer always sees their own review, draft or submitted.
    allow(["read", "create", "update", "submit"], "Review", { reviewerUserId: user.id });

    // Peer reviews become visible only for candidacies where this reviewer has
    // already submitted. Resolving that set on the server turns an otherwise
    // cross-row rule into an ordinary condition that compiles to SQL.
    if (unblinded.length > 0) {
      allow(["read", "readPeerReview"], "Review", { candidacyId: { $in: unblinded } });
    }
  }

  // Applicant identity is hidden from ordinary reviewers while blind review is
  // on. Leads and admins have already returned or been granted it above.
  if (!user.recruitment.blindReviewEnabled && (isReviewer || leadCommitteeIds.length > 0)) {
    allow("readIdentity", "Identity");
  }

  return build();
}
