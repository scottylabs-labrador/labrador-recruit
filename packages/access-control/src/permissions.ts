import { subject } from "@casl/ability";

import { getRecruitmentAbility } from "./abac.ts";
import type {
  ApplicationSubject,
  CandidacySubject,
  DecisionSubject,
  RecruitmentUser,
  ReviewSubject,
} from "./types.ts";

/**
 * The public permission API. Services call these before mutating, and React
 * components call the very same functions to decide whether to render an
 * affordance, so the browser and the server can never disagree.
 *
 * Row *visibility* is not decided here — that belongs in SQL, via the helpers
 * in `./drizzle.ts`.
 */

interface UserInput {
  user: RecruitmentUser;
}

export function canConfigureCycle({ user }: UserInput): boolean {
  return getRecruitmentAbility(user).can("configure", "Cycle");
}

export function canCreateCycle({ user }: UserInput): boolean {
  return getRecruitmentAbility(user).can("create", "Cycle");
}

export function canImportApplications({ user }: UserInput): boolean {
  return getRecruitmentAbility(user).can("import", "Cycle");
}

export function canReadApplication({
  user,
  application,
}: UserInput & { application: ApplicationSubject }): boolean {
  return getRecruitmentAbility(user).can("read", subject("Application", application));
}

/**
 * Whether the caller may see the applicant's name, email, and links. False for
 * ordinary reviewers while the cycle runs in blind review mode.
 */
export function canReadApplicantIdentity({
  user,
  cycleId,
}: UserInput & { cycleId: string }): boolean {
  return getRecruitmentAbility(user).can("readIdentity", subject("Identity", { cycleId }));
}

export function canReadCandidacy({
  user,
  candidacy,
}: UserInput & { candidacy: CandidacySubject }): boolean {
  return getRecruitmentAbility(user).can("read", subject("Candidacy", candidacy));
}

export function canUpdateCandidacy({
  user,
  candidacy,
}: UserInput & { candidacy: CandidacySubject }): boolean {
  return getRecruitmentAbility(user).can("update", subject("Candidacy", candidacy));
}

export function canAssignReviewers({ user }: UserInput): boolean {
  return getRecruitmentAbility(user).can("assign", "Assignment");
}

export function canReadAssignment({
  user,
  assignment,
}: UserInput & { assignment: ReviewSubject }): boolean {
  return getRecruitmentAbility(user).can("read", subject("Assignment", assignment));
}

/** A reviewer may only act on their own assignment, including declaring a conflict. */
export function canUpdateAssignment({
  user,
  assignment,
}: UserInput & { assignment: ReviewSubject }): boolean {
  return getRecruitmentAbility(user).can("update", subject("Assignment", assignment));
}

export function canReadReview({ user, review }: UserInput & { review: ReviewSubject }): boolean {
  return getRecruitmentAbility(user).can("read", subject("Review", review));
}

/**
 * Whether the caller may read a review that is not their own. This is the
 * anchor of independent review: it is false for a reviewer who has not yet
 * submitted their own review of the same candidacy.
 */
export function canReadPeerReview({
  user,
  review,
}: UserInput & { review: ReviewSubject }): boolean {
  return getRecruitmentAbility(user).can("readPeerReview", subject("Review", review));
}

export function canSubmitReview({ user, review }: UserInput & { review: ReviewSubject }): boolean {
  return getRecruitmentAbility(user).can("submit", subject("Review", review));
}

export function canUpdateReview({ user, review }: UserInput & { review: ReviewSubject }): boolean {
  return getRecruitmentAbility(user).can("update", subject("Review", review));
}

/** Reopening a submitted review is deliberately separate from editing a draft. */
export function canReopenReview({ user }: UserInput): boolean {
  return getRecruitmentAbility(user).can("reopen", "Review");
}

export function canDecideCommittee({
  user,
  decision,
}: UserInput & { decision: DecisionSubject }): boolean {
  return getRecruitmentAbility(user).can("decide", subject("Decision", decision));
}

/** Final placement is a recruitment-admin action; a committee only proposes. */
export function canDecidePlacement({ user }: UserInput): boolean {
  return getRecruitmentAbility(user).can("decide", "Placement");
}
