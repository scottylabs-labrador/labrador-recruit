import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { committeeDecision } from "./decisions.ts";
import { answerType, applicantYear, candidacySource, candidacyStatus } from "./enums.ts";
import { committee, recruitmentCycle } from "./recruitment.ts";
import { reviewAssignment } from "./reviews.ts";

/**
 * The canonical person record, shared across cycles so a repeat applicant is
 * recognised. Identity is the normalised email; `email` stores it lowercased
 * and trimmed while `rawEmail` keeps exactly what the form supplied.
 */
export const applicant = pgTable(
  "applicant",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    rawEmail: text("raw_email").notNull(),
    fullName: text("full_name").notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [uniqueIndex("applicant_email_key").on(table.email)],
);

/** One applicant's submission to one cycle. */
export const application = pgTable(
  "application",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cycleId: uuid("cycle_id")
      .notNull()
      .references(() => recruitmentCycle.id, { onDelete: "cascade" }),
    applicantId: uuid("applicant_id")
      .notNull()
      .references(() => applicant.id, { onDelete: "cascade" }),

    submittedAt: timestamp("submitted_at"),
    major: text("major"),
    year: applicantYear("year").notNull().default("unknown"),
    rawYear: text("raw_year"),

    rankingExplanation: text("ranking_explanation"),

    /**
     * The applicant's request to be placed with friends. Displayed to
     * leadership but never an input to any score.
     */
    friendRequest: text("friend_request"),
    heardAboutScottylabs: text("heard_about_scottylabs"),

    /** The verbatim imported row, retained for audit and re-import debugging. */
    rawResponse: jsonb("raw_response").notNull(),

    sourceImportId: uuid("source_import_id"),
    sourceRowNumber: integer("source_row_number"),

    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("application_cycle_applicant_key").on(table.cycleId, table.applicantId),
    index("application_cycleId_idx").on(table.cycleId),
    index("application_applicantId_idx").on(table.applicantId),
  ],
);

/**
 * Describes one question on the form for one cycle, so the shape of the form
 * can change between seasons without a migration. The importer maps a
 * spreadsheet header to a stable `key` through this table.
 */
export const questionDefinition = pgTable(
  "question_definition",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cycleId: uuid("cycle_id")
      .notNull()
      .references(() => recruitmentCycle.id, { onDelete: "cascade" }),

    /** The spreadsheet column header exactly as exported. */
    externalHeader: text("external_header").notNull(),

    /** Stable identifier the application code refers to. */
    key: text("key").notNull(),

    /** Grouping for display, for example "general" or "committee". */
    section: text("section").notNull().default("general"),

    /** Set when the question only applies to one committee. */
    committeeId: uuid("committee_id").references(() => committee.id, { onDelete: "set null" }),

    questionText: text("question_text").notNull(),
    answerType: answerType("answer_type").notNull().default("long_text"),
    displayOrder: integer("display_order").notNull().default(0),

    /** Hidden from reviewers while a cycle runs in blind review mode. */
    isSensitive: boolean("is_sensitive").notNull().default(false),

    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("question_definition_cycle_key_key").on(table.cycleId, table.key),
    uniqueIndex("question_definition_cycle_header_key").on(table.cycleId, table.externalHeader),
    index("question_definition_cycleId_idx").on(table.cycleId),
    index("question_definition_committeeId_idx").on(table.committeeId),
  ],
);

/** One answer to one question. Absent rows mean the question was left blank. */
export const applicationAnswer = pgTable(
  "application_answer",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => application.id, { onDelete: "cascade" }),
    questionDefinitionId: uuid("question_definition_id")
      .notNull()
      .references(() => questionDefinition.id, { onDelete: "cascade" }),

    /** Rendered as text. Structured answers additionally populate `answerJson`. */
    answerText: text("answer_text"),
    answerJson: jsonb("answer_json"),

    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("application_answer_application_question_key").on(
      table.applicationId,
      table.questionDefinitionId,
    ),
    index("application_answer_applicationId_idx").on(table.applicationId),
    index("application_answer_questionDefinitionId_idx").on(table.questionDefinitionId),
  ],
);

/**
 * The rank an applicant gave one committee. Stored for every committee they
 * ranked, whether or not a candidacy was created, because the rank feeds the
 * deterministic preference component of the rubric.
 */
export const committeePreference = pgTable(
  "committee_preference",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => application.id, { onDelete: "cascade" }),
    committeeId: uuid("committee_id")
      .notNull()
      .references(() => committee.id, { onDelete: "cascade" }),

    /** 1 is the applicant's first choice. */
    rank: integer("rank").notNull(),

    /** The original label, for example "1st Choice". */
    rawRankLabel: text("raw_rank_label"),

    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("committee_preference_application_committee_key").on(
      table.applicationId,
      table.committeeId,
    ),
    index("committee_preference_applicationId_idx").on(table.applicationId),
    index("committee_preference_committeeId_idx").on(table.committeeId),
  ],
);

/**
 * An applicant being considered by one committee. This is the unit that
 * reviewers are assigned to and that decisions are made against, so an
 * applicant can be evaluated differently by Tech and by Labrador.
 */
export const committeeCandidacy = pgTable(
  "committee_candidacy",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => application.id, { onDelete: "cascade" }),
    committeeId: uuid("committee_id")
      .notNull()
      .references(() => committee.id, { onDelete: "cascade" }),

    /** Deactivated rather than deleted, so existing reviews are never orphaned. */
    active: boolean("active").notNull().default(true),
    source: candidacySource("source").notNull(),
    status: candidacyStatus("status").notNull().default("pending_assignment"),

    /**
     * Why the candidacy is flagged for another review. Null when it is not
     * flagged. Always human-readable, because the interface must be able to
     * state exactly why a candidate was flagged.
     */
    disagreementReason: text("disagreement_reason"),

    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("committee_candidacy_application_committee_key").on(
      table.applicationId,
      table.committeeId,
    ),
    index("committee_candidacy_applicationId_idx").on(table.applicationId),
    index("committee_candidacy_committeeId_idx").on(table.committeeId),
    index("committee_candidacy_status_idx").on(table.status),
  ],
);

export const applicantRelations = relations(applicant, ({ many }) => ({
  applications: many(application),
}));

export const applicationRelations = relations(application, ({ one, many }) => ({
  cycle: one(recruitmentCycle, {
    fields: [application.cycleId],
    references: [recruitmentCycle.id],
  }),
  applicant: one(applicant, {
    fields: [application.applicantId],
    references: [applicant.id],
  }),
  answers: many(applicationAnswer),
  preferences: many(committeePreference),
  candidacies: many(committeeCandidacy),
}));

export const questionDefinitionRelations = relations(questionDefinition, ({ one, many }) => ({
  cycle: one(recruitmentCycle, {
    fields: [questionDefinition.cycleId],
    references: [recruitmentCycle.id],
  }),
  committee: one(committee, {
    fields: [questionDefinition.committeeId],
    references: [committee.id],
  }),
  answers: many(applicationAnswer),
}));

export const applicationAnswerRelations = relations(applicationAnswer, ({ one }) => ({
  application: one(application, {
    fields: [applicationAnswer.applicationId],
    references: [application.id],
  }),
  question: one(questionDefinition, {
    fields: [applicationAnswer.questionDefinitionId],
    references: [questionDefinition.id],
  }),
}));

export const committeePreferenceRelations = relations(committeePreference, ({ one }) => ({
  application: one(application, {
    fields: [committeePreference.applicationId],
    references: [application.id],
  }),
  committee: one(committee, {
    fields: [committeePreference.committeeId],
    references: [committee.id],
  }),
}));

export const committeeCandidacyRelations = relations(committeeCandidacy, ({ one, many }) => ({
  application: one(application, {
    fields: [committeeCandidacy.applicationId],
    references: [application.id],
  }),
  committee: one(committee, {
    fields: [committeeCandidacy.committeeId],
    references: [committee.id],
  }),
  assignments: many(reviewAssignment),
  decision: one(committeeDecision),
}));
