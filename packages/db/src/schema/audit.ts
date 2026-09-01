import { relations } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { user } from "./auth.ts";
import { recruitmentCycle } from "./recruitment.ts";

/**
 * A record of a consequential recruitment action: assignment changes, conflict
 * declarations, review submissions and reopenings, decisions, placements, and
 * settings changes.
 *
 * `metadata` deliberately never carries application essay text or reviewer
 * rationale. It holds identifiers and the before-and-after of the field that
 * changed, so the log stays useful without duplicating PII.
 */
export const auditEvent = pgTable(
  "audit_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cycleId: uuid("cycle_id").references(() => recruitmentCycle.id, { onDelete: "cascade" }),

    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),

    /** Dotted verb, for example `review.submitted` or `assignment.conflicted`. */
    action: text("action").notNull(),

    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),

    metadata: jsonb("metadata"),

    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    index("audit_event_cycleId_idx").on(table.cycleId),
    index("audit_event_actorUserId_idx").on(table.actorUserId),
    index("audit_event_entity_idx").on(table.entityType, table.entityId),
    index("audit_event_createdAt_idx").on(table.createdAt),
  ],
);

export const auditEventRelations = relations(auditEvent, ({ one }) => ({
  cycle: one(recruitmentCycle, {
    fields: [auditEvent.cycleId],
    references: [recruitmentCycle.id],
  }),
  actor: one(user, {
    fields: [auditEvent.actorUserId],
    references: [user.id],
  }),
}));
