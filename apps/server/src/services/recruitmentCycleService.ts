import type { RecruitmentUser } from "@labrador/access-control";
import { canConfigureCycle, canCreateCycle } from "@labrador/access-control";
import { validateRubric } from "@labrador/common/recruitment";
import {
  committee,
  cycleCommittee,
  recruitmentCycle,
  recruitmentMembership,
  rubric,
  rubricCriterion,
} from "@labrador/db/schema";
import { and, asc, desc, eq } from "drizzle-orm";

import { db } from "../lib/db.ts";
import { HttpError } from "../middlewares/errorHandler.ts";
import { recordAuditEvent } from "./auditService.ts";

export interface CycleSummary {
  id: string;
  slug: string;
  name: string;
  status: string;
  minimumReviews: number;
  blindReviewEnabled: boolean;
  candidacyTopN: number;
  disagreementSpreadThreshold: number;
  createdAt: Date;
}

export interface CommitteeSummary {
  id: string;
  slug: string;
  name: string;
  capacity: number | null;
  displayOrder: number;
}

/**
 * One recruitment role the caller holds.
 *
 * Declared as a named interface rather than inline, because tsoa infers an
 * inline object inside a Promise generic as a flat required shape and emitted
 * `committeeId` as a non-nullable string. Null is precisely how a cycle-wide
 * membership — and therefore a recruitment admin — is represented, so the
 * generated client was wrong about the one value that decides the role's scope.
 */
export interface StandingMembership {
  role: "reviewer" | "committee_lead" | "recruitment_admin";
  /** Null means the role applies across the whole cycle. */
  committeeId: string | null;
}

export interface MyStanding {
  userId: string;
  globalRole: "admin" | "user" | "guest";
  cycleId: string;
  memberships: StandingMembership[];
  /** Candidacies where the caller has already submitted, so peers are visible. */
  unblindedCandidacyIds: string[];
  blindReviewEnabled: boolean;
}

export interface RubricCriterionSummary {
  id: string;
  key: string;
  label: string;
  description: string | null;
  weight: number;
  minScore: number;
  maxScore: number;
  source: string;
  displayOrder: number;
}

export const recruitmentCycleService = {
  /**
   * Cycles the caller holds a membership in, newest first. A global admin also
   * sees every cycle, because they need one to grant the first membership.
   */
  listCycles: async (acUser: RecruitmentUser): Promise<CycleSummary[]> => {
    if (acUser.id === "") {
      throw new HttpError(401);
    }

    const columns = {
      id: recruitmentCycle.id,
      slug: recruitmentCycle.slug,
      name: recruitmentCycle.name,
      status: recruitmentCycle.status,
      minimumReviews: recruitmentCycle.minimumReviews,
      blindReviewEnabled: recruitmentCycle.blindReviewEnabled,
      candidacyTopN: recruitmentCycle.candidacyTopN,
      disagreementSpreadThreshold: recruitmentCycle.disagreementSpreadThreshold,
      createdAt: recruitmentCycle.createdAt,
    };

    if (acUser.role === "admin") {
      return db.select(columns).from(recruitmentCycle).orderBy(desc(recruitmentCycle.createdAt));
    }

    const rows = await db
      .selectDistinct(columns)
      .from(recruitmentCycle)
      .innerJoin(recruitmentMembership, eq(recruitmentMembership.cycleId, recruitmentCycle.id))
      .where(
        and(eq(recruitmentMembership.userId, acUser.id), eq(recruitmentMembership.active, true)),
      )
      .orderBy(desc(recruitmentCycle.createdAt));

    return rows;
  },

  getCycle: async (acUser: RecruitmentUser, cycleId: string): Promise<CycleSummary> => {
    const cycles = await recruitmentCycleService.listCycles(acUser);
    const found = cycles.find((row) => row.id === cycleId);

    // Absent rather than forbidden: a cycle the caller has no standing in must
    // not be distinguishable from one that does not exist.
    if (!found) {
      throw new HttpError(404, "Cycle not found");
    }
    return found;
  },

  createCycle: async (
    acUser: RecruitmentUser,
    input: {
      slug: string;
      name: string;
      minimumReviews?: number;
      candidacyTopN?: number;
      blindReviewEnabled?: boolean;
      preferenceScoreMap?: Record<string, number>;
    },
  ) => {
    if (!canCreateCycle({ user: acUser })) {
      throw new HttpError(403, "You are not allowed to create a recruitment cycle");
    }

    const now = new Date();
    const [created] = await db
      .insert(recruitmentCycle)
      .values({
        slug: input.slug,
        name: input.name,
        minimumReviews: input.minimumReviews ?? 3,
        candidacyTopN: input.candidacyTopN ?? 3,
        blindReviewEnabled: input.blindReviewEnabled ?? false,
        preferenceScoreMap: input.preferenceScoreMap ?? {
          "1": 5,
          "2": 4.5,
          "3": 4,
          "4": 3,
          "5": 2.5,
          "6": 2,
          "7": 1,
        },
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!created) {
      throw new HttpError(500, "Failed to create the cycle");
    }

    await recordAuditEvent({
      cycleId: created.id,
      actorUserId: acUser.id,
      action: "cycle.created",
      entityType: "recruitment_cycle",
      entityId: created.id,
      metadata: { slug: created.slug },
    });

    return created;
  },

  /**
   * Updates cycle policy. Thresholds, review counts, and the preference map are
   * configuration precisely so leadership can revise them without a deploy.
   */
  updateCycleSettings: async (
    acUser: RecruitmentUser,
    cycleId: string,
    input: {
      name?: string;
      status?: "draft" | "open" | "reviewing" | "deciding" | "archived";
      minimumReviews?: number;
      candidacyTopN?: number;
      blindReviewEnabled?: boolean;
      disagreementSpreadThreshold?: number;
      disagreementOnExtremeConflict?: boolean;
      preferenceScoreMap?: Record<string, number>;
    },
  ) => {
    if (!canConfigureCycle({ user: acUser })) {
      throw new HttpError(403, "You are not allowed to configure this cycle");
    }

    const [existing] = await db
      .select({ id: recruitmentCycle.id, status: recruitmentCycle.status })
      .from(recruitmentCycle)
      .where(eq(recruitmentCycle.id, cycleId));

    if (!existing) {
      throw new HttpError(404, "Cycle not found");
    }

    // An archived cycle is a historical record. Reopening it is an explicit
    // status change, never a side effect of editing another setting.
    if (existing.status === "archived" && input.status !== "deciding") {
      throw new HttpError(409, "This cycle is archived and is read-only");
    }

    const [updated] = await db
      .update(recruitmentCycle)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(recruitmentCycle.id, cycleId))
      .returning();

    await recordAuditEvent({
      cycleId,
      actorUserId: acUser.id,
      action: "cycle.settings_updated",
      entityType: "recruitment_cycle",
      entityId: cycleId,
      metadata: { changed: Object.keys(input) },
    });

    return updated;
  },

  /**
   * The caller's own recruitment standing in a cycle.
   *
   * Exists because the browser runs the same `can*` predicates the server does,
   * and it cannot do that without knowing which memberships it holds. Without
   * this the interface has to assume least privilege, which silently hides
   * actions an admin is entitled to.
   *
   * Returns only the caller's own standing, so it needs no permission check
   * beyond being able to see the cycle at all.
   */
  getMyStanding: async (acUser: RecruitmentUser, cycleId: string): Promise<MyStanding> => {
    await recruitmentCycleService.getCycle(acUser, cycleId);

    return {
      userId: acUser.id,
      globalRole: acUser.role,
      cycleId,
      memberships: acUser.recruitment.memberships,
      unblindedCandidacyIds: acUser.recruitment.unblindedCandidacyIds ?? [],
      blindReviewEnabled: acUser.recruitment.blindReviewEnabled ?? false,
    };
  },

  /**
   * Creates a committee if its slug is new, and attaches it to the cycle.
   *
   * Until this existed the only way to get a committee into the database was
   * the development seed, so a real cycle could not be configured at all
   * without shell access to the server. Committees are global and cycles
   * reference them, which is what lets a committee keep its identity - and its
   * history - from one recruitment round to the next.
   *
   * Idempotent on both halves: re-attaching an existing committee updates its
   * capacity rather than failing, so this can be run repeatedly while setting a
   * cycle up.
   */
  attachCommittee: async (
    acUser: RecruitmentUser,
    cycleId: string,
    input: {
      slug: string;
      name: string;
      description?: string | null;
      capacity?: number | null;
      minimumReviews?: number | null;
      displayOrder?: number;
    },
  ): Promise<CommitteeSummary> => {
    await recruitmentCycleService.getCycle(acUser, cycleId);
    if (!canConfigureCycle({ user: acUser })) {
      throw new HttpError(403, "You are not allowed to configure this cycle");
    }

    const slug = input.slug.trim().toLowerCase();
    const name = input.name.trim();
    if (slug === "" || name === "") {
      throw new HttpError(422, "A committee needs both a slug and a name");
    }

    const now = new Date();

    const [saved] = await db
      .insert(committee)
      .values({
        slug,
        name,
        description: input.description ?? null,
        displayOrder: input.displayOrder ?? 0,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: committee.slug,
        set: { name, description: input.description ?? null, updatedAt: now },
      })
      .returning();

    if (saved === undefined) {
      throw new HttpError(500, "Failed to save the committee");
    }

    await db
      .insert(cycleCommittee)
      .values({
        cycleId,
        committeeId: saved.id,
        capacity: input.capacity ?? null,
        minimumReviews: input.minimumReviews ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [cycleCommittee.cycleId, cycleCommittee.committeeId],
        set: {
          capacity: input.capacity ?? null,
          minimumReviews: input.minimumReviews ?? null,
          updatedAt: now,
        },
      });

    await recordAuditEvent({
      cycleId,
      actorUserId: acUser.id,
      action: "committee.attached",
      entityType: "committee",
      entityId: saved.id,
      metadata: { slug, name, capacity: input.capacity ?? null },
    });

    return {
      id: saved.id,
      slug: saved.slug,
      name: saved.name,
      capacity: input.capacity ?? null,
      displayOrder: saved.displayOrder,
    };
  },

  listCommittees: async (acUser: RecruitmentUser, cycleId: string): Promise<CommitteeSummary[]> => {
    await recruitmentCycleService.getCycle(acUser, cycleId);

    return db
      .select({
        id: committee.id,
        slug: committee.slug,
        name: committee.name,
        capacity: cycleCommittee.capacity,
        displayOrder: committee.displayOrder,
      })
      .from(cycleCommittee)
      .innerJoin(committee, eq(cycleCommittee.committeeId, committee.id))
      .where(eq(cycleCommittee.cycleId, cycleId))
      .orderBy(asc(committee.displayOrder));
  },

  /**
   * The active rubric for a committee, falling back to the cycle default.
   * Returns the criteria a reviewer will actually be asked to score.
   */
  getActiveRubric: async (
    acUser: RecruitmentUser,
    cycleId: string,
    committeeId: string | null,
  ): Promise<{ id: string; name: string; version: number; criteria: RubricCriterionSummary[] }> => {
    await recruitmentCycleService.getCycle(acUser, cycleId);

    const candidates = await db
      .select({
        id: rubric.id,
        name: rubric.name,
        version: rubric.version,
        committeeId: rubric.committeeId,
      })
      .from(rubric)
      .where(and(eq(rubric.cycleId, cycleId), eq(rubric.active, true)))
      .orderBy(desc(rubric.version));

    const scoped = committeeId
      ? candidates.find((row) => row.committeeId === committeeId)
      : undefined;
    const chosen = scoped ?? candidates.find((row) => row.committeeId === null);

    if (!chosen) {
      throw new HttpError(404, "No active rubric is configured for this cycle");
    }

    const criteria = await db
      .select({
        id: rubricCriterion.id,
        key: rubricCriterion.key,
        label: rubricCriterion.label,
        description: rubricCriterion.description,
        weight: rubricCriterion.weight,
        minScore: rubricCriterion.minScore,
        maxScore: rubricCriterion.maxScore,
        source: rubricCriterion.source,
        displayOrder: rubricCriterion.displayOrder,
        active: rubricCriterion.active,
      })
      .from(rubricCriterion)
      .where(eq(rubricCriterion.rubricId, chosen.id))
      .orderBy(asc(rubricCriterion.displayOrder));

    const validation = validateRubric(
      criteria.map((row) => ({
        key: row.key,
        weight: Number(row.weight),
        minScore: row.minScore,
        maxScore: row.maxScore,
        source: row.source,
        active: row.active,
      })),
    );

    // Serving a rubric whose weights do not sum to 1 would silently distort
    // every score derived from it, so refuse rather than quietly rescale.
    if (!validation.valid) {
      throw new HttpError(
        500,
        `The active rubric is misconfigured: ${validation.issues.map((i) => i.message).join("; ")}`,
      );
    }

    return {
      id: chosen.id,
      name: chosen.name,
      version: chosen.version,
      criteria: criteria
        .filter((row) => row.active)
        .map((row) => ({
          id: row.id,
          key: row.key,
          label: row.label,
          description: row.description,
          weight: Number(row.weight),
          minScore: row.minScore,
          maxScore: row.maxScore,
          source: row.source,
          displayOrder: row.displayOrder,
        })),
    };
  },
};
