import { relations, sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { application } from "./applications.ts";
import { user } from "./auth.ts";
import { applicationStatus, fileStatus, notificationStatus, statusEvent } from "./enums.ts";

/**
 * Every status change an application ever underwent.
 *
 * Append-only: never updated, never deleted. This table *is* the decision
 * history, and an offer, the applicant's acceptance of it, and confirmation of
 * membership are three separate rows rather than three values of one column —
 * the organization may need that workflow, and retrofitting it later would mean
 * rewriting history.
 */
export const applicationStatusEvent = pgTable(
  "application_status_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => application.id, { onDelete: "cascade" }),

    /** Null for the row that records creation. */
    oldStatus: applicationStatus("old_status"),
    newStatus: applicationStatus("new_status").notNull(),
    event: statusEvent("event").notNull(),

    /**
     * Null for an applicant-initiated change, and only for that.
     *
     * A withdrawal is the applicant's own act, and attributing it to whichever
     * staff member happened to be nearby would be a false record.
     *
     * `restrict` rather than `set null` for the same reason as
     * `audit_event.actor_user_id`, and here it is worse: because null already
     * *means* applicant-initiated, nulling a deleted staff member would convert
     * their decision into the applicant's own. That is a false record, not a
     * missing one.
     */
    changedBy: text("changed_by").references(() => user.id, { onDelete: "restrict" }),

    /** Internal. Never returned by a student endpoint. */
    note: text("note"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("application_status_event_applicationId_idx").on(table.applicationId),
    index("application_status_event_createdAt_idx").on(table.createdAt),
  ],
);

/**
 * An applicant upload, stored privately in object storage.
 *
 * The bytes never pass through the API: the browser gets a presigned PUT, and
 * this row records where they went. The object key is **not** a capability — the
 * bucket is private, so a leaked key is worth nothing without a presigned URL
 * the backend decided to issue.
 */
export const file = pgTable(
  "file",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    /** Set once the file is attached to an application. */
    applicationId: uuid("application_id").references(() => application.id, {
      onDelete: "cascade",
    }),

    /**
     * The object storage key. Opaque and generated.
     *
     * **Never derived from a user-supplied filename.** A filename is attacker
     * input and a key is a path.
     */
    objectKey: text("object_key").notNull(),

    /** For display only. Never joined to a path. */
    originalFilename: text("original_filename").notNull(),

    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),

    /**
     * `pending` until the backend has validated the upload.
     *
     * Submission refuses a file that is not `committed` and owned by the
     * submitting applicant, so an abandoned or borrowed upload can never be
     * attached to an application.
     */
    status: fileStatus("status").notNull().default("pending"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    committedAt: timestamp("committed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("file_object_key_key").on(table.objectKey),
    check("file_size_ck", sql`${table.sizeBytes} > 0`),
    index("file_ownerUserId_idx").on(table.ownerUserId),
    index("file_applicationId_idx").on(table.applicationId),
  ],
);

/**
 * Email waiting to be sent.
 *
 * Written inside the same transaction as the event that caused it, which is the
 * whole point: a failing email provider delays notifications and cannot fail an
 * application submission.
 */
export const notificationOutbox = pgTable(
  "notification_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    template: text("template").notNull(),
    recipientEmail: text("recipient_email").notNull(),

    /**
     * Template variables only.
     *
     * **No applicant response text**, and nothing the recipient does not already
     * hold. See `docs/product-rules.md` section 6. The worker never logs this.
     */
    payloadJson: jsonb("payload_json"),

    status: notificationStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    lastError: text("last_error"),

    /** Backoff. The worker skips rows not yet available. */
    availableAt: timestamp("available_at", { withTimezone: true }).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (table) => [
    check("notification_outbox_attempts_ck", sql`${table.attempts} >= 0`),

    // The worker's claim query orders by availability within pending rows.
    index("notification_outbox_claim_idx").on(table.status, table.availableAt),
  ],
);

/**
 * Security-sensitive and administrative history.
 *
 * Append-only. Records at minimum: permission changes, invitation creation and
 * acceptance, form publication, cycle transitions, decision changes, decision
 * release, sensitive exports, and administrative overrides.
 */
export const auditEvent = pgTable(
  "audit_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /**
     * Null for a genuine system action, and only for that.
     *
     * `restrict` rather than `set null`: nulling it on user deletion would
     * silently reclassify somebody's action as the system's, which is the exact
     * repudiation an audit log exists to prevent. A user who has acted cannot
     * be hard-deleted, which is the correct trade for a security log.
     */
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "restrict" }),

    /*
     * Scope, as plain ids with no foreign key.
     *
     * Deliberate. An audit trail that disappears with its subject is no audit
     * trail, and the moment somebody deletes a team or a cycle is exactly when
     * its history matters most. `action`, `subjectType` and `subjectId` already
     * record what was acted on, so a dangling scope id is still readable
     * evidence.
     */
    cycleId: uuid("cycle_id"),
    teamId: uuid("team_id"),

    /** Dotted, e.g. `grant.created`, `form_version.published`. */
    action: text("action").notNull(),

    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),

    /** No applicant content. */
    metadataJson: jsonb("metadata_json"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("audit_event_cycleId_idx").on(table.cycleId),
    index("audit_event_teamId_idx").on(table.teamId),
    index("audit_event_action_idx").on(table.action),
    index("audit_event_createdAt_idx").on(table.createdAt),
  ],
);

export const applicationStatusEventRelations = relations(applicationStatusEvent, ({ one }) => ({
  application: one(application, {
    fields: [applicationStatusEvent.applicationId],
    references: [application.id],
  }),
  actor: one(user, {
    fields: [applicationStatusEvent.changedBy],
    references: [user.id],
  }),
}));

export const fileRelations = relations(file, ({ one }) => ({
  owner: one(user, { fields: [file.ownerUserId], references: [user.id] }),
  application: one(application, {
    fields: [file.applicationId],
    references: [application.id],
  }),
}));

export const auditEventRelations = relations(auditEvent, ({ one }) => ({
  actor: one(user, { fields: [auditEvent.actorUserId], references: [user.id] }),
}));
