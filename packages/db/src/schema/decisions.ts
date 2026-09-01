import { relations } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { application, committeeCandidacy } from "./applications.ts";
import { user } from "./auth.ts";
import { decisionStatus, placementStatus } from "./enums.ts";
import { committee } from "./recruitment.ts";

/**
 * A committee's proposed outcome for one candidacy. Proposing is not placing:
 * a committee decision never silently becomes a {@link finalPlacement}.
 */
export const committeeDecision = pgTable(
  "committee_decision",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidacyId: uuid("candidacy_id")
      .notNull()
      .references(() => committeeCandidacy.id, { onDelete: "cascade" }),

    status: decisionStatus("status").notNull().default("pending"),
    notes: text("notes"),

    /** Set when the committee suggests the applicant to a different committee. */
    redirectCommitteeId: uuid("redirect_committee_id").references(() => committee.id, {
      onDelete: "set null",
    }),

    decidedBy: text("decided_by").references(() => user.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at"),

    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("committee_decision_candidacy_key").on(table.candidacyId),
    index("committee_decision_status_idx").on(table.status),
  ],
);

/**
 * Leadership's final outcome for an applicant in a cycle. An application
 * belongs to exactly one cycle, so one placement per application is one
 * placement per cycle. `committeeId` is null when the applicant is not placed.
 */
export const finalPlacement = pgTable(
  "final_placement",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => application.id, { onDelete: "cascade" }),

    committeeId: uuid("committee_id").references(() => committee.id, { onDelete: "set null" }),
    status: placementStatus("status").notNull().default("pending"),
    notes: text("notes"),

    decidedBy: text("decided_by").references(() => user.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at"),

    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("final_placement_application_key").on(table.applicationId),
    index("final_placement_committeeId_idx").on(table.committeeId),
    index("final_placement_status_idx").on(table.status),
  ],
);

export const committeeDecisionRelations = relations(committeeDecision, ({ one }) => ({
  candidacy: one(committeeCandidacy, {
    fields: [committeeDecision.candidacyId],
    references: [committeeCandidacy.id],
  }),
  redirectCommittee: one(committee, {
    fields: [committeeDecision.redirectCommitteeId],
    references: [committee.id],
  }),
  decider: one(user, {
    fields: [committeeDecision.decidedBy],
    references: [user.id],
  }),
}));

export const finalPlacementRelations = relations(finalPlacement, ({ one }) => ({
  application: one(application, {
    fields: [finalPlacement.applicationId],
    references: [application.id],
  }),
  committee: one(committee, {
    fields: [finalPlacement.committeeId],
    references: [committee.id],
  }),
  decider: one(user, {
    fields: [finalPlacement.decidedBy],
    references: [user.id],
  }),
}));
