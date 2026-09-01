import { relations } from "drizzle-orm";
import {
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
import { importRowStatus, importStatus } from "./enums.ts";
import { recruitmentCycle } from "./recruitment.ts";

/**
 * One uploaded spreadsheet. Named `import_batch` because `import` is reserved
 * in both SQL and TypeScript.
 */
export const importBatch = pgTable(
  "import_batch",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cycleId: uuid("cycle_id")
      .notNull()
      .references(() => recruitmentCycle.id, { onDelete: "cascade" }),

    filename: text("filename").notNull(),
    status: importStatus("status").notNull().default("pending"),

    /**
     * The header-to-question mapping this batch was committed under, so a
     * later re-import can be compared against it.
     */
    headerMapping: jsonb("header_mapping"),

    rowCount: integer("row_count").notNull().default(0),
    successCount: integer("success_count").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),

    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    committedAt: timestamp("committed_at"),

    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("import_batch_cycleId_idx").on(table.cycleId),
    index("import_batch_status_idx").on(table.status),
  ],
);

/**
 * The outcome of one spreadsheet row. A malformed row records an error here
 * and is skipped, so one bad row never fails an otherwise valid batch.
 */
export const importRow = pgTable(
  "import_row",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    importId: uuid("import_id")
      .notNull()
      .references(() => importBatch.id, { onDelete: "cascade" }),

    sourceRowNumber: integer("source_row_number").notNull(),
    rawJson: jsonb("raw_json").notNull(),

    /** Hash of the normalised row, used to detect an unchanged re-import. */
    rowHash: text("row_hash").notNull(),

    status: importRowStatus("status").notNull().default("pending"),
    errorMessage: text("error_message"),

    applicationId: uuid("application_id").references(() => application.id, {
      onDelete: "set null",
    }),

    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("import_row_import_rownum_key").on(table.importId, table.sourceRowNumber),
    index("import_row_importId_idx").on(table.importId),
    index("import_row_applicationId_idx").on(table.applicationId),
    index("import_row_status_idx").on(table.status),
  ],
);

export const importBatchRelations = relations(importBatch, ({ one, many }) => ({
  cycle: one(recruitmentCycle, {
    fields: [importBatch.cycleId],
    references: [recruitmentCycle.id],
  }),
  creator: one(user, {
    fields: [importBatch.createdBy],
    references: [user.id],
  }),
  rows: many(importRow),
}));

export const importRowRelations = relations(importRow, ({ one }) => ({
  batch: one(importBatch, {
    fields: [importRow.importId],
    references: [importBatch.id],
  }),
  application: one(application, {
    fields: [importRow.applicationId],
    references: [application.id],
  }),
}));
