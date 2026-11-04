import { relations, sql } from "drizzle-orm";
import {
  check,
  foreignKey,
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
import { applicationStatus, formResponseStatus } from "./enums.ts";
import { formVersion, question } from "./forms.ts";

/**
 * A person's participation in one cycle.
 *
 * The anchor the common answers hang off, so they are given once per cycle
 * rather than once per committee.
 */
export const candidateProfile = pgTable(
  "candidate_profile",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    cycleId: uuid("cycle_id")
      .notNull()
      .references(() => recruitmentCycle.id, { onDelete: "cascade" }),

    /**
     * Set on the first successful final submission.
     *
     * After this, the common answers change only through an audited correction
     * flow. Without it, a student editing their common answers in week three
     * would retroactively change an application a committee already read.
     */
    commonLockedAt: timestamp("common_locked_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("candidate_profile_user_cycle_key").on(table.userId, table.cycleId),
    index("candidate_profile_cycleId_idx").on(table.cycleId),
  ],
);

/**
 * One application to one opening.
 *
 * The unit of review, the unit of decision, and the unit of committee scoping.
 * v1 generated separate "candidacy" rows from a submitted preference ranking;
 * students now apply directly, so an application *is* the candidacy and that
 * table is gone.
 */
export const application = pgTable(
  "application",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidateProfileId: uuid("candidate_profile_id")
      .notNull()
      .references(() => candidateProfile.id, { onDelete: "cascade" }),
    openingId: uuid("opening_id")
      .notNull()
      .references(() => recruitmentOpening.id, { onDelete: "cascade" }),

    /**
     * The internal status.
     *
     * What an applicant sees is a *projection* of this, not this column:
     * `shortlisted` surfaces to them as "Under Review". Track A writes up to
     * `submitted`; Track B writes everything after.
     */
    status: applicationStatus("status").notNull().default("draft"),

    /** The applicant's own ranking of this committee, when the cycle asks. */
    preferenceRank: integer("preference_rank"),

    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),

    /**
     * Guards duplicate submission.
     *
     * A constraint rather than a disabled button: a double-tap on a flaky campus
     * connection must not create two submissions or send two confirmation
     * emails.
     */
    idempotencyKey: text("idempotency_key"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("application_profile_opening_key").on(table.candidateProfileId, table.openingId),

    /*
     * Scoped to the applicant, not global.
     *
     * The key is client-supplied. Globally unique, one applicant could burn
     * another's key — making a real submission look like a replay of somebody
     * else's — and could probe for collisions to learn a key is in use. Replay
     * lookups must filter by the authenticated caller's profile too.
     *
     * Partial, because most applications carry no key at all.
     */
    uniqueIndex("application_profile_idempotency_key")
      .on(table.candidateProfileId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),

    check(
      "application_preference_rank_ck",
      sql`${table.preferenceRank} IS NULL OR ${table.preferenceRank} > 0`,
    ),

    index("application_candidateProfileId_idx").on(table.candidateProfileId),
    index("application_openingId_idx").on(table.openingId),
    index("application_status_idx").on(table.status),
  ],
);

/**
 * A set of answers to one form version.
 *
 * Exactly one owner: a common response belongs to a `candidate_profile`, a
 * committee response to an `application`. A row claiming both would be
 * ambiguous to every service that loads "the common answers".
 */
export const formResponse = pgTable(
  "form_response",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /**
     * The exact version these answers were given against.
     *
     * This is what makes an answer readable back against the question as it was
     * actually asked, however many times the form has been republished since.
     */
    formVersionId: uuid("form_version_id")
      .notNull()
      .references(() => formVersion.id, { onDelete: "restrict" }),

    candidateProfileId: uuid("candidate_profile_id").references(() => candidateProfile.id, {
      onDelete: "cascade",
    }),
    applicationId: uuid("application_id").references(() => application.id, {
      onDelete: "cascade",
    }),

    status: formResponseStatus("status").notNull().default("draft"),

    /**
     * Optimistic concurrency for draft writes.
     *
     * A draft write carries the revision it read, and a stale one is refused
     * rather than applied. A student with a laptop and a phone both autosaving
     * is the ordinary case, not an edge case, and silently taking the last write
     * loses whichever answers the slower tab did not have.
     */
    revision: integer("revision").notNull().default(0),

    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    check(
      "form_response_single_owner_ck",
      sql`(${table.candidateProfileId} IS NOT NULL AND ${table.applicationId} IS NULL)
          OR (${table.candidateProfileId} IS NULL AND ${table.applicationId} IS NOT NULL)`,
    ),

    uniqueIndex("form_response_profile_version_key")
      .on(table.candidateProfileId, table.formVersionId)
      .where(sql`${table.candidateProfileId} IS NOT NULL`),
    uniqueIndex("form_response_application_version_key")
      .on(table.applicationId, table.formVersionId)
      .where(sql`${table.applicationId} IS NOT NULL`),

    // The parent side of `answer`'s composite foreign key, so the database can
    // check that an answer's declared version really is its response's.
    //
    // A UNIQUE *constraint* rather than a unique index: drizzle emits
    // constraints inline in CREATE TABLE and indexes afterwards, with every
    // foreign key in between. As an index this does not exist yet when
    // `answer`'s foreign key is added, and the migration fails outright.
    unique("form_response_id_version_key").on(table.id, table.formVersionId),

    check(
      "form_response_submitted_at_ck",
      sql`(${table.status} = 'submitted' AND ${table.submittedAt} IS NOT NULL)
          OR (${table.status} <> 'submitted' AND ${table.submittedAt} IS NULL)`,
    ),

    index("form_response_formVersionId_idx").on(table.formVersionId),
  ],
);

/**
 * One answer to one question.
 *
 * `formVersionId` is denormalized here on purpose. It is not redundant data
 * waiting to drift — it is the column that lets two composite foreign keys
 * close the loop:
 *
 * 1. `(form_response_id, form_version_id)` must match a real response, so the
 *    declared version genuinely is that response's.
 * 2. `(form_version_id, question_id)` must match a real question, so the
 *    question genuinely belongs to that version.
 *
 * Together those make it impossible for an answer to reference a question from
 * **a different version than its own response's**. The database refuses it
 * outright rather than a service having to remember to.
 *
 * What this does **not** yet guarantee, and a reader should not assume it does:
 * that a committee response's form belongs to the same opening as its
 * application. The chains `form_response -> application -> opening` and
 * `form_response -> form_version -> form -> opening` are not tied together
 * compositely, so a service bug could attach one committee's form response to
 * another committee's application. `applicationService` checks it, with a test
 * (#19); enforcing it in the schema would mean carrying `opening_id` onto
 * `form_response`, which a common response does not have. Recorded here rather
 * than left as a claim the schema does not back.
 */
export const answer = pgTable(
  "answer",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    formResponseId: uuid("form_response_id").notNull(),
    formVersionId: uuid("form_version_id").notNull(),
    questionId: uuid("question_id").notNull(),

    /**
     * The answer value.
     *
     * JSONB because the shape follows the question type — a string, a number, an
     * array of choices, a file reference. A column per type would mean a
     * migration every time a question type is added.
     *
     * Large files never live here. A `file_upload` answer stores a reference to
     * a `file` row.
     */
    valueJsonb: jsonb("value_jsonb"),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "answer_response_version_fk",
      columns: [table.formResponseId, table.formVersionId],
      foreignColumns: [formResponse.id, formResponse.formVersionId],
    }).onDelete("cascade"),

    /*
     * `restrict`, not `cascade`.
     *
     * Cascading would mean a deleted question silently takes an applicant's
     * answer with it — and an answer is the one thing here that cannot be
     * recomputed. A published version is immutable, so nothing should be
     * deleting its questions; making the database refuse turns a service bug
     * into an error instead of quiet data loss. Draft versions carry no
     * answers, so editing a draft is unaffected.
     */
    foreignKey({
      name: "answer_version_question_fk",
      columns: [table.formVersionId, table.questionId],
      foreignColumns: [question.formVersionId, question.id],
    }).onDelete("restrict"),

    uniqueIndex("answer_response_question_key").on(table.formResponseId, table.questionId),
    index("answer_formResponseId_idx").on(table.formResponseId),
  ],
);

export const candidateProfileRelations = relations(candidateProfile, ({ one, many }) => ({
  user: one(user, { fields: [candidateProfile.userId], references: [user.id] }),
  cycle: one(recruitmentCycle, {
    fields: [candidateProfile.cycleId],
    references: [recruitmentCycle.id],
  }),
  applications: many(application),
}));

export const applicationRelations = relations(application, ({ one }) => ({
  profile: one(candidateProfile, {
    fields: [application.candidateProfileId],
    references: [candidateProfile.id],
  }),
  opening: one(recruitmentOpening, {
    fields: [application.openingId],
    references: [recruitmentOpening.id],
  }),
}));

export const formResponseRelations = relations(formResponse, ({ one, many }) => ({
  version: one(formVersion, {
    fields: [formResponse.formVersionId],
    references: [formVersion.id],
  }),
  profile: one(candidateProfile, {
    fields: [formResponse.candidateProfileId],
    references: [candidateProfile.id],
  }),
  application: one(application, {
    fields: [formResponse.applicationId],
    references: [application.id],
  }),
  answers: many(answer),
}));

export const answerRelations = relations(answer, ({ one }) => ({
  question: one(question, { fields: [answer.questionId], references: [question.id] }),
}));
