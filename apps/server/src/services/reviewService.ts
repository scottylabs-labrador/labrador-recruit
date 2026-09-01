import type { RecruitmentUser } from "@labrador/access-control";
import { canReopenReview, canSubmitReview, canUpdateAssignment } from "@labrador/access-control";
import { reviewVisibilityWhere } from "@labrador/access-control/visibility";
import { computeReviewScore, rankToPreferenceScore } from "@labrador/common/recruitment";
import type { RecommendationValue } from "@labrador/common/recruitment";
import {
  application,
  committeeCandidacy,
  committeePreference,
  recruitmentCycle,
  review,
  reviewAssignment,
  reviewScore,
  rubricCriterion,
} from "@labrador/db/schema";
import { and, eq } from "drizzle-orm";

import { db } from "../lib/db.ts";
import { HttpError } from "../middlewares/errorHandler.ts";
import { recordAuditEvent } from "./auditService.ts";
import { recruitmentCycleService } from "./recruitmentCycleService.ts";

export interface ReviewDraftInput {
  scores?: Record<string, number>;
  recommendation?: RecommendationValue;
  confidence?: "high" | "medium" | "low";
  rationale?: string;
  privateNotes?: string;
  discussionFlag?: boolean;
  underratedFlag?: boolean;
}

export interface ReviewDetail {
  id: string;
  assignmentId: string;
  rubricId: string;
  recommendation: string | null;
  confidence: string | null;
  rationale: string | null;
  privateNotes: string | null;
  discussionFlag: boolean;
  underratedFlag: boolean;
  computedScore: number | null;
  submittedAt: Date | null;
  scores: Array<{ criterionKey: string; score: number }>;
}

/**
 * Loads the assignment together with the cycle and committee it belongs to.
 * Throws 404 rather than 403 when the caller cannot see it, so the platform
 * never reveals that an assignment exists.
 */
async function loadAssignmentContext(acUser: RecruitmentUser, assignmentId: string) {
  const [row] = await db
    .select({
      assignmentId: reviewAssignment.id,
      reviewerUserId: reviewAssignment.reviewerUserId,
      status: reviewAssignment.status,
      candidacyId: committeeCandidacy.id,
      committeeId: committeeCandidacy.committeeId,
      applicationId: application.id,
      cycleId: application.cycleId,
      preferenceScoreMap: recruitmentCycle.preferenceScoreMap,
    })
    .from(reviewAssignment)
    .innerJoin(committeeCandidacy, eq(reviewAssignment.candidacyId, committeeCandidacy.id))
    .innerJoin(application, eq(committeeCandidacy.applicationId, application.id))
    .innerJoin(recruitmentCycle, eq(application.cycleId, recruitmentCycle.id))
    .where(
      and(
        eq(reviewAssignment.id, assignmentId),
        reviewVisibilityWhere(acUser, reviewAssignment, committeeCandidacy),
      ),
    );

  if (!row) {
    throw new HttpError(404, "Assignment not found");
  }
  return row;
}

/** The applicant's own rank for this committee, mapped through cycle config. */
async function resolvePreferenceScore(
  applicationId: string,
  committeeId: string,
  preferenceScoreMap: unknown,
  bounds: { minScore: number; maxScore: number },
): Promise<number | null> {
  const [preference] = await db
    .select({ rank: committeePreference.rank })
    .from(committeePreference)
    .where(
      and(
        eq(committeePreference.applicationId, applicationId),
        eq(committeePreference.committeeId, committeeId),
      ),
    );

  if (!preference) {
    return null;
  }

  return rankToPreferenceScore(
    preference.rank,
    (preferenceScoreMap ?? {}) as Record<string, number>,
    bounds,
  );
}

export const reviewService = {
  /**
   * The caller's own review for an assignment, creating a draft on first open
   * so autosave has a row to write to. The rubric version is pinned here, which
   * is why editing a rubric later cannot retroactively change a review.
   */
  getOrCreateDraft: async (
    acUser: RecruitmentUser,
    assignmentId: string,
  ): Promise<ReviewDetail> => {
    const context = await loadAssignmentContext(acUser, assignmentId);

    if (context.reviewerUserId !== acUser.id) {
      throw new HttpError(403, "This assignment belongs to another reviewer");
    }
    if (context.status === "conflicted" || context.status === "cancelled") {
      throw new HttpError(409, `This assignment is ${context.status}`);
    }

    const existing = await reviewService.findReview(assignmentId);
    if (existing) {
      return existing;
    }

    const rubric = await recruitmentCycleService.getActiveRubric(
      acUser,
      context.cycleId,
      context.committeeId,
    );

    const now = new Date();
    const [created] = await db
      .insert(review)
      .values({ assignmentId, rubricId: rubric.id, createdAt: now, updatedAt: now })
      .returning();

    if (!created) {
      throw new HttpError(500, "Failed to create the review draft");
    }

    await db
      .update(reviewAssignment)
      .set({ status: "in_progress", updatedAt: now })
      .where(and(eq(reviewAssignment.id, assignmentId), eq(reviewAssignment.status, "assigned")));

    return { ...toReviewDetail(created), scores: [] };
  },

  findReview: async (assignmentId: string): Promise<ReviewDetail | null> => {
    const [row] = await db.select().from(review).where(eq(review.assignmentId, assignmentId));
    if (!row) {
      return null;
    }

    const scores = await db
      .select({ criterionKey: rubricCriterion.key, score: reviewScore.score })
      .from(reviewScore)
      .innerJoin(rubricCriterion, eq(reviewScore.criterionId, rubricCriterion.id))
      .where(eq(reviewScore.reviewId, row.id));

    return { ...toReviewDetail(row), scores };
  },

  /** Autosaves a draft. Never computes a score: only submission does that. */
  saveDraft: async (
    acUser: RecruitmentUser,
    assignmentId: string,
    input: ReviewDraftInput,
  ): Promise<ReviewDetail> => {
    const draft = await reviewService.getOrCreateDraft(acUser, assignmentId);

    if (draft.submittedAt) {
      throw new HttpError(409, "This review is submitted and must be reopened before editing");
    }

    const now = new Date();
    await db
      .update(review)
      .set({
        recommendation: input.recommendation ?? null,
        confidence: input.confidence ?? null,
        rationale: input.rationale ?? null,
        privateNotes: input.privateNotes ?? null,
        discussionFlag: input.discussionFlag ?? false,
        underratedFlag: input.underratedFlag ?? false,
        updatedAt: now,
      })
      .where(eq(review.id, draft.id));

    if (input.scores) {
      await reviewService.replaceScores(draft.id, draft.rubricId, input.scores);
    }

    const updated = await reviewService.findReview(assignmentId);
    if (!updated) {
      throw new HttpError(500, "Failed to save the draft");
    }
    return updated;
  },

  replaceScores: async (
    reviewId: string,
    rubricId: string,
    scores: Record<string, number>,
  ): Promise<void> => {
    const criteria = await db
      .select({
        id: rubricCriterion.id,
        key: rubricCriterion.key,
        minScore: rubricCriterion.minScore,
        maxScore: rubricCriterion.maxScore,
        source: rubricCriterion.source,
      })
      .from(rubricCriterion)
      .where(and(eq(rubricCriterion.rubricId, rubricId), eq(rubricCriterion.active, true)));

    const now = new Date();
    for (const [key, value] of Object.entries(scores)) {
      const criterion = criteria.find((row) => row.key === key);
      if (!criterion) {
        throw new HttpError(422, `Unknown rubric criterion "${key}"`);
      }
      // The preference criterion is derived, never entered by a reviewer.
      if (criterion.source !== "reviewer") {
        throw new HttpError(422, `Criterion "${key}" is not reviewer-scored`);
      }
      if (!Number.isInteger(value) || value < criterion.minScore || value > criterion.maxScore) {
        throw new HttpError(
          422,
          `Score for "${key}" must be an integer between ${criterion.minScore} and ${criterion.maxScore}`,
        );
      }

      await db
        .insert(reviewScore)
        .values({
          reviewId,
          criterionId: criterion.id,
          score: value,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [reviewScore.reviewId, reviewScore.criterionId],
          set: { score: value, updatedAt: now },
        });
    }
  },

  /**
   * Submits a review. Every reviewer-scored criterion must be present, along
   * with a recommendation, a confidence, and a written rationale, because a
   * score with no stated reasoning cannot be discussed later.
   */
  submitReview: async (
    acUser: RecruitmentUser,
    assignmentId: string,
    input: ReviewDraftInput,
  ): Promise<ReviewDetail> => {
    const context = await loadAssignmentContext(acUser, assignmentId);

    if (
      !canSubmitReview({
        user: acUser,
        review: { reviewerUserId: context.reviewerUserId, candidacyId: context.candidacyId },
      })
    ) {
      throw new HttpError(403, "You are not allowed to submit this review");
    }

    const draft = await reviewService.saveDraft(acUser, assignmentId, input);

    const rubric = await recruitmentCycleService.getActiveRubric(
      acUser,
      context.cycleId,
      context.committeeId,
    );

    const reviewerCriteria = rubric.criteria.filter((c) => c.source === "reviewer");
    const scoreMap = Object.fromEntries(draft.scores.map((s) => [s.criterionKey, s.score]));

    const missing = reviewerCriteria.filter((c) => scoreMap[c.key] === undefined);
    if (missing.length > 0) {
      throw new HttpError(422, `Missing scores for: ${missing.map((c) => c.label).join(", ")}`);
    }
    if (!draft.recommendation) {
      throw new HttpError(422, "A recommendation is required");
    }
    if (!draft.confidence) {
      throw new HttpError(422, "A confidence level is required");
    }
    if (!draft.rationale || draft.rationale.trim().length === 0) {
      throw new HttpError(422, "A written rationale is required");
    }

    const preferenceCriterion = rubric.criteria.find((c) => c.source === "application_preference");
    const preferenceScore = preferenceCriterion
      ? await resolvePreferenceScore(
          context.applicationId,
          context.committeeId,
          context.preferenceScoreMap,
          { minScore: preferenceCriterion.minScore, maxScore: preferenceCriterion.maxScore },
        )
      : null;

    const result = computeReviewScore({
      criteria: rubric.criteria.map((c) => ({
        key: c.key,
        weight: c.weight,
        minScore: c.minScore,
        maxScore: c.maxScore,
        source: c.source as "reviewer" | "application_preference",
        active: true,
      })),
      scores: scoreMap,
      preferenceScore,
    });

    const now = new Date();
    await db
      .update(review)
      .set({ computedScore: result.normalizedScore.toFixed(2), submittedAt: now, updatedAt: now })
      .where(eq(review.id, draft.id));

    await db
      .update(reviewAssignment)
      .set({ status: "submitted", submittedAt: now, updatedAt: now })
      .where(eq(reviewAssignment.id, assignmentId));

    await recordAuditEvent({
      cycleId: context.cycleId,
      actorUserId: acUser.id,
      action: "review.submitted",
      entityType: "review",
      entityId: draft.id,
      // Identifiers and the score only. Never the rationale.
      metadata: { candidacyId: context.candidacyId, computedScore: result.normalizedScore },
    });

    const submitted = await reviewService.findReview(assignmentId);
    if (!submitted) {
      throw new HttpError(500, "Failed to submit the review");
    }
    return submitted;
  },

  /**
   * Declares a conflict. The reviewer is never asked why: requiring a written
   * reason would push them to disclose a personal relationship.
   */
  declareConflict: async (acUser: RecruitmentUser, assignmentId: string): Promise<void> => {
    const context = await loadAssignmentContext(acUser, assignmentId);

    if (
      !canUpdateAssignment({
        user: acUser,
        assignment: {
          reviewerUserId: context.reviewerUserId,
          candidacyId: context.candidacyId,
        },
      })
    ) {
      throw new HttpError(403, "You are not allowed to modify this assignment");
    }

    const now = new Date();
    await db
      .update(reviewAssignment)
      .set({ status: "conflicted", conflictedAt: now, updatedAt: now })
      .where(eq(reviewAssignment.id, assignmentId));

    // Any draft is discarded: a conflicted reviewer contributes no score.
    await db.delete(review).where(eq(review.assignmentId, assignmentId));

    await recordAuditEvent({
      cycleId: context.cycleId,
      actorUserId: acUser.id,
      action: "assignment.conflicted",
      entityType: "review_assignment",
      entityId: assignmentId,
      metadata: { candidacyId: context.candidacyId },
    });
  },

  /** Reopens a submitted review for editing. Recruitment admins only. */
  reopenReview: async (acUser: RecruitmentUser, assignmentId: string): Promise<void> => {
    if (!canReopenReview({ user: acUser })) {
      throw new HttpError(403, "You are not allowed to reopen a submitted review");
    }

    const context = await loadAssignmentContext(acUser, assignmentId);
    const now = new Date();

    await db
      .update(review)
      .set({ submittedAt: null, reopenedAt: now, updatedAt: now })
      .where(eq(review.assignmentId, assignmentId));

    await db
      .update(reviewAssignment)
      .set({ status: "in_progress", submittedAt: null, updatedAt: now })
      .where(eq(reviewAssignment.id, assignmentId));

    await recordAuditEvent({
      cycleId: context.cycleId,
      actorUserId: acUser.id,
      action: "review.reopened",
      entityType: "review_assignment",
      entityId: assignmentId,
      metadata: { candidacyId: context.candidacyId },
    });
  },
};

function toReviewDetail(row: typeof review.$inferSelect): Omit<ReviewDetail, "scores"> {
  return {
    id: row.id,
    assignmentId: row.assignmentId,
    rubricId: row.rubricId,
    recommendation: row.recommendation,
    confidence: row.confidence,
    rationale: row.rationale,
    privateNotes: row.privateNotes,
    discussionFlag: row.discussionFlag,
    underratedFlag: row.underratedFlag,
    computedScore: row.computedScore === null ? null : Number(row.computedScore),
    submittedAt: row.submittedAt,
  };
}
