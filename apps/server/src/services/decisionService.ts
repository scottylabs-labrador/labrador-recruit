import type { RecruitmentUser } from "@labrador/access-control";
import { canDecideCommittee, canDecidePlacement } from "@labrador/access-control";
import { candidacyVisibilityWhere } from "@labrador/access-control/visibility";
import {
  applicant,
  application,
  committee,
  committeeCandidacy,
  committeeDecision,
  committeePreference,
  cycleCommittee,
  finalPlacement,
  recruitmentCycle,
} from "@labrador/db/schema";
import { and, asc, count, eq, inArray } from "drizzle-orm";

import { db } from "../lib/db.ts";
import { HttpError } from "../middlewares/errorHandler.ts";
import { recordAuditEvent } from "./auditService.ts";

export type DecisionStatusValue =
  | "pending"
  | "discuss"
  | "accept"
  | "waitlist"
  | "reject"
  | "redirect";

export type PlacementStatusValue = "pending" | "placed" | "waitlisted" | "rejected" | "declined";

export interface PlacementCandidate {
  applicationId: string;
  applicantName: string;
  /** Committees that proposed accepting them, with the applicant's own rank. */
  interestedCommittees: Array<{
    committeeId: string;
    committeeName: string;
    decisionStatus: string;
    applicantRank: number | null;
  }>;
  currentPlacement: {
    committeeId: string | null;
    committeeName: string | null;
    status: string;
  } | null;
}

async function assertCycleWritable(cycleId: string): Promise<void> {
  const [cycle] = await db
    .select({ status: recruitmentCycle.status })
    .from(recruitmentCycle)
    .where(eq(recruitmentCycle.id, cycleId));

  if (!cycle) {
    throw new HttpError(404, "Cycle not found");
  }
  if (cycle.status === "archived") {
    throw new HttpError(409, "This cycle is archived and is read-only");
  }
}

export const decisionService = {
  /**
   * Records a committee's proposed outcome for a candidacy.
   *
   * A proposal is not a placement. Nothing here writes to `final_placement`,
   * because an applicant wanted by two committees must be resolved by a human
   * looking at both, not by whichever committee decided last.
   */
  setCommitteeDecision: async (
    acUser: RecruitmentUser,
    candidacyId: string,
    input: {
      status: DecisionStatusValue;
      notes?: string;
      redirectCommitteeId?: string | null;
    },
  ) => {
    const [candidacy] = await db
      .select({
        id: committeeCandidacy.id,
        committeeId: committeeCandidacy.committeeId,
        cycleId: application.cycleId,
      })
      .from(committeeCandidacy)
      .innerJoin(application, eq(committeeCandidacy.applicationId, application.id))
      .where(
        and(
          eq(committeeCandidacy.id, candidacyId),
          candidacyVisibilityWhere(acUser, committeeCandidacy),
        ),
      );

    if (!candidacy) {
      throw new HttpError(404, "Candidacy not found");
    }

    if (!canDecideCommittee({ user: acUser, decision: { candidacyId } })) {
      throw new HttpError(403, "You are not allowed to decide on this candidacy");
    }

    await assertCycleWritable(candidacy.cycleId);

    if (input.status === "redirect" && !input.redirectCommitteeId) {
      throw new HttpError(422, "A redirect must name the committee being suggested");
    }

    const now = new Date();
    const [decision] = await db
      .insert(committeeDecision)
      .values({
        candidacyId,
        status: input.status,
        notes: input.notes ?? null,
        redirectCommitteeId: input.redirectCommitteeId ?? null,
        decidedBy: acUser.id,
        decidedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: committeeDecision.candidacyId,
        set: {
          status: input.status,
          notes: input.notes ?? null,
          redirectCommitteeId: input.redirectCommitteeId ?? null,
          decidedBy: acUser.id,
          decidedAt: now,
          updatedAt: now,
        },
      })
      .returning();

    await db
      .update(committeeCandidacy)
      .set({ status: "decided", updatedAt: now })
      .where(eq(committeeCandidacy.id, candidacyId));

    await recordAuditEvent({
      cycleId: candidacy.cycleId,
      actorUserId: acUser.id,
      action: "decision.recorded",
      entityType: "committee_decision",
      entityId: decision?.id ?? null,
      metadata: { candidacyId, status: input.status },
    });

    return decision;
  },

  /** Committee decisions for one committee, with capacity for context. */
  listCommitteeDecisions: async (acUser: RecruitmentUser, cycleId: string, committeeId: string) => {
    const rows = await db
      .select({
        candidacyId: committeeCandidacy.id,
        applicationId: committeeCandidacy.applicationId,
        applicantName: applicant.fullName,
        status: committeeDecision.status,
        notes: committeeDecision.notes,
        decidedBy: committeeDecision.decidedBy,
        decidedAt: committeeDecision.decidedAt,
      })
      .from(committeeCandidacy)
      .innerJoin(application, eq(committeeCandidacy.applicationId, application.id))
      .innerJoin(applicant, eq(application.applicantId, applicant.id))
      .leftJoin(committeeDecision, eq(committeeDecision.candidacyId, committeeCandidacy.id))
      .where(
        and(
          eq(application.cycleId, cycleId),
          eq(committeeCandidacy.committeeId, committeeId),
          eq(committeeCandidacy.active, true),
          candidacyVisibilityWhere(acUser, committeeCandidacy),
        ),
      )
      .orderBy(asc(applicant.fullName));

    const [capacityRow] = await db
      .select({ capacity: cycleCommittee.capacity })
      .from(cycleCommittee)
      .where(and(eq(cycleCommittee.cycleId, cycleId), eq(cycleCommittee.committeeId, committeeId)));

    const accepted = rows.filter((row) => row.status === "accept").length;

    return {
      capacity: capacityRow?.capacity ?? null,
      acceptedCount: accepted,
      overCapacity:
        capacityRow?.capacity !== null &&
        capacityRow?.capacity !== undefined &&
        accepted > capacityRow.capacity,
      decisions: rows,
    };
  },

  /**
   * Applicants proposed for acceptance by at least one committee.
   *
   * Surfaces everyone who is wanted by more than one committee alongside their
   * own stated preference, because that is the case leadership actually has to
   * talk through.
   */
  listPlacementQueue: async (
    acUser: RecruitmentUser,
    cycleId: string,
  ): Promise<PlacementCandidate[]> => {
    if (!canDecidePlacement({ user: acUser })) {
      throw new HttpError(403, "You are not allowed to view final placement");
    }

    const rows = await db
      .select({
        applicationId: committeeCandidacy.applicationId,
        applicantName: applicant.fullName,
        committeeId: committee.id,
        committeeName: committee.name,
        decisionStatus: committeeDecision.status,
      })
      .from(committeeDecision)
      .innerJoin(committeeCandidacy, eq(committeeDecision.candidacyId, committeeCandidacy.id))
      .innerJoin(committee, eq(committeeCandidacy.committeeId, committee.id))
      .innerJoin(application, eq(committeeCandidacy.applicationId, application.id))
      .innerJoin(applicant, eq(application.applicantId, applicant.id))
      .where(
        and(
          eq(application.cycleId, cycleId),
          inArray(committeeDecision.status, ["accept", "waitlist"]),
        ),
      )
      .orderBy(asc(applicant.fullName));

    if (rows.length === 0) {
      return [];
    }

    const applicationIds = [...new Set(rows.map((row) => row.applicationId))];

    const preferences = await db
      .select({
        applicationId: committeePreference.applicationId,
        committeeId: committeePreference.committeeId,
        rank: committeePreference.rank,
      })
      .from(committeePreference)
      .where(inArray(committeePreference.applicationId, applicationIds));

    const rankBy = new Map(
      preferences.map((row) => [`${row.applicationId}:${row.committeeId}`, row.rank]),
    );

    const placements = await db
      .select({
        applicationId: finalPlacement.applicationId,
        committeeId: finalPlacement.committeeId,
        committeeName: committee.name,
        status: finalPlacement.status,
      })
      .from(finalPlacement)
      .leftJoin(committee, eq(finalPlacement.committeeId, committee.id))
      .where(inArray(finalPlacement.applicationId, applicationIds));

    const placementBy = new Map(placements.map((row) => [row.applicationId, row]));

    const byApplication = new Map<string, PlacementCandidate>();
    for (const row of rows) {
      const entry = byApplication.get(row.applicationId) ?? {
        applicationId: row.applicationId,
        applicantName: row.applicantName,
        interestedCommittees: [],
        currentPlacement: null,
      };

      entry.interestedCommittees.push({
        committeeId: row.committeeId,
        committeeName: row.committeeName,
        decisionStatus: row.decisionStatus,
        applicantRank: rankBy.get(`${row.applicationId}:${row.committeeId}`) ?? null,
      });

      const placement = placementBy.get(row.applicationId);
      entry.currentPlacement = placement
        ? {
            committeeId: placement.committeeId,
            committeeName: placement.committeeName,
            status: placement.status,
          }
        : null;

      byApplication.set(row.applicationId, entry);
    }

    return [...byApplication.values()].map((entry) => ({
      ...entry,
      // The applicant's own ordering first, so the conversation starts from
      // what they asked for rather than from whichever committee scored highest.
      interestedCommittees: entry.interestedCommittees.sort(
        (a, b) => (a.applicantRank ?? 99) - (b.applicantRank ?? 99),
      ),
    }));
  },

  /**
   * Records the final placement. Always an explicit human action: there is no
   * code path that derives a placement from a numeric cutoff.
   */
  setFinalPlacement: async (
    acUser: RecruitmentUser,
    applicationId: string,
    input: {
      committeeId?: string | null;
      status: PlacementStatusValue;
      notes?: string;
    },
  ) => {
    if (!canDecidePlacement({ user: acUser })) {
      throw new HttpError(403, "You are not allowed to make a final placement");
    }

    const [target] = await db
      .select({ id: application.id, cycleId: application.cycleId })
      .from(application)
      .where(eq(application.id, applicationId));

    if (!target) {
      throw new HttpError(404, "Application not found");
    }

    await assertCycleWritable(target.cycleId);

    if (input.status === "placed" && !input.committeeId) {
      throw new HttpError(422, "A placement must name the committee the applicant joins");
    }

    const now = new Date();
    const [placement] = await db
      .insert(finalPlacement)
      .values({
        applicationId,
        committeeId: input.committeeId ?? null,
        status: input.status,
        notes: input.notes ?? null,
        decidedBy: acUser.id,
        decidedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: finalPlacement.applicationId,
        set: {
          committeeId: input.committeeId ?? null,
          status: input.status,
          notes: input.notes ?? null,
          decidedBy: acUser.id,
          decidedAt: now,
          updatedAt: now,
        },
      })
      .returning();

    await recordAuditEvent({
      cycleId: target.cycleId,
      actorUserId: acUser.id,
      action: "placement.decided",
      entityType: "final_placement",
      entityId: placement?.id ?? null,
      metadata: { applicationId, status: input.status, committeeId: input.committeeId ?? null },
    });

    return placement;
  },

  /** Cycle-wide progress, for the recruitment dashboard. */
  getCycleProgress: async (acUser: RecruitmentUser, cycleId: string) => {
    // Counts are aggregate rather than per-applicant, but they still describe a
    // cycle's applicant pool, so a caller with no standing gets nothing.
    if (acUser.recruitment.memberships.length === 0) {
      throw new HttpError(403, "You have no recruitment role in this cycle");
    }

    const [applications] = await db
      .select({ total: count(application.id) })
      .from(application)
      .where(eq(application.cycleId, cycleId));

    const [candidacies] = await db
      .select({ total: count(committeeCandidacy.id) })
      .from(committeeCandidacy)
      .innerJoin(application, eq(committeeCandidacy.applicationId, application.id))
      .where(and(eq(application.cycleId, cycleId), eq(committeeCandidacy.active, true)));

    const [placements] = await db
      .select({ total: count(finalPlacement.id) })
      .from(finalPlacement)
      .innerJoin(application, eq(finalPlacement.applicationId, application.id))
      .where(eq(application.cycleId, cycleId));

    return {
      applicationCount: applications?.total ?? 0,
      candidacyCount: candidacies?.total ?? 0,
      placementCount: placements?.total ?? 0,
    };
  },
};
