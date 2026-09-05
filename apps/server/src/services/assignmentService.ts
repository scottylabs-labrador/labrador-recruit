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
  questionDefinition,
  recruitmentMembership,
  review,
  reviewAssignment,
  user,
} from "@labrador/db/schema";
import { and, asc, count, eq, inArray, isNotNull, ne } from "drizzle-orm";

import { db } from "../lib/db.ts";
import { assertCandidacyVisible } from "../lib/recruitmentContext.ts";
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
  /** Who this is, so a lead rebalancing the load reads a name and not a uuid. */
  name: string | null;
  email: string | null;
  assigned: number;
  submitted: number;
  conflicted: number;
  outstanding: number;
}

/** One reviewer the distribution would put on one candidacy. */
export interface PlannedAssignment {
  candidacyId: string;
  applicantName: string | null;
  reviewerUserId: string;
  reviewerName: string | null;
}

export interface DistributionPlan {
  /** Candidacies considered: active, in this committee. */
  candidacyCount: number;
  /** Reviewers whose membership covers this committee. */
  reviewerCount: number;
  /** Assignments the plan would create. */
  planned: PlannedAssignment[];
  /** Candidacies that cannot reach the target, with the reason stated. */
  shortfalls: Array<{
    candidacyId: string;
    applicantName: string | null;
    have: number;
    want: number;
  }>;
  /** Set only once applied. */
  created?: number;
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
    await assertCandidacyVisible(acUser, candidacyId);

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
   * Tops every candidacy in a committee up to a target number of reviewers.
   *
   * `docs/product-rules.md` §1 permits assigning human reviewers; this decides
   * who reads what, never what a reviewer concludes. Nothing here scores or
   * ranks an applicant.
   *
   * The rules it follows, and why each one is there:
   *
   * - **Existing work is never touched.** It tops up; it does not reassign or
   *   unassign. Rebalancing must not be able to destroy a review someone has
   *   already started.
   * - **A conflict is permanent for that pair.** A reviewer who declared a
   *   conflict on a candidacy already has a row for it, so they are skipped -
   *   and that row does not count towards coverage, because a conflicted
   *   reviewer is not going to review it.
   * - **Load is balanced by outstanding work**, not by total assigned. Someone
   *   who has submitted ten reviews has capacity; someone sitting on ten
   *   unstarted ones does not.
   * - **Ties break on user id**, so the same input produces the same plan. An
   *   assignment run that cannot be reproduced cannot be checked.
   *
   * With `dryRun` it writes nothing and returns the plan, which is what the
   * screen shows before anyone commits - the same preview-then-apply shape the
   * import and the bulk decision use.
   */
  distributeCommittee: async (
    acUser: RecruitmentUser,
    cycleId: string,
    committeeId: string,
    input: { reviewersPerCandidacy: number; reviewerUserIds?: string[]; dryRun?: boolean },
  ): Promise<DistributionPlan> => {
    if (!canAssignReviewers({ user: acUser })) {
      throw new HttpError(403, "You are not allowed to assign reviewers");
    }

    const target = Math.trunc(input.reviewersPerCandidacy);
    if (!Number.isFinite(target) || target < 1 || target > 10) {
      throw new HttpError(422, "Reviewers per candidacy must be between 1 and 10");
    }

    const candidacies = await db
      .select({
        candidacyId: committeeCandidacy.id,
        applicantName: applicant.fullName,
      })
      .from(committeeCandidacy)
      .innerJoin(application, eq(committeeCandidacy.applicationId, application.id))
      .innerJoin(applicant, eq(application.applicantId, applicant.id))
      .where(
        and(
          eq(application.cycleId, cycleId),
          eq(committeeCandidacy.committeeId, committeeId),
          eq(committeeCandidacy.active, true),
        ),
      )
      .orderBy(asc(committeeCandidacy.id));

    // Everyone whose membership covers this committee; a cycle-wide membership
    // (an admin) covers every one of them.
    const memberRows = await db
      .select({
        userId: recruitmentMembership.userId,
        userName: user.name,
        committeeId: recruitmentMembership.committeeId,
      })
      .from(recruitmentMembership)
      .innerJoin(user, eq(recruitmentMembership.userId, user.id))
      .where(
        and(eq(recruitmentMembership.cycleId, cycleId), eq(recruitmentMembership.active, true)),
      );

    const requested = new Set(input.reviewerUserIds ?? []);

    // Who may be assigned at all: a membership for this committee, or a
    // cycle-wide one, which is how an admin is stored.
    const eligible = memberRows.filter(
      (row) => row.committeeId === null || row.committeeId === committeeId,
    );

    // Who gets picked when nobody is named: only people enrolled *for this
    // committee*. A cycle-wide membership makes an admin assignable, but it
    // should not volunteer them - running the cycle is not the same as being
    // on the reading rota, and quietly handing an admin a queue of every
    // applicant is not a thing anyone asked for. Naming them still works.
    const pool = requested.size > 0 ? eligible : eligible.filter((row) => row.committeeId !== null);

    const reviewers = pool
      .filter((row) => requested.size === 0 || requested.has(row.userId))
      // A person holding both a cycle-wide and a committee membership appears twice.
      .filter((row, index, all) => all.findIndex((other) => other.userId === row.userId) === index);

    const nameBy = new Map(reviewers.map((r) => [r.userId, r.userName]));

    if (candidacies.length === 0 || reviewers.length === 0) {
      return {
        candidacyCount: candidacies.length,
        reviewerCount: reviewers.length,
        planned: [],
        shortfalls: [],
      };
    }

    const candidacyIds = candidacies.map((row) => row.candidacyId);
    const existing = await db
      .select({
        candidacyId: reviewAssignment.candidacyId,
        reviewerUserId: reviewAssignment.reviewerUserId,
        status: reviewAssignment.status,
      })
      .from(reviewAssignment)
      .where(inArray(reviewAssignment.candidacyId, candidacyIds));

    // Anyone already on a candidacy is excluded from it, conflicted included:
    // that row is a decision not to review, and re-adding them would undo it.
    const takenBy = new Map<string, Set<string>>();
    const coverage = new Map<string, number>();
    for (const row of existing) {
      const taken = takenBy.get(row.candidacyId) ?? new Set<string>();
      taken.add(row.reviewerUserId);
      takenBy.set(row.candidacyId, taken);
      if (row.status !== "conflicted" && row.status !== "cancelled") {
        coverage.set(row.candidacyId, (coverage.get(row.candidacyId) ?? 0) + 1);
      }
    }

    // Outstanding load across the whole cycle, so a reviewer who is busy in
    // another committee is not handed a third pile here.
    const loadRows = await db
      .select({ userId: reviewAssignment.reviewerUserId, status: reviewAssignment.status })
      .from(reviewAssignment)
      .innerJoin(committeeCandidacy, eq(reviewAssignment.candidacyId, committeeCandidacy.id))
      .innerJoin(application, eq(committeeCandidacy.applicationId, application.id))
      .where(eq(application.cycleId, cycleId));

    const load = new Map<string, number>();
    for (const reviewer of reviewers) load.set(reviewer.userId, 0);
    for (const row of loadRows) {
      if (!load.has(row.userId)) continue;
      if (row.status === "assigned" || row.status === "in_progress") {
        load.set(row.userId, (load.get(row.userId) ?? 0) + 1);
      }
    }

    const planned: PlannedAssignment[] = [];
    const shortfalls: DistributionPlan["shortfalls"] = [];

    for (const candidacy of candidacies) {
      const taken = takenBy.get(candidacy.candidacyId) ?? new Set<string>();
      let have = coverage.get(candidacy.candidacyId) ?? 0;

      while (have < target) {
        const next = reviewers
          .filter((reviewer) => !taken.has(reviewer.userId))
          .sort((a, b) => {
            const byLoad = (load.get(a.userId) ?? 0) - (load.get(b.userId) ?? 0);
            return byLoad !== 0 ? byLoad : a.userId.localeCompare(b.userId);
          })[0];

        // Every eligible reviewer is already on this candidacy. Say so rather
        // than looping: the fix is more reviewers, which is a human decision.
        if (!next) {
          shortfalls.push({
            candidacyId: candidacy.candidacyId,
            applicantName: candidacy.applicantName,
            have,
            want: target,
          });
          break;
        }

        taken.add(next.userId);
        load.set(next.userId, (load.get(next.userId) ?? 0) + 1);
        have += 1;
        planned.push({
          candidacyId: candidacy.candidacyId,
          applicantName: candidacy.applicantName,
          reviewerUserId: next.userId,
          reviewerName: nameBy.get(next.userId) ?? null,
        });
      }

      takenBy.set(candidacy.candidacyId, taken);
    }

    const plan: DistributionPlan = {
      candidacyCount: candidacies.length,
      reviewerCount: reviewers.length,
      planned,
      shortfalls,
    };

    if (input.dryRun === true || planned.length === 0) {
      return plan;
    }

    const now = new Date();
    await db.insert(reviewAssignment).values(
      planned.map((row) => ({
        candidacyId: row.candidacyId,
        reviewerUserId: row.reviewerUserId,
        assignedAt: now,
        createdBy: acUser.id,
        createdAt: now,
        updatedAt: now,
      })),
    );

    // One event for the run, rather than one per row: the run is the decision
    // a person made, and its size is the part worth being able to read back.
    await recordAuditEvent({
      cycleId,
      actorUserId: acUser.id,
      action: "assignment.distributed",
      entityType: "committee",
      entityId: committeeId,
      metadata: {
        committeeId,
        reviewersPerCandidacy: target,
        created: planned.length,
        candidacyCount: candidacies.length,
        reviewerCount: reviewers.length,
        shortfallCount: shortfalls.length,
      },
    });

    return { ...plan, created: planned.length };
  },

  /** Per-reviewer workload, so an admin can rebalance from real numbers. */
  listWorkloads: async (acUser: RecruitmentUser, cycleId: string): Promise<ReviewerWorkload[]> => {
    if (!canAssignReviewers({ user: acUser })) {
      throw new HttpError(403, "You are not allowed to view reviewer workloads");
    }

    const rows = await db
      .select({
        userId: reviewAssignment.reviewerUserId,
        name: user.name,
        email: user.email,
        status: reviewAssignment.status,
        total: count(reviewAssignment.id),
      })
      .from(reviewAssignment)
      .innerJoin(committeeCandidacy, eq(reviewAssignment.candidacyId, committeeCandidacy.id))
      .innerJoin(application, eq(committeeCandidacy.applicationId, application.id))
      .innerJoin(user, eq(reviewAssignment.reviewerUserId, user.id))
      .where(eq(application.cycleId, cycleId))
      .groupBy(reviewAssignment.reviewerUserId, user.name, user.email, reviewAssignment.status);

    const byUser = new Map<string, ReviewerWorkload>();
    for (const row of rows) {
      const entry = byUser.get(row.userId) ?? {
        userId: row.userId,
        name: row.name,
        email: row.email,
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
