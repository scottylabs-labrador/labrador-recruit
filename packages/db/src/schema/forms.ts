import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth.ts";
import { recruitmentCycle, recruitmentOpening } from "./cycles.ts";
import { formKind, formVersionStatus, questionType } from "./enums.ts";
import { team } from "./org.ts";

/**
 * One logical form: a cycle's common form, or one committee's own.
 *
 * Both kinds share these tables, the renderer, and the validator. There is no
 * second code path, which is the only way the preview a director sees can be
 * guaranteed to match what a student sees.
 */
export const form = pgTable(
  "form",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cycleId: uuid("cycle_id")
      .notNull()
      .references(() => recruitmentCycle.id, { onDelete: "cascade" }),

    /** Null for a common form, which the organization owns. */
    teamId: uuid("team_id").references(() => team.id, { onDelete: "cascade" }),

    /** Null for a common form, which is scoped to the cycle rather than an opening. */
    openingId: uuid("opening_id").references(() => recruitmentOpening.id, {
      onDelete: "cascade",
    }),

    kind: formKind("kind").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    // A common form belongs to nobody in particular and a committee form belongs
    // to exactly one opening. A row that is neither shape would be a form whose
    // owner no service can agree on.
    check(
      "form_kind_owner_ck",
      sql`(${table.kind} = 'common' AND ${table.teamId} IS NULL AND ${table.openingId} IS NULL)
          OR (${table.kind} = 'committee' AND ${table.teamId} IS NOT NULL AND ${table.openingId} IS NOT NULL)`,
    ),

    // One common form per cycle, one committee form per opening. Partial,
    // because the `openingId` of every common form is NULL and Postgres treats
    // NULLs as distinct â€” so a plain unique index would catch neither case.
    uniqueIndex("form_common_per_cycle_key")
      .on(table.cycleId)
      .where(sql`${table.kind} = 'common'`),
    uniqueIndex("form_committee_per_opening_key")
      .on(table.openingId)
      .where(sql`${table.kind} = 'committee'`),

    index("form_cycleId_idx").on(table.cycleId),
    index("form_openingId_idx").on(table.openingId),
  ],
);

/**
 * A snapshot of a form's questions.
 *
 * The central integrity rule of the whole product lives here: **a published
 * version is immutable.** Editing creates a new draft, and a `form_response`
 * names the exact version it was answered against, so an answer can always be
 * read back against the question as it was actually asked.
 *
 * The database enforces one draft per form and the version numbering. The
 * immutability of a published row is enforced by `formService` â€” see #17 â€”
 * because Postgres has no "no further updates" constraint short of a trigger,
 * and a trigger here would be a rule hidden from everybody reading the service.
 */
export const formVersion = pgTable(
  "form_version",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    formId: uuid("form_id")
      .notNull()
      .references(() => form.id, { onDelete: "cascade" }),

    /** Monotonic per form, starting at 1. */
    version: integer("version").notNull(),
    status: formVersionStatus("status").notNull().default("draft"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),

    /** Null while draft. Set exactly when the version is published. */
    publishedAt: timestamp("published_at"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("form_version_form_version_key").on(table.formId, table.version),

    // At most one draft per form, so "the draft" is never ambiguous in a service
    // that loads it by form.
    uniqueIndex("form_version_one_draft_key")
      .on(table.formId)
      .where(sql`${table.status} = 'draft'`),

    // A published version without a timestamp cannot be ordered against its
    // siblings, and "when did this question start being asked" is a question
    // somebody will need to answer about a real applicant.
    check(
      "form_version_published_at_ck",
      sql`(${table.status} = 'published' AND ${table.publishedAt} IS NOT NULL)
          OR (${table.status} <> 'published' AND ${table.publishedAt} IS NULL)`,
    ),

    check("form_version_version_ck", sql`${table.version} > 0`),
    index("form_version_formId_idx").on(table.formId),
  ],
);

/**
 * One question, in one version of one form.
 *
 * `questionKey` is the stable logical identity that carries across versions â€”
 * it is what lets somebody compare an answer given to `why-labrador` in Fall
 * 2026 against the same question in Spring 2027. The row id does not carry
 * across, because the row genuinely is a different question definition.
 */
export const question = pgTable(
  "question",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    formVersionId: uuid("form_version_id")
      .notNull()
      .references(() => formVersion.id, { onDelete: "cascade" }),

    /** Stable across versions; unique within one. */
    questionKey: text("question_key").notNull(),
    type: questionType("type").notNull(),
    label: text("label").notNull(),
    description: text("description"),
    required: boolean("required").notNull().default(false),

    /** Ordering within the form, and the order conditional rules are evaluated in. */
    position: integer("position").notNull(),

    /**
     * Type-specific configuration: choices, length bounds, allowed MIME types,
     * placeholder.
     *
     * JSONB rather than a column per setting, because the set of settings grows
     * with the question types and a migration per setting would make adding a
     * type a schema change.
     */
    configJson: jsonb("config_json"),

    /**
     * A structured conditional-visibility rule, or null for always visible.
     *
     * **Structured data, never executable code.** It is evaluated by one shared
     * function in `packages/common` â€” used by the browser renderer and by the
     * server submission validator â€” so the two cannot disagree about whether a
     * question was required. A rule stored as code would have to be run
     * somewhere, and that somewhere would be a sandbox we would then own.
     *
     * A rule may only reference keys earlier in `position` order within the same
     * version. That is checked at publish time, because a forward reference
     * cannot be resolved in the single pass the evaluator makes.
     */
    visibilityRuleJson: jsonb("visibility_rule_json"),
  },
  (table) => [
    uniqueIndex("question_version_key_key").on(table.formVersionId, table.questionKey),

    // Deterministic ordering. Conditional rules are evaluated in a single pass
    // in position order, so an ambiguous order is an ambiguous rule.
    uniqueIndex("question_version_position_key").on(table.formVersionId, table.position),

    // The parent side of `answer`'s composite foreign key, so the database can
    // check that an answer's question really belongs to its declared version.
    //
    // A UNIQUE *constraint* rather than a unique index, because drizzle emits
    // constraints inline in CREATE TABLE and indexes afterwards — and it emits
    // every foreign key between the two. A unique index here would not exist
    // yet when `answer`'s foreign key is added, and the migration fails.
    unique("question_version_id_key").on(table.formVersionId, table.id),

    check("question_position_ck", sql`${table.position} > 0`),
    index("question_formVersionId_idx").on(table.formVersionId),
  ],
);

export const formRelations = relations(form, ({ one, many }) => ({
  cycle: one(recruitmentCycle, { fields: [form.cycleId], references: [recruitmentCycle.id] }),
  team: one(team, { fields: [form.teamId], references: [team.id] }),
  opening: one(recruitmentOpening, {
    fields: [form.openingId],
    references: [recruitmentOpening.id],
  }),
  versions: many(formVersion),
}));

export const formVersionRelations = relations(formVersion, ({ one, many }) => ({
  form: one(form, { fields: [formVersion.formId], references: [form.id] }),
  author: one(user, { fields: [formVersion.createdBy], references: [user.id] }),
  questions: many(question),
}));

export const questionRelations = relations(question, ({ one }) => ({
  version: one(formVersion, {
    fields: [question.formVersionId],
    references: [formVersion.id],
  }),
}));
