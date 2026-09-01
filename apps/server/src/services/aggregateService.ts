import type { RecruitmentUser } from "@labrador/access-control";
import { canReadApplicantIdentity } from "@labrador/access-control";
import { candidacyVisibilityWhere } from "@labrador/access-control/visibility";
import {
  computeAggregate,
  detectDisagreement,
  rankCandidacies,
} from "@labrador/common/recruitment";
import type { AggregateResult, RecommendationValue } from "@labrador/common/recruitment";
import {
  applicant,
  application,
  committeeCandidacy,
  committeePreference,
  recruitmentCycle,
  review,
  reviewAssignment,
  reviewScore,
  rubricCriterion,
} from "@labrador/db/schema";
import { and, eq, inArray, isNotNull } from "drizzle-orm";

import { db } from "../lib/db.ts";
import { HttpError } from "../middlewares/errorHandler.ts";

export interface CandidacyAggregate {
  candidacyId: string;
  committeeId: string;
  applicationId: string;
  applicantName: string | null;
  applicantRank: number | null;
  assignedCount: number;
  submittedCount: number;
  minimumReviews: number;
  completionPercent: number;
  statistics: AggregateResult;
  recommendationCounts: Record<string, number>;
  confidenceCounts: Record<string, number>;
  criterionAverages: Array<{ criterionKey: string; label: string; average: number }>;
  disagreement: { flagged: boolean; reasons: string[] };
}

export interface RankingRow {
  rank: number;
  tied: boolean;
  candidacyId: string;
  applicationId: string;
  applicantName: string | null;
  applicantRank: number | null;
  submittedCount: number;
  mean: number | null;
  median: number | null;
  spread: number | null;
  flagged: boolean;
  reasons: string[];
}

function countBy(values: Array<string | null>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    if (value === null) continue;
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

export const aggregateService = {
  /**
   * Aggregates for every candidacy in a committee.
   *
   * Only submitted reviews contribute. A draft is invisible to aggregation so a
   * half-finished review can never move a ranking, and so an aggregate cannot
   * leak a peer's in-progress opinion.
   */
  listCommitteeAggregates: async (
    acUser: RecruitmentUser,
    cycleId: string,
    committeeId: string,
  ): Promise<CandidacyAggregate[]> => {
    const [cycle] = await db
      .select({
        minimumReviews: recruitmentCycle.minimumReviews,
        spreadThreshold: recruitmentCycle.disagreementSpreadThreshold,
        extremeConflict: recruitmentCycle.disagreementOnExtremeConflict,
      })
      .from(recruitmentCycle)
      .where(eq(recruitmentCycle.id, cycleId));

    if (!cycle) {
      throw new HttpError(404, "Cycle not found");
    }

    const candidacies = await db
      .select({
        candidacyId: committeeCandidacy.id,
        committeeId: committeeCandidacy.committeeId,
        applicationId: committeeCandidacy.applicationId,
        applicantName: applicant.fullName,
        disagreementReason: committeeCandidacy.disagreementReason,
      })
      .from(committeeCandidacy)
      .innerJoin(application, eq(committeeCandidacy.applicationId, application.id))
      .innerJoin(applicant, eq(application.applicantId, applicant.id))
      .where(
        and(
          eq(application.cycleId, cycleId),
          eq(committeeCandidacy.committeeId, committeeId),
          eq(committeeCandidacy.active, true),
          candidacyVisibilityWhere(acUser, committeeCandidacy),
        ),
      );

    if (candidacies.length === 0) {
      return [];
    }

    const candidacyIds = candidacies.map((row) => row.candidacyId);
    const showIdentity = canReadApplicantIdentity({ user: acUser, cycleId });

    const assignments = await db
      .select({
        candidacyId: reviewAssignment.candidacyId,
        status: reviewAssignment.status,
        reviewId: review.id,
        computedScore: review.computedScore,
        recommendation: review.recommendation,
        confidence: review.confidence,
        submittedAt: review.submittedAt,
      })
      .from(reviewAssignment)
      .leftJoin(review, eq(review.assignmentId, reviewAssignment.id))
      .where(inArray(reviewAssignment.candidacyId, candidacyIds));

    const submittedReviewIds = assignments
      .filter((row) => row.submittedAt !== null && row.reviewId !== null)
      .map((row) => row.reviewId as string);

    const criterionRows =
      submittedReviewIds.length > 0
        ? await db
            .select({
              reviewId: reviewScore.reviewId,
              criterionKey: rubricCriterion.key,
              label: rubricCriterion.label,
              score: reviewScore.score,
            })
            .from(reviewScore)
            .innerJoin(rubricCriterion, eq(reviewScore.criterionId, rubricCriterion.id))
            .where(inArray(reviewScore.reviewId, submittedReviewIds))
        : [];

    const preferences = await db
      .select({
        applicationId: committeePreference.applicationId,
        rank: committeePreference.rank,
      })
      .from(committeePreference)
      .where(
        and(
          inArray(
            committeePreference.applicationId,
            candidacies.map((row) => row.applicationId),
          ),
          eq(committeePreference.committeeId, committeeId),
        ),
      );

    const rankBy = new Map(preferences.map((row) => [row.applicationId, row.rank]));

    return candidacies.map((candidacy) => {
      const mine = assignments.filter((row) => row.candidacyId === candidacy.candidacyId);
      const submitted = mine.filter((row) => row.submittedAt !== null);
      const scores = submitted
        .map((row) => (row.computedScore === null ? null : Number(row.computedScore)))
        .filter((value): value is number => value !== null);

      const statistics = computeAggregate(scores);
      const recommendations = submitted
        .map((row) => row.recommendation)
        .filter((value): value is RecommendationValue => value !== null);

      const disagreement = detectDisagreement({
        scores,
        recommendations,
        spreadThreshold: cycle.spreadThreshold,
        flagOnExtremeConflict: cycle.extremeConflict,
        manuallyRequested: candidacy.disagreementReason !== null,
      });

      const submittedIds = new Set(
        submitted.map((row) => row.reviewId).filter((id): id is string => id !== null),
      );
      const relevant = criterionRows.filter((row) => submittedIds.has(row.reviewId));
      const byCriterion = new Map<string, { label: string; scores: number[] }>();
      for (const row of relevant) {
        const entry = byCriterion.get(row.criterionKey) ?? { label: row.label, scores: [] };
        entry.scores.push(row.score);
        byCriterion.set(row.criterionKey, entry);
      }

      const activeAssignments = mine.filter((row) => row.status !== "cancelled");

      return {
        candidacyId: candidacy.candidacyId,
        committeeId: candidacy.committeeId,
        applicationId: candidacy.applicationId,
        applicantName: showIdentity ? candidacy.applicantName : null,
        applicantRank: rankBy.get(candidacy.applicationId) ?? null,
        assignedCount: activeAssignments.length,
        submittedCount: submitted.length,
        minimumReviews: cycle.minimumReviews,
        completionPercent:
          cycle.minimumReviews === 0
            ? 100
            : Math.min(100, Math.round((submitted.length / cycle.minimumReviews) * 100)),
        statistics,
        recommendationCounts: countBy(submitted.map((row) => row.recommendation)),
        confidenceCounts: countBy(submitted.map((row) => row.confidence)),
        criterionAverages: [...byCriterion.entries()].map(([criterionKey, entry]) => ({
          criterionKey,
          label: entry.label,
          average:
            Math.round(
              (entry.scores.reduce((sum, value) => sum + value, 0) / entry.scores.length) * 100,
            ) / 100,
        })),
        disagreement,
      };
    });
  },

  /** The committee ranking, ordered by the deterministic aggregate score. */
  getCommitteeRanking: async (
    acUser: RecruitmentUser,
    cycleId: string,
    committeeId: string,
  ): Promise<RankingRow[]> => {
    const aggregates = await aggregateService.listCommitteeAggregates(acUser, cycleId, committeeId);

    const ranked = rankCandidacies(
      aggregates.map((row) => ({
        candidacyId: row.candidacyId,
        meanScore: row.statistics.mean,
        submittedReviewCount: row.submittedCount,
        applicantRank: row.applicantRank,
        // Ranking must not depend on whether the caller may see names, so a
        // blinded caller sorts by a stable surrogate instead.
        applicantName: row.applicantName ?? row.candidacyId,
      })),
    );

    const byId = new Map(aggregates.map((row) => [row.candidacyId, row]));

    return ranked.map((row) => {
      const aggregate = byId.get(row.candidacyId);
      if (!aggregate) {
        throw new HttpError(500, "Ranking produced an unknown candidacy");
      }
      return {
        rank: row.rank,
        tied: row.tied,
        candidacyId: row.candidacyId,
        applicationId: aggregate.applicationId,
        applicantName: aggregate.applicantName,
        applicantRank: aggregate.applicantRank,
        submittedCount: aggregate.submittedCount,
        mean: aggregate.statistics.mean,
        median: aggregate.statistics.median,
        spread: aggregate.statistics.spread,
        flagged: aggregate.disagreement.flagged,
        reasons: aggregate.disagreement.reasons,
      };
    });
  },

  /** Candidacies needing another human review, with the reason always stated. */
  getDisagreementQueue: async (
    acUser: RecruitmentUser,
    cycleId: string,
    committeeId: string,
  ): Promise<CandidacyAggregate[]> => {
    const aggregates = await aggregateService.listCommitteeAggregates(acUser, cycleId, committeeId);
    return aggregates.filter((row) => row.disagreement.flagged);
  },

  /**
   * The reviews behind one candidacy's aggregate, so leadership can inspect the
   * derivation. Visibility still applies: a reviewer who has not submitted sees
   * only their own.
   */
  getCandidacyReviews: async (acUser: RecruitmentUser, candidacyId: string) => {
    const unblinded = acUser.recruitment.unblindedCandidacyIds ?? [];
    const isPrivileged = acUser.recruitment.memberships.some(
      (m) => m.role === "recruitment_admin" || m.role === "committee_lead",
    );

    if (!isPrivileged && !unblinded.includes(candidacyId)) {
      // Before submitting, a reviewer may see only their own review.
      const own = await db
        .select({
          reviewId: review.id,
          reviewerUserId: reviewAssignment.reviewerUserId,
          computedScore: review.computedScore,
          recommendation: review.recommendation,
          confidence: review.confidence,
          rationale: review.rationale,
          submittedAt: review.submittedAt,
        })
        .from(review)
        .innerJoin(reviewAssignment, eq(review.assignmentId, reviewAssignment.id))
        .where(
          and(
            eq(reviewAssignment.candidacyId, candidacyId),
            eq(reviewAssignment.reviewerUserId, acUser.id),
          ),
        );

      return own;
    }

    return db
      .select({
        reviewId: review.id,
        reviewerUserId: reviewAssignment.reviewerUserId,
        computedScore: review.computedScore,
        recommendation: review.recommendation,
        confidence: review.confidence,
        rationale: review.rationale,
        submittedAt: review.submittedAt,
      })
      .from(review)
      .innerJoin(reviewAssignment, eq(review.assignmentId, reviewAssignment.id))
      .innerJoin(committeeCandidacy, eq(reviewAssignment.candidacyId, committeeCandidacy.id))
      .where(
        and(
          eq(reviewAssignment.candidacyId, candidacyId),
          isNotNull(review.submittedAt),
          candidacyVisibilityWhere(acUser, committeeCandidacy),
        ),
      );
  },
};
