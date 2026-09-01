/**
 * Access-control value types.
 *
 * This package imports types from `@labrador/db/schema` but never the database
 * client, so the identical predicates run in the browser and on the server.
 */

import type {
  Application as DatabaseApplication,
  CommitteeCandidacy as DatabaseCandidacy,
  CommitteeDecision as DatabaseDecision,
  ReviewAssignment as DatabaseAssignment,
} from "@labrador/db/schema";

/** The global role derived from Keycloak JWT groups. */
export type Role = "admin" | "user" | "guest";

/** The authenticated caller, as every existing ScottyStack service expects it. */
export type User = { id: string; role: Role };

/** A recruitment role held within one cycle. */
export type RecruitmentRole = "reviewer" | "committee_lead" | "recruitment_admin";

/** One `recruitment_membership` row reduced to what the rules need. */
export interface Membership {
  role: RecruitmentRole;
  /** Null for a cycle-wide membership, which is how admins are represented. */
  committeeId: string | null;
}

/**
 * Everything the ability builder needs beyond the caller's identity.
 *
 * Built per request by the server. Two fields deserve explanation:
 *
 * `unblindedCandidacyIds` carries the candidacies where the caller has already
 * submitted their own review. Reviewer blindness depends on the state of a
 * *different* row, which a plain column comparison cannot express, so the
 * server resolves that set once and the rule then becomes an ordinary `$in`
 * condition that compiles to SQL like any other.
 *
 * `blindReviewEnabled` mirrors the cycle setting and hides applicant identity
 * from ordinary reviewers.
 */
export interface RecruitmentContext {
  cycleId: string | null;
  memberships: Membership[];
  unblindedCandidacyIds?: string[];
  blindReviewEnabled?: boolean;
}

/** The caller together with their recruitment standing in one cycle. */
export interface RecruitmentUser extends User {
  recruitment: RecruitmentContext;
}

export type ApplicationSubject = Pick<DatabaseApplication, "cycleId">;

export type CandidacySubject = Pick<DatabaseCandidacy, "committeeId" | "active">;

/**
 * Reviews and assignments share a subject shape because a review's visibility
 * is decided by its assignment's columns. Services join `review` to
 * `review_assignment` and apply the compiled predicate to the assignment table.
 */
export interface AssignmentSubject {
  reviewerUserId: DatabaseAssignment["reviewerUserId"];
  candidacyId: DatabaseAssignment["candidacyId"];
}

export type ReviewSubject = AssignmentSubject;

export type DecisionSubject = Pick<DatabaseDecision, "candidacyId">;

/** Applicant identity fields, gated separately from the application body. */
export interface IdentitySubject {
  cycleId: string;
}

export type RecruitmentAction =
  | "read"
  | "readIdentity"
  | "readPeerReview"
  | "create"
  | "update"
  | "submit"
  | "reopen"
  | "assign"
  | "decide"
  | "configure"
  | "import"
  | "delete";

export type RecruitmentSubjectName =
  | "Application"
  | "Identity"
  | "Candidacy"
  | "Assignment"
  | "Review"
  | "Decision"
  | "Placement"
  | "Cycle";
