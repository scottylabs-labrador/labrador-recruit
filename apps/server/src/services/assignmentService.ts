import type { RecruitmentUser } from "@labrador/access-control";
import { canAssignReviewers } from "@labrador/access-control";
import { assignmentVisibilityWhere } from "@labrador/access-control/visibility";
import {
  applicant,
  application,
  committee,
  committeeCandidacy,
  committeePreference,
  recruitmentMembership,
  review,
  reviewAssignment,
} from "@labrador/db/schema";
import { and, asc, count, eq, inArray, ne } from "drizzle-orm";

import { db } from "../lib/db.ts";
import { HttpError } from "../middlewares/errorHandler.ts";
import { recordAuditEvent } from "./auditService.ts";

export interface QueueItem {
  assignmentId: string;
  candidacyId: string;
  status: string;
  committeeId: string;
  committeeName: string;
  applicationId: string;
  /** Null while blind review hides applicant identity from this caller. */
  applicantName: string | null;
  year: string;
  major: string | null;
  /** The applicant's own rank for this committee. */
  applicantRank: number | null;
  hasDraft: boolean;
  submitted: boolean;
}

export interface ReviewerWorkload {
  userId: string;
  assigned: number;
  submitted: number;
  conflicted: number;
  outstanding: number;
}

export const assignmentService = {
  /**
   * The caller's own review queue.
   *
   * Starts from `review_assignment` filtered to the caller, so an applicant is
   * only ever reachable through an assignment that exists. Applicant identity is
   * withheld when the cycle runs in blind review mode.
   */
  listMyQueue: async (
    acUser: RecruitmentUser,
    cycleId: string,
    options?: { status?: string; committeeId?: string },
  ): Promise<QueueItem[]> => {
    if (acUser.id === "") {
      throw new HttpError(401);
    }

    const blind = acUser.recruitment.blindReviewEnabled === true;

    const rows = await db
      .select({
        assignmentId: reviewAssignment.id,
        candidacyId: committeeCandidacy.id,
        status: reviewAssignment.status,
        committeeId: committee.id,
        committeeName: committee.name,
        applicationId: application.id,
        applicantName: applicant.fullName,
        year: application.year,
        major: application.major,
        submittedAt: reviewAssignment.submittedAt,
        reviewId: review.id,
      })
      .from(reviewAssignment)
      .innerJoin(committeeCandidacy, eq(reviewAssignment.candidacyId, committeeCandidacy.id))
      .innerJoin(committee, eq(committeeCandidacy.committeeId, committee.id))
      .innerJoin(application, eq(committeeCandidacy.applicationId, application.id))
      .innerJoin(applicant, eq(application.applicantId, applicant.id))
      .leftJoin(review, eq(review.assignmentId, reviewAssignment.id))
      .where(
        and(
          eq(application.cycleId, cycleId),
          eq(reviewAssignment.reviewerUserId, acUser.id),
          ne(reviewAssignment.status, "cancelled"),
          options?.status ? eq(reviewAssignment.status, options.status as never) : undefined,
          options?.committeeId ? eq(committee.id, options.committeeId) : undefined,
        ),
      )
      .orderBy(asc(reviewAssignment.assignedAt));

    if (rows.length === 0) {
      return [];
    }

    const ranks = await db
      .select({
        applicationId: committeePreference.applicationId,
        committeeId: committeePreference.committeeId,
        rank: committeePreference.rank,
      })
      .from(committeePreference)
      .where(
        inArray(
          committeePreference.applicationId,
          rows.map((row) => row.applicationId),
        ),
      );

    const rankBy = new Map(ranks.map((r) => [`${r.applicationId}:${r.committeeId}`, r.rank]));

    return rows.map((row) => ({
      assignmentId: row.assignmentId,
      candidacyId: row.candidacyId,
      status: row.status,
      committeeId: row.committeeId,
      committeeName: row.committeeName,
      applicationId: row.applicationId,
      applicantName: blind ? null : row.applicantName,
      year: row.year,
      major: row.major,
      applicantRank: rankBy.get(`${row.applicationId}:${row.committeeId}`) ?? null,
      hasDraft: row.reviewId !== null,
      submitted: row.submittedAt !== null,
    }));
  },

  /** Assignments on one candidacy, for leads and admins managing coverage. */
  listForCandidacy: async (acUser: RecruitmentUser, candidacyId: string) => {
    const rows = await db
      .select({
        assignmentId: reviewAssignment.id,
        reviewerUserId: reviewAssignment.reviewerUserId,
        status: reviewAssignment.status,
        assignedAt: reviewAssignment.assignedAt,
        submittedAt: reviewAssignment.submittedAt,
      })
      .from(reviewAssignment)
      .innerJoin(committeeCandidacy, eq(reviewAssignment.candidacyId, committeeCandidacy.id))
      .where(
        and(
          eq(reviewAssignment.candidacyId, candidacyId),
          assignmentVisibilityWhere(acUser, reviewAssignment, committeeCandidacy),
        ),
      );

    return rows;
  },

  /**
   * Assigns one reviewer to one candidacy.
   *
   * Refuses a reviewer with no membership in the candidacy's committee: an
   * assignment must never be the thing that grants access, or the permission
   * model stops being inspectable.
   */
  assignReviewer: async (acUser: RecruitmentUser, candidacyId: string, reviewerUserId: string) => {
    if (!canAssignReviewers({ user: acUser })) {
      throw new HttpError(403, "You are not allowed to assign reviewers");
    }

    const [candidacy] = await db
      .select({
        id: committeeCandidacy.id,
        committeeId: committeeCandidacy.committeeId,
        active: committeeCandidacy.active,
        cycleId: application.cycleId,
      })
      .from(committeeCandidacy)
      .innerJoin(application, eq(committeeCandidacy.applicationId, application.id))
      .where(eq(committeeCandidacy.id, candidacyId));

    if (!candidacy) {
      throw new HttpError(404, "Candidacy not found");
    }
    if (!candidacy.active) {
      throw new HttpError(409, "This candidacy is not active");
    }

    const memberships = await db
      .select({ committeeId: recruitmentMembership.committeeId })
      .from(recruitmentMembership)
      .where(
        and(
          eq(recruitmentMembership.cycleId, candidacy.cycleId),
          eq(recruitmentMembership.userId, reviewerUserId),
          eq(recruitmentMembership.active, true),
        ),
      );

    const eligible = memberships.some(
      (m) => m.committeeId === null || m.committeeId === candidacy.committeeId,
    );
    if (!eligible) {
      throw new HttpError(
        422,
        "That reviewer has no membership covering this committee. Grant the membership first.",
      );
    }

    const [existing] = await db
      .select({ id: reviewAssignment.id, status: reviewAssignment.status })
      .from(reviewAssignment)
      .where(
        and(
          eq(reviewAssignment.candidacyId, candidacyId),
          eq(reviewAssignment.reviewerUserId, reviewerUserId),
        ),
      );

    if (existing) {
      throw new HttpError(409, "That reviewer is already assigned to this candidacy");
    }

    const now = new Date();
    const [created] = await db
      .insert(reviewAssignment)
      .values({
        candidacyId,
        reviewerUserId,
        assignedAt: now,
        createdBy: acUser.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await recordAuditEvent({
      cycleId: candidacy.cycleId,
      actorUserId: acUser.id,
      action: "assignment.created",
      entityType: "review_assignment",
      entityId: created?.id ?? null,
      metadata: { candidacyId, reviewerUserId },
    });

    return created;
  },

  /**
   * Cancels an assignment. Cancelling never deletes a submitted review, so
   * rebalancing coverage cannot destroy work a reviewer already did.
   */
  cancelAssignment: async (acUser: RecruitmentUser, assignmentId: string) => {
    if (!canAssignReviewers({ user: acUser })) {
      throw new HttpError(403, "You are not allowed to change assignments");
    }

    const [row] = await db
      .select({
        id: reviewAssignment.id,
        status: reviewAssignment.status,
        candidacyId: reviewAssignment.candidacyId,
        cycleId: application.cycleId,
      })
      .from(reviewAssignment)
      .innerJoin(committeeCandidacy, eq(reviewAssignment.candidacyId, committeeCandidacy.id))
      .innerJoin(application, eq(committeeCandidacy.applicationId, application.id))
      .where(eq(reviewAssignment.id, assignmentId));

    if (!row) {
      throw new HttpError(404, "Assignment not found");
    }
    if (row.status === "submitted") {
      throw new HttpError(409, "A submitted review cannot be unassigned");
    }

    await db
      .update(reviewAssignment)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(reviewAssignment.id, assignmentId));

    await recordAuditEvent({
      cycleId: row.cycleId,
      actorUserId: acUser.id,
      action: "assignment.cancelled",
      entityType: "review_assignment",
      entityId: assignmentId,
      metadata: { candidacyId: row.candidacyId },
    });
  },

  /** Per-reviewer workload, so an admin can rebalance from real numbers. */
  listWorkloads: async (acUser: RecruitmentUser, cycleId: string): Promise<ReviewerWorkload[]> => {
    if (!canAssignReviewers({ user: acUser })) {
      throw new HttpError(403, "You are not allowed to view reviewer workloads");
    }

    const rows = await db
      .select({
        userId: reviewAssignment.reviewerUserId,
        status: reviewAssignment.status,
        total: count(reviewAssignment.id),
      })
      .from(reviewAssignment)
      .innerJoin(committeeCandidacy, eq(reviewAssignment.candidacyId, committeeCandidacy.id))
      .innerJoin(application, eq(committeeCandidacy.applicationId, application.id))
      .where(eq(application.cycleId, cycleId))
      .groupBy(reviewAssignment.reviewerUserId, reviewAssignment.status);

    const byUser = new Map<string, ReviewerWorkload>();
    for (const row of rows) {
      const entry = byUser.get(row.userId) ?? {
        userId: row.userId,
        assigned: 0,
        submitted: 0,
        conflicted: 0,
        outstanding: 0,
      };

      entry.assigned += row.total;
      if (row.status === "submitted") entry.submitted += row.total;
      if (row.status === "conflicted") entry.conflicted += row.total;
      if (row.status === "assigned" || row.status === "in_progress") {
        entry.outstanding += row.total;
      }

      byUser.set(row.userId, entry);
    }

    return [...byUser.values()].sort((a, b) => b.outstanding - a.outstanding);
  },
};
