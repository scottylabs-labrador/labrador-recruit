import { auditEvent } from "@labrador/db/schema";
import { and, desc, eq } from "drizzle-orm";

import { db } from "../lib/db.ts";

export interface AuditEventInput {
  cycleId: string | null;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Records a consequential recruitment action.
 *
 * `metadata` must never carry applicant essay text or reviewer rationale. Pass
 * identifiers and the names of changed fields; the point of the log is to show
 * who did what and when, not to duplicate the content elsewhere in the database.
 */
export async function recordAuditEvent(input: AuditEventInput): Promise<void> {
  await db.insert(auditEvent).values({
    cycleId: input.cycleId,
    actorUserId: input.actorUserId === "" ? null : input.actorUserId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    metadata: input.metadata ?? null,
    createdAt: new Date(),
  });
}

export const auditService = {
  listEvents: async (cycleId: string, options?: { limit?: number; action?: string }) => {
    const limit = Math.min(200, Math.max(1, options?.limit ?? 50));

    return db
      .select({
        id: auditEvent.id,
        actorUserId: auditEvent.actorUserId,
        action: auditEvent.action,
        entityType: auditEvent.entityType,
        entityId: auditEvent.entityId,
        metadata: auditEvent.metadata,
        createdAt: auditEvent.createdAt,
      })
      .from(auditEvent)
      .where(
        options?.action
          ? and(eq(auditEvent.cycleId, cycleId), eq(auditEvent.action, options.action))
          : eq(auditEvent.cycleId, cycleId),
      )
      .orderBy(desc(auditEvent.createdAt))
      .limit(limit);
  },
};
