import type { RecruitmentUser } from "@labrador/access-control";
import {
  canAssignReviewers,
  canDecidePlacement,
  canReadLeadershipContext,
} from "@labrador/access-control";
import { candidacyVisibilityWhere } from "@labrador/access-control/visibility";
import {
  applicant,
  application,
  committee,
  committeeCandidacy,
  committeeDecision,
  committeePreference,
  finalPlacement,
  recruitmentMembership,
  review,
  reviewAssignment,
  user,
} from "@labrador/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";

import { db } from "../lib/db.ts";
import { HttpError } from "../middlewares/errorHandler.ts";
import { aggregateService } from "./aggregateService.ts";
import { recordAuditEvent } from "./auditService.ts";

/**
 * Exports are returned as typed rows rather than a rendered CSV.
 *
 * Keeping them JSON preserves the end-to-end type chain the stack exists for -
 * a column added here reaches the interface as a typed field rather than a
 * string the client has to parse - and the browser turns them into a file at
 * the point of download. It also means an export can be previewed on screen
 * before anyone commits it to a spreadsheet.
 *
 * Every column below is either application data the applicant submitted or
 * arithmetic over scores a named human entered. Nothing here is generated.
 */

export interface RankingExportRow {
  rank: number;
  tied: boolean;
  applicantName: string | null;
  email: string | null;
  year: string;
  major: string | null;
  committee: string;
  applicantRank: number | null;
  submittedReviews: number;
  minimumReviews: number;
  mean: number | null;
  median: number | null;
  spread: number | null;
  standardDeviation: number | null;
  strongYes: number;
  yes: number;
  unsure: number;
  no: number;
  strongNo: number;
  flagged: boolean;
  flagReasons: string;
  decision: string;
}

export interface DecisionExportRow {
  applicantName: string | null;
  email: string | null;
  year: string;
  committee: string;
  applicantRank: number | null;
  committeeDecision: string;
  decisionNotes: string | null;
  finalPlacement: string;
  placedCommittee: string | null;
}

export interface ReviewerLoadExportRow {
  reviewerUserId: string;
  reviewerName: string;
  role: string;
  committee: string | null;
  assigned: number;
  submitted: number;
  conflicted: number;
  outstanding: number;
}

function countOf(counts: Record<string, number>, key: string): number {
  return counts[key] ?? 0;
}

export const exportService = {
  /**
   * A committee's ranking, one row per candidacy, with the arithmetic beside
   * each row so a spreadsheet reader can reproduce it.
   */
  exportCommitteeRanking: async (
    acUser: RecruitmentUser,
    cycleId: string,
    committeeId: string,
  ): Promise<RankingExportRow[]> => {
    // This file carries every applicant's name and email alongside peer
    // aggregates. Aggregate visibility belongs to leads and admins; a reviewer
    // downloading it would see peers' scores for candidacies they have not yet
    // reviewed, which product rule 3 forbids.
    if (!canReadLeadershipContext({ user: acUser, application: { cycleId } })) {
      throw new HttpError(403, "You are not allowed to export the committee ranking");
    }

    const aggregates = await aggregateService.listCommitteeAggregates(acUser, cycleId, committeeId);
    if (aggregates.length === 0) {
      return [];
    }

    const ranking = await aggregateService.getCommitteeRanking(acUser, cycleId, committeeId);
    const byCandidacy = new Map(aggregates.map((row) => [row.candidacyId, row]));

    const applicationIds = aggregates.map((row) => row.applicationId);
    const details = await db
      .select({
        applicationId: application.id,
        email: applicant.email,
        year: application.year,
        major: application.major,
      })
      .from(application)
      .innerJoin(applicant, eq(application.applicantId, applicant.id))
      .where(inArray(application.id, applicationIds));
    const detailBy = new Map(details.map((row) => [row.applicationId, row]));

    const [committeeRow] = await db
      .select({ name: committee.name })
      .from(committee)
      .where(eq(committee.id, committeeId));

    const decisions = await db
      .select({
        candidacyId: committeeDecision.candidacyId,
        status: committeeDecision.status,
      })
      .from(committeeDecision)
      .where(
        inArray(
          committeeDecision.candidacyId,
          aggregates.map((row) => row.candidacyId),
        ),
      );
    const decisionBy = new Map(decisions.map((row) => [row.candidacyId, row.status]));

    await recordAuditEvent({
      cycleId,
      actorUserId: acUser.id,
      action: "export.committee_ranking",
      entityType: "committee",
      entityId: committeeId,
      metadata: { rowCount: ranking.length },
    });

    return ranking.map((row) => {
      const aggregate = byCandidacy.get(row.candidacyId);
      const detail = detailBy.get(row.applicationId);
      const counts = aggregate?.recommendationCounts ?? {};

      return {
        rank: row.rank,
        tied: row.tied,
        applicantName: row.applicantName,
        // Identity follows the same rule as the interface: withheld when the
        // caller cannot see it, rather than exported around the restriction.
        email: row.applicantName === null ? null : (detail?.email ?? null),
        year: detail?.year ?? "unknown",
        major: detail?.major ?? null,
        committee: committeeRow?.name ?? "",
        applicantRank: row.applicantRank,
        submittedReviews: row.submittedCount,
        minimumReviews: row.minimumReviews,
        mean: row.mean,
        median: row.median,
        spread: row.spread,
        standardDeviation: aggregate?.statistics.standardDeviation ?? null,
        strongYes: countOf(counts, "strong_yes"),
        yes: countOf(counts, "yes"),
        unsure: countOf(counts, "unsure"),
        no: countOf(counts, "no"),
        strongNo: countOf(counts, "strong_no"),
        flagged: row.flagged,
        flagReasons: row.reasons.join(" "),
        decision: decisionBy.get(row.candidacyId) ?? "pending",
      };
    });
  },

  /**
   * Every committee decision in the cycle alongside the final placement, which
   * is the record leadership actually hands over at the end.
   */
  exportDecisions: async (
    acUser: RecruitmentUser,
    cycleId: string,
  ): Promise<DecisionExportRow[]> => {
    if (!canDecidePlacement({ user: acUser })) {
      throw new HttpError(403, "You are not allowed to export decisions");
    }

    const rows = await db
      .select({
        applicationId: committeeCandidacy.applicationId,
        applicantName: applicant.fullName,
        email: applicant.email,
        year: application.year,
        committeeName: committee.name,
        candidacyId: committeeCandidacy.id,
        decisionStatus: committeeDecision.status,
        decisionNotes: committeeDecision.notes,
      })
      .from(committeeCandidacy)
      .innerJoin(application, eq(committeeCandidacy.applicationId, application.id))
      .innerJoin(applicant, eq(application.applicantId, applicant.id))
      .innerJoin(committee, eq(committeeCandidacy.committeeId, committee.id))
      .leftJoin(committeeDecision, eq(committeeDecision.candidacyId, committeeCandidacy.id))
      .where(
        and(
          eq(application.cycleId, cycleId),
          eq(committeeCandidacy.active, true),
          candidacyVisibilityWhere(acUser, committeeCandidacy),
        ),
      )
      .orderBy(asc(applicant.fullName), asc(committee.name));

    if (rows.length === 0) {
      return [];
    }

    const applicationIds = [...new Set(rows.map((row) => row.applicationId))];

    const placements = await db
      .select({
        applicationId: finalPlacement.applicationId,
        status: finalPlacement.status,
        committeeName: committee.name,
      })
      .from(finalPlacement)
      .leftJoin(committee, eq(finalPlacement.committeeId, committee.id))
      .where(inArray(finalPlacement.applicationId, applicationIds));
    const placementBy = new Map(placements.map((row) => [row.applicationId, row]));

    const preferences = await db
      .select({
        applicationId: committeePreference.applicationId,
        committeeName: committee.name,
        rank: committeePreference.rank,
      })
      .from(committeePreference)
      .innerJoin(committee, eq(committeePreference.committeeId, committee.id))
      .where(inArray(committeePreference.applicationId, applicationIds));
    const rankBy = new Map(
      preferences.map((row) => [`${row.applicationId}:${row.committeeName}`, row.rank]),
    );

    await recordAuditEvent({
      cycleId,
      actorUserId: acUser.id,
      action: "export.decisions",
      entityType: "recruitment_cycle",
      entityId: cycleId,
      metadata: { rowCount: rows.length },
    });

    return rows.map((row) => {
      const placement = placementBy.get(row.applicationId);
      return {
        applicantName: row.applicantName,
        email: row.email,
        year: row.year,
        committee: row.committeeName,
        applicantRank: rankBy.get(`${row.applicationId}:${row.committeeName}`) ?? null,
        committeeDecision: row.decisionStatus ?? "pending",
        decisionNotes: row.decisionNotes,
        finalPlacement: placement?.status ?? "pending",
        placedCommittee: placement?.committeeName ?? null,
      };
    });
  },

  /**
   * Reviewer workload and completion. Carries no applicant data at all, so it
   * is the export to share when discussing coverage rather than candidates.
   */
  exportReviewerLoad: async (
    acUser: RecruitmentUser,
    cycleId: string,
  ): Promise<ReviewerLoadExportRow[]> => {
    // Gated on managing assignments rather than making placements. This is the
    // one export carrying no applicant data at all, so requiring the higher
    // permission inverted the privacy story: a committee lead could pull the
    // PII-bearing ranking for their committee but not the PII-free coverage
    // report they need to ask for more reviewers.
    if (!canAssignReviewers({ user: acUser })) {
      throw new HttpError(403, "You are not allowed to export reviewer reports");
    }

    const memberships = await db
      .select({
        userId: recruitmentMembership.userId,
        userName: user.name,
        role: recruitmentMembership.role,
        committeeName: committee.name,
      })
      .from(recruitmentMembership)
      .innerJoin(user, eq(recruitmentMembership.userId, user.id))
      .leftJoin(committee, eq(recruitmentMembership.committeeId, committee.id))
      .where(
        and(eq(recruitmentMembership.cycleId, cycleId), eq(recruitmentMembership.active, true)),
      )
      .orderBy(asc(user.name));

    const assignments = await db
      .select({
        reviewerUserId: reviewAssignment.reviewerUserId,
        status: reviewAssignment.status,
        submittedAt: review.submittedAt,
      })
      .from(reviewAssignment)
      .innerJoin(committeeCandidacy, eq(reviewAssignment.candidacyId, committeeCandidacy.id))
      .innerJoin(application, eq(committeeCandidacy.applicationId, application.id))
      .leftJoin(review, eq(review.assignmentId, reviewAssignment.id))
      .where(eq(application.cycleId, cycleId));

    await recordAuditEvent({
      cycleId,
      actorUserId: acUser.id,
      action: "export.reviewer_load",
      entityType: "recruitment_cycle",
      entityId: cycleId,
      metadata: { rowCount: memberships.length },
    });

    return memberships.map((membership) => {
      const mine = assignments.filter(
        (row) => row.reviewerUserId === membership.userId && row.status !== "cancelled",
      );
      const submitted = mine.filter((row) => row.submittedAt !== null).length;
      const conflicted = mine.filter((row) => row.status === "conflicted").length;

      return {
        reviewerUserId: membership.userId,
        reviewerName: membership.userName,
        role: membership.role,
        committee: membership.committeeName,
        assigned: mine.length,
        submitted,
        conflicted,
        outstanding: mine.length - submitted - conflicted,
      };
    });
  },
};
