import type { RecruitmentUser } from "@labrador/access-control";
import { canConfigureCycle } from "@labrador/access-control";
import { validateRubric } from "@labrador/common/recruitment";
import { review, rubric, rubricCriterion } from "@labrador/db/schema";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";

import { db } from "../lib/db.ts";
import { HttpError } from "../middlewares/errorHandler.ts";
import { recordAuditEvent } from "./auditService.ts";

export interface CriterionInput {
  key: string;
  label: string;
  description?: string | null;
  /** Fraction of 1. Active criteria must sum to exactly 1. */
  weight: number;
  minScore?: number;
  maxScore?: number;
  source?: "reviewer" | "application_preference";
  active?: boolean;
}

/**
 * A validation problem, keeping the criterion it concerns. `validateRubric`
 * emits that key, but returning an inline shape made tsoa drop it, so the
 * editor could list an issue without being able to attach it to the row it is
 * about.
 */
export interface RubricIssue {
  code: string;
  message: string;
  criterionKey: string | null;
}

export interface RubricValidationResponse {
  valid: boolean;
  issues: RubricIssue[];
}

export interface RubricVersionSummary {
  id: string;
  version: number;
  name: string;
  committeeId: string | null;
  active: boolean;
  /** Submitted reviews scored under this version. Non-zero means it is history. */
  reviewCount: number;
  createdAt: Date;
  criteria: Array<{
    id: string;
    key: string;
    label: string;
    description: string | null;
    weight: number;
    minScore: number;
    maxScore: number;
    source: string;
    displayOrder: number;
    active: boolean;
  }>;
}

export const rubricService = {
  /** Every rubric version for a cycle, newest first, with usage counts. */
  listRubrics: async (
    acUser: RecruitmentUser,
    cycleId: string,
  ): Promise<RubricVersionSummary[]> => {
    if (!canConfigureCycle({ user: acUser })) {
      throw new HttpError(403, "You are not allowed to view rubric configuration");
    }

    const rubrics = await db
      .select()
      .from(rubric)
      .where(eq(rubric.cycleId, cycleId))
      .orderBy(desc(rubric.version));

    if (rubrics.length === 0) {
      return [];
    }

    const rubricIds = rubrics.map((row) => row.id);

    const criteria = await db
      .select()
      .from(rubricCriterion)
      .where(inArray(rubricCriterion.rubricId, rubricIds))
      .orderBy(asc(rubricCriterion.displayOrder));

    const usage = await db
      .select({ rubricId: review.rubricId, total: count(review.id) })
      .from(review)
      .where(inArray(review.rubricId, rubricIds))
      .groupBy(review.rubricId);
    const usageBy = new Map(usage.map((row) => [row.rubricId, row.total]));

    return rubrics.map((row) => ({
      id: row.id,
      version: row.version,
      name: row.name,
      committeeId: row.committeeId,
      active: row.active,
      reviewCount: usageBy.get(row.id) ?? 0,
      createdAt: row.createdAt,
      criteria: criteria
        .filter((criterion) => criterion.rubricId === row.id)
        .map((criterion) => ({
          id: criterion.id,
          key: criterion.key,
          label: criterion.label,
          description: criterion.description,
          weight: Number(criterion.weight),
          minScore: criterion.minScore,
          maxScore: criterion.maxScore,
          source: criterion.source,
          displayOrder: criterion.displayOrder,
          active: criterion.active,
        })),
    }));
  },

  /**
   * Publishes a new rubric version and makes it active.
   *
   * Editing never mutates an existing rubric. A submitted review pins the
   * version it was scored under, so changing one in place would silently
   * restate what a reviewer meant months earlier. Publishing a version instead
   * leaves that history intact and applies the new weights only to reviews
   * created from now on.
   */
  publishRubric: async (
    acUser: RecruitmentUser,
    cycleId: string,
    input: {
      name: string;
      committeeId?: string | null;
      criteria: CriterionInput[];
    },
  ): Promise<RubricVersionSummary> => {
    if (!canConfigureCycle({ user: acUser })) {
      throw new HttpError(403, "You are not allowed to configure rubrics");
    }

    if (input.criteria.length === 0) {
      throw new HttpError(422, "A rubric needs at least one criterion");
    }

    const normalized = input.criteria.map((criterion, index) => ({
      key: criterion.key.trim(),
      label: criterion.label.trim(),
      description: criterion.description ?? null,
      weight: criterion.weight,
      minScore: criterion.minScore ?? 1,
      maxScore: criterion.maxScore ?? 5,
      source: criterion.source ?? ("reviewer" as const),
      active: criterion.active ?? true,
      displayOrder: index,
    }));

    // Refuse rather than rescale. A rubric whose weights do not sum to 1
    // silently distorts every score derived from it, and the distortion is
    // invisible in the resulting numbers.
    const validation = validateRubric(
      normalized.map((criterion) => ({
        key: criterion.key,
        weight: criterion.weight,
        minScore: criterion.minScore,
        maxScore: criterion.maxScore,
        source: criterion.source,
        active: criterion.active,
      })),
    );

    if (!validation.valid) {
      throw new HttpError(422, validation.issues.map((issue) => issue.message).join(" "));
    }

    const committeeId = input.committeeId ?? null;

    const existing = await db
      .select({ version: rubric.version })
      .from(rubric)
      .where(eq(rubric.cycleId, cycleId))
      .orderBy(desc(rubric.version));
    const nextVersion = (existing[0]?.version ?? 0) + 1;

    const now = new Date();

    // Only one rubric may be active per cycle-and-committee scope, or
    // `getActiveRubric` would have to guess which one a reviewer meant.
    await db
      .update(rubric)
      .set({ active: false, updatedAt: now })
      .where(
        and(
          eq(rubric.cycleId, cycleId),
          committeeId === null
            ? eq(rubric.active, true)
            : and(eq(rubric.active, true), eq(rubric.committeeId, committeeId)),
        ),
      );

    const [created] = await db
      .insert(rubric)
      .values({
        cycleId,
        committeeId,
        version: nextVersion,
        name: input.name,
        active: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!created) {
      throw new HttpError(500, "Failed to create the rubric version");
    }

    await db.insert(rubricCriterion).values(
      normalized.map((criterion) => ({
        rubricId: created.id,
        key: criterion.key,
        label: criterion.label,
        description: criterion.description,
        weight: criterion.weight.toFixed(4),
        minScore: criterion.minScore,
        maxScore: criterion.maxScore,
        source: criterion.source,
        active: criterion.active,
        displayOrder: criterion.displayOrder,
        createdAt: now,
        updatedAt: now,
      })),
    );

    await recordAuditEvent({
      cycleId,
      actorUserId: acUser.id,
      action: "rubric.published",
      entityType: "rubric",
      entityId: created.id,
      metadata: {
        version: nextVersion,
        committeeId,
        criterionKeys: normalized.map((criterion) => criterion.key),
      },
    });

    const all = await rubricService.listRubrics(acUser, cycleId);
    const summary = all.find((row) => row.id === created.id);
    if (!summary) {
      throw new HttpError(500, "Published rubric could not be read back");
    }
    return summary;
  },

  /**
   * Validates a draft without saving it, so the editor can show whether the
   * weights are usable before anyone publishes a version they cannot delete.
   */
  validateDraft: (
    acUser: RecruitmentUser,
    criteria: CriterionInput[],
  ): RubricValidationResponse => {
    if (!canConfigureCycle({ user: acUser })) {
      throw new HttpError(403, "You are not allowed to configure rubrics");
    }

    const result = validateRubric(
      criteria.map((criterion) => ({
        key: criterion.key,
        weight: criterion.weight,
        minScore: criterion.minScore ?? 1,
        maxScore: criterion.maxScore ?? 5,
        source: criterion.source ?? "reviewer",
        active: criterion.active ?? true,
      })),
    );

    return {
      valid: result.valid,
      issues: result.issues.map((issue) => ({
        code: issue.code,
        message: issue.message,
        criterionKey: issue.criterionKey ?? null,
      })),
    };
  },
};
