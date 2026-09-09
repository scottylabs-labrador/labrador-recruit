import type { RecruitmentUser } from "@labrador/access-control";
import { canAssignReviewers } from "@labrador/access-control";
import { assignmentVisibilityWhere } from "@labrador/access-control/visibility";
import { orderQueue, queuePriorityTier } from "@labrador/common/recruitment";
import {
  applicant,
  application,
  applicationAnswer,
  committee,
  committeeCandidacy,
  committeePreference,
  cycleCommittee,
  questionDefinition,
  recruitmentCycle,
  recruitmentMembership,
  review,
  reviewAssignment,
} from "@labrador/db/schema";
import { and, asc, count, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";

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
  /**
   * Whether the applicant answered any of this committee's own questions.
   *
   * Computed from the answers themselves rather than from the form's opt-in
   * checkbox, which the importer never persists. It also asks the more useful
   * question: "is there something here to read", not "did they tick a box".
   */
  hasCommitteeResponse: boolean;
  /**
   * 1-3 for an applicant who both ranked this committee that highly and wrote
   * something for it, 4 for everyone else. Shown in the queue so the order has
   * a visible reason.
   */
  priorityTier: number;
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
   *
   * Ordered by `compareQueueItems` rather than by when the assignment was
   * created. Reviewing is finite and whoever is last may not be read carefully,
   * so the order is a policy decision: applicants who both ranked this
   * committee highly and wrote something for it come first. Both signals are
   * the applicant's own, which is what keeps this ordering rather than scoring.
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

    // Which (application, committee) pairs have something written for that
    // committee. `question_definition.committee_id` scopes a question to a
    // committee and is indexed, so this is one indexed pass rather than a
    // lookup per row. Blank answers are dropped at import, so an applicant who
    // ticked the opt-in and then wrote nothing correctly counts as no response.
    const answered = await db
      .selectDistinct({
        applicationId: applicationAnswer.applicationId,
        committeeId: questionDefinition.committeeId,
      })
      .from(applicationAnswer)
      .innerJoin(
        questionDefinition,
        eq(applicationAnswer.questionDefinitionId, questionDefinition.id),
      )
      .where(
        and(
          inArray(
            applicationAnswer.applicationId,
            rows.map((row) => row.applicationId),
          ),
          isNotNull(questionDefinition.committeeId),
          isNotNull(applicationAnswer.answerText),
        ),
      );

    const answeredKeys = new Set(
      answered.map((row) => `${row.applicationId}:${row.committeeId ?? ""}`),
    );

    const items = rows.map((row) => {
      const hasCommitteeResponse = answeredKeys.has(`${row.applicationId}:${row.committeeId}`);
      const applicantRank = rankBy.get(`${row.applicationId}:${row.committeeId}`) ?? null;

      return {
        assignmentId: row.assignmentId,
        candidacyId: row.candidacyId,
        status: row.status,
        committeeId: row.committeeId,
        committeeName: row.committeeName,
        applicationId: row.applicationId,
        applicantName: blind ? null : row.applicantName,
        year: row.year,
        major: row.major,
        applicantRank,
        hasCommitteeResponse,
        priorityTier: queuePriorityTier({
          applicantRank,
          hasCommitteeResponse,
          candidacyId: row.candidacyId,
        }),
        hasDraft: row.reviewId !== null,
        submitted: row.submittedAt !== null,
      };
    });

    return orderQueue(items);
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

  /**
   * How long a claimed but unsubmitted review is held before anyone else may
   * take it.
   *
   * Without an expiry a reviewer who claims ten applicants and goes quiet
   * stalls all ten indefinitely: they are neither reviewed nor claimable, and
   * the cycle cannot reach its minimum. Two days is long enough to claim
   * something on a Friday and write it on a Sunday, and short enough that a
   * dropped claim does not outlive the cycle.
   *
   * The claim is not deleted when it lapses. It stops counting toward coverage,
   * so the candidacy becomes claimable again - and if the original reviewer
   * comes back and submits, their work still counts.
   */
  CLAIM_EXPIRY_HOURS: 48,

  /**
   * Hands the caller the next applicant they should review, and claims it.
   *
   * This is the whole of work distribution: nobody is allotted a share, so a
   * reviewer who works faster simply claims more and the cycle finishes sooner.
   * "Done" is every candidacy reaching the cycle's minimum, which is what the
   * ordering below drives toward.
   *
   * Selection, among candidacies in committees the caller is enrolled in:
   *
   *   1. never one they already hold an assignment for - enforced by
   *      `review_assignment_candidacy_reviewer_key`, so a second review by the
   *      same person is impossible at the database rather than merely unlikely
   *   2. never one whose submitted plus live claims already meet the minimum,
   *      so the last needed slot is not handed to two people at once
   *   3. fewest reviews first, then the applicant's own ranking, then oldest -
   *      which spends effort where coverage is thinnest
   *
   * `FOR UPDATE SKIP LOCKED` is what makes it safe under concurrency: two
   * reviewers pressing the button in the same instant take different rows
   * rather than fighting over one. The unique index is the backstop - losing
   * that race yields "no work available" rather than a 500.
   */
  claimNextReview: async (
    acUser: RecruitmentUser,
    cycleId: string,
  ): Promise<{ assignmentId: string; candidacyId: string } | null> => {
    if (acUser.recruitment.memberships.length === 0) {
      throw new HttpError(403, "You have no recruitment role in this cycle");
    }

    const committeeIds = acUser.recruitment.memberships
      .map((m) => m.committeeId)
      .filter((id): id is string => id !== null);
    const cycleWide = acUser.recruitment.memberships.some((m) => m.committeeId === null);

    if (!cycleWide && committeeIds.length === 0) {
      return null;
    }

    const staleBefore = new Date(Date.now() - assignmentService.CLAIM_EXPIRY_HOURS * 3_600_000);

    // A cycle-wide reviewer needs no restriction at all; a committee-scoped one
    // gets an explicit id list. Composing this here rather than binding a
    // boolean and an array keeps every parameter a type Postgres can infer.
    const committeeFilter = cycleWide
      ? sql``
      : sql`AND c.committee_id IN (${sql.join(
          committeeIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`;

    /**
     * The applicant's own rank for this committee, or null.
     *
     * Correlated rather than joined: `committee_preference` has at most one row
     * per application and committee, and a join would have to be left-outer to
     * keep unranked candidacies in the running.
     */
    const applicantRank = sql`(
      SELECT cp.rank FROM ${committeePreference} cp
      WHERE cp.application_id = c.application_id AND cp.committee_id = c.committee_id
    )`;

    /**
     * Whether they wrote anything for this committee specifically.
     *
     * `NOT NULL` and nothing more, which is what `listMyQueue` already treats
     * as answered - the two must agree, or the order a reviewer is handed work
     * in would differ from the order the queue shows them.
     */
    const hasCommitteeAnswer = sql`EXISTS (
      SELECT 1 FROM ${applicationAnswer} aa
      JOIN ${questionDefinition} qd ON qd.id = aa.question_definition_id
      WHERE aa.application_id = c.application_id
        AND qd.committee_id = c.committee_id
        AND aa.answer_text IS NOT NULL
    )`;

    return db.transaction(async (tx) => {
      const pickedRows = await tx.execute<{ id: string }>(sql`
        SELECT c.id
        FROM ${committeeCandidacy} c
        JOIN ${application} a ON a.id = c.application_id
        JOIN ${recruitmentCycle} cy ON cy.id = a.cycle_id
        LEFT JOIN ${cycleCommittee} cc
          ON cc.cycle_id = cy.id AND cc.committee_id = c.committee_id
        WHERE a.cycle_id = ${cycleId}
          AND c.active = true
          ${committeeFilter}
          -- Never the same person twice.
          AND NOT EXISTS (
            SELECT 1 FROM ${reviewAssignment} mine
            WHERE mine.candidacy_id = c.id
              AND mine.reviewer_user_id = ${acUser.id}
          )
          -- Coverage: submitted reviews plus claims that have not lapsed.
          AND (
            SELECT count(*) FROM ${reviewAssignment} ra
            WHERE ra.candidacy_id = c.id
              AND ra.status <> 'conflicted'
              AND ra.status <> 'cancelled'
              AND (ra.status = 'submitted' OR ra.updated_at > ${staleBefore})
          ) < COALESCE(cc.minimum_reviews, cy.minimum_reviews)
        ORDER BY
          -- queuePriorityTier, expressed in SQL. Reviewing is finite, so the
          -- order is a policy decision rather than a convenience: someone who
          -- ranked this committee first *and* wrote for it has asked twice,
          -- and is read before someone who ranked it third and wrote nothing.
          --
          -- Tier comes before coverage deliberately. Ordering by fewest
          -- reviews first would round-robin across every tier and hand the
          -- bottom of the list the same attention as the top, which is the
          -- outcome the policy exists to prevent. Coverage is already handled
          -- by the WHERE clause above, which drops anything that has met the
          -- minimum - so this decides who reaches it first, not who reaches it.
          CASE
            WHEN ${hasCommitteeAnswer} AND ${applicantRank} BETWEEN 1 AND 3
              THEN ${applicantRank}
            ELSE 4
          END ASC,
          -- Inside the remainder tier an answer still counts for more than a
          -- rank, matching compareQueueItems.
          (${hasCommitteeAnswer}) DESC,
          ${applicantRank} ASC NULLS LAST,
          c.id ASC
        LIMIT 1
        FOR UPDATE OF c SKIP LOCKED
      `);

      // node-postgres returns a QueryResult; PGlite returns the same shape.
      const picked = pickedRows.rows[0];
      if (!picked) {
        return null;
      }

      const now = new Date();
      const [created] = await tx
        .insert(reviewAssignment)
        .values({
          candidacyId: picked.id,
          reviewerUserId: acUser.id,
          status: "assigned",
          assignedAt: now,
          // The reviewer claimed it themselves; there is no assigning admin.
          createdBy: acUser.id,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({
          target: [reviewAssignment.candidacyId, reviewAssignment.reviewerUserId],
        })
        .returning({ id: reviewAssignment.id });

      // Lost the race to another request between the select and the insert.
      // Reporting "nothing available" is honest: pressing the button again
      // picks up the next one.
      if (!created) {
        return null;
      }

      return { assignmentId: created.id, candidacyId: picked.id };
    });
  },

  /**
   * How much of the cycle still needs reading, for everybody together.
   *
   * Counts only - no applicant identity, no per-candidacy rows - which is why
   * it is safe to show cycle-wide to a reviewer whose read access is scoped to
   * one committee. The alternative the overview screen uses, fetching every
   * committee's aggregates and reducing them in the browser, moves hundreds of
   * candidacy records to derive two integers.
   *
   * "Complete" means a candidacy has met its minimum, counting submitted
   * reviews only: a claim someone is still writing is not coverage yet.
   */
  reviewProgress: async (
    acUser: RecruitmentUser,
    cycleId: string,
  ): Promise<{
    candidacyCount: number;
    completeCount: number;
    remainingCandidacies: number;
    reviewsSubmitted: number;
    reviewsRequired: number;
  }> => {
    if (acUser.recruitment.memberships.length === 0) {
      throw new HttpError(403, "You have no recruitment role in this cycle");
    }

    // Scoped to the cycle's review committee when one is pinned, so the numbers
    // on screen describe the work the reviewer can actually see rather than
    // six committees they will never open.
    const [cycle] = await db
      .select({
        minimumReviews: recruitmentCycle.minimumReviews,
        reviewCommitteeId: recruitmentCycle.reviewCommitteeId,
      })
      .from(recruitmentCycle)
      .where(eq(recruitmentCycle.id, cycleId));

    if (!cycle) {
      throw new HttpError(404, "Cycle not found");
    }

    const pinned = cycle.reviewCommitteeId;
    const committeeFilter = pinned === null ? sql`` : sql`AND c.committee_id = ${pinned}::uuid`;

    const rows = await db.execute<{
      candidacies: number;
      complete: number;
      submitted: number;
      required: number;
    }>(sql`
      WITH scoped AS (
        SELECT
          c.id,
          COALESCE(cc.minimum_reviews, cy.minimum_reviews) AS minimum,
          (SELECT count(*) FROM ${reviewAssignment} ra
            WHERE ra.candidacy_id = c.id AND ra.status = 'submitted') AS submitted
        FROM ${committeeCandidacy} c
        JOIN ${application} a ON a.id = c.application_id
        JOIN ${recruitmentCycle} cy ON cy.id = a.cycle_id
        LEFT JOIN ${cycleCommittee} cc
          ON cc.cycle_id = cy.id AND cc.committee_id = c.committee_id
        WHERE a.cycle_id = ${cycleId} AND c.active = true ${committeeFilter}
      )
      SELECT
        count(*)::int AS candidacies,
        count(*) FILTER (WHERE submitted >= minimum)::int AS complete,
        COALESCE(sum(LEAST(submitted, minimum)), 0)::int AS submitted,
        COALESCE(sum(minimum), 0)::int AS required
      FROM scoped
    `);

    const row = rows.rows[0];
    const candidacyCount = row?.candidacies ?? 0;
    const completeCount = row?.complete ?? 0;

    return {
      candidacyCount,
      completeCount,
      remainingCandidacies: candidacyCount - completeCount,
      reviewsSubmitted: row?.submitted ?? 0,
      reviewsRequired: row?.required ?? 0,
    };
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
