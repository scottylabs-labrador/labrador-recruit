import type { Membership, RecruitmentUser } from "@labrador/access-control";
import {
  application,
  committeeCandidacy,
  recruitmentCycle,
  recruitmentMembership,
  reviewAssignment,
} from "@labrador/db/schema";
import { and, eq } from "drizzle-orm";
import type { Request as ExpressRequest } from "express";

import { getAcUserFromRequest } from "./accessControl.ts";
import { db } from "./db.ts";

/**
 * Resolves the caller's recruitment standing within one cycle.
 *
 * Two of the fields cost a query each and are worth explaining.
 *
 * `memberships` is the caller's recruitment roles for this cycle. It is
 * deliberately separate from the global `admin | user | guest` role: holding the
 * ScottyLabs admin group does not grant access to applicant data.
 *
 * `unblindedCandidacyIds` is the set of candidacies where the caller has already
 * submitted their own review. Independent review depends on the state of a
 * different row, which a column comparison cannot express, so resolving the set
 * here turns the rule into an ordinary `IN` that compiles to SQL alongside every
 * other condition. Only submitted assignments count; a draft does not unblind.
 */
export async function getRecruitmentUser(
  req: ExpressRequest,
  cycleId: string | null,
): Promise<RecruitmentUser> {
  const base = await getAcUserFromRequest(req);

  if (!cycleId || base.id === "") {
    return { ...base, recruitment: { cycleId, memberships: [] } };
  }

  const membershipRows = await db
    .select({
      role: recruitmentMembership.role,
      committeeId: recruitmentMembership.committeeId,
    })
    .from(recruitmentMembership)
    .where(
      and(
        eq(recruitmentMembership.cycleId, cycleId),
        eq(recruitmentMembership.userId, base.id),
        eq(recruitmentMembership.active, true),
      ),
    );

  const memberships: Membership[] = membershipRows.map((row) => ({
    role: row.role,
    committeeId: row.committeeId,
  }));

  // Skip the remaining queries for a caller with no standing in this cycle.
  if (memberships.length === 0) {
    return { ...base, recruitment: { cycleId, memberships: [] } };
  }

  const submittedRows = await db
    .select({ candidacyId: reviewAssignment.candidacyId })
    .from(reviewAssignment)
    .where(
      and(eq(reviewAssignment.reviewerUserId, base.id), eq(reviewAssignment.status, "submitted")),
    );

  const [cycle] = await db
    .select({ blindReviewEnabled: recruitmentCycle.blindReviewEnabled })
    .from(recruitmentCycle)
    .where(eq(recruitmentCycle.id, cycleId));

  return {
    ...base,
    recruitment: {
      cycleId,
      memberships,
      unblindedCandidacyIds: submittedRows.map((row) => row.candidacyId),
      blindReviewEnabled: cycle?.blindReviewEnabled ?? false,
    },
  };
}

/**
 * Resolves the cycle a candidacy belongs to, so a request that names only a
 * candidacy can still be evaluated against the caller's standing in its cycle.
 */
/**
 * Resolves the cycle an assignment belongs to. Routes keyed by an assignment
 * still need the caller's standing in that assignment's cycle before any
 * permission can be evaluated.
 */
export async function getCycleIdForAssignment(assignmentId: string): Promise<string | null> {
  const [row] = await db
    .select({ cycleId: application.cycleId })
    .from(reviewAssignment)
    .innerJoin(committeeCandidacy, eq(reviewAssignment.candidacyId, committeeCandidacy.id))
    .innerJoin(application, eq(committeeCandidacy.applicationId, application.id))
    .where(eq(reviewAssignment.id, assignmentId));

  return row?.cycleId ?? null;
}

export async function getCycleIdForApplication(applicationId: string): Promise<string | null> {
  const [row] = await db
    .select({ cycleId: application.cycleId })
    .from(application)
    .where(eq(application.id, applicationId));

  return row?.cycleId ?? null;
}

export async function getCycleIdForCandidacy(candidacyId: string): Promise<string | null> {
  const [row] = await db
    .select({ cycleId: application.cycleId })
    .from(committeeCandidacy)
    .innerJoin(application, eq(committeeCandidacy.applicationId, application.id))
    .where(eq(committeeCandidacy.id, candidacyId));

  return row?.cycleId ?? null;
}
