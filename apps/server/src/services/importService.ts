import type { RecruitmentUser } from "@labrador/access-control";
import { canImportApplications } from "@labrador/access-control";
import {
  applicant,
  application,
  applicationAnswer,
  committee,
  committeeCandidacy,
  committeePreference,
  cycleCommittee,
  importBatch,
  importRow,
  questionDefinition,
  recruitmentCycle,
} from "@labrador/db/schema";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "../lib/db.ts";
import { detectMapping } from "../lib/import/headerMap.ts";
import { normalizeRow } from "../lib/import/normalizeRow.ts";
import { parseCsv, parseXlsx } from "../lib/import/parseWorkbook.ts";
import type {
  HeaderMapping,
  NormalizedApplication,
  ParsedSheet,
  RawRow,
} from "../lib/import/types.ts";
import { HttpError } from "../middlewares/errorHandler.ts";
import { recordAuditEvent } from "./auditService.ts";

/**
 * One row that could not be used, and why.
 *
 * Deliberately carries no applicant content - only the row number and the
 * columns at fault - because the preview screen renders exactly this and
 * nothing more.
 */
export interface ImportRowFailure {
  sourceRowNumber: number;
  errors: Array<{ column: string; field: string; message: string; value: string | null }>;
}

/**
 * What the admin needs to decide whether to commit.
 *
 * Excludes the parsed applications for rows that parsed cleanly. The importer
 * produces them, but sending them would put every answer of every applicant on
 * the wire to a screen that displays counts and failures, which product rule 6
 * asks us not to do.
 */
export interface ImportPreviewSummary {
  sheetName: string;
  mapping: HeaderMapping;
  rowCount: number;
  okCount: number;
  errorCount: number;
  failures: ImportRowFailure[];
  duplicateEmails: string[];
}

/**
 * An import as the history list shows it. Named rather than inferred because
 * tsoa flattened the inline shape and emitted `committedAt` as a required
 * string, though a batch that has only been previewed has no commit time.
 */
export interface ImportSummary {
  id: string;
  filename: string;
  status: string;
  rowCount: number;
  successCount: number;
  errorCount: number;
  committedAt: Date | null;
  createdAt: Date;
}

export interface ImportCommitReport {
  importId: string;
  rowCount: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  candidaciesCreated: number;
  /** Committee slugs in the file that this cycle does not run. */
  unknownCommitteeSlugs: string[];
}

/**
 * Uploads arrive base64-encoded in the JSON body rather than as multipart, so
 * the server needs no file-upload middleware for a form export that is well
 * under the body limit.
 */
async function parseUpload(filename: string, contentBase64: string): Promise<ParsedSheet> {
  const lower = filename.toLowerCase();
  const buffer = Buffer.from(contentBase64, "base64");

  if (lower.endsWith(".xlsx")) {
    return parseXlsx(buffer);
  }
  if (lower.endsWith(".csv")) {
    return parseCsv(buffer.toString("utf8"));
  }
  throw new HttpError(422, "Only .xlsx and .csv files are supported");
}

/**
 * Ensures a `question_definition` exists for every mapped answer column.
 *
 * Definitions are per cycle, so a form that changes between seasons produces a
 * new set rather than mutating the questions historical answers point at.
 */
async function upsertQuestionDefinitions(
  cycleId: string,
  mapping: HeaderMapping,
  committeeIdBySlug: Map<string, string>,
): Promise<Map<string, string>> {
  const answerFields = mapping.fields.filter(
    (field) => field.role === "answer" || field.role === "identity",
  );

  const now = new Date();
  const idByKey = new Map<string, string>();

  for (const [index, field] of answerFields.entries()) {
    const committeeId = field.committeeSlug
      ? (committeeIdBySlug.get(field.committeeSlug) ?? null)
      : null;

    const [row] = await db
      .insert(questionDefinition)
      .values({
        cycleId,
        externalHeader: field.header,
        key: field.key,
        section: field.section,
        committeeId,
        questionText: field.header,
        answerType: field.answerType,
        displayOrder: index,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [questionDefinition.cycleId, questionDefinition.key],
        set: {
          externalHeader: field.header,
          section: field.section,
          committeeId,
          answerType: field.answerType,
          displayOrder: index,
          updatedAt: now,
        },
      })
      .returning({ id: questionDefinition.id, key: questionDefinition.key });

    if (row) {
      idByKey.set(row.key, row.id);
    }
  }

  return idByKey;
}

export const importService = {
  /**
   * Parses an upload, stores every raw row, and returns a preview.
   *
   * Nothing touches the application tables here. An admin confirms the mapping
   * first, which is the only chance to catch a renamed column before it becomes
   * a silently missing answer.
   */
  createImport: async (
    acUser: RecruitmentUser,
    cycleId: string,
    filename: string,
    contentBase64: string,
  ): Promise<{ importId: string; preview: ImportPreviewSummary }> => {
    if (!canImportApplications({ user: acUser })) {
      throw new HttpError(403, "You are not allowed to import applications");
    }

    const [cycle] = await db
      .select({ id: recruitmentCycle.id, status: recruitmentCycle.status })
      .from(recruitmentCycle)
      .where(eq(recruitmentCycle.id, cycleId));

    if (!cycle) {
      throw new HttpError(404, "Cycle not found");
    }
    if (cycle.status === "archived") {
      throw new HttpError(409, "This cycle is archived and is read-only");
    }

    const sheet = await parseUpload(filename, contentBase64);
    const mapping = detectMapping(sheet.headers);
    const results = sheet.rows.map((row) => normalizeRow(row, mapping));

    const okCount = results.filter((result) => result.ok).length;
    const seen = new Map<string, number>();
    for (const result of results) {
      if (!result.ok) continue;
      seen.set(result.application.email, (seen.get(result.application.email) ?? 0) + 1);
    }
    const duplicateEmails = [...seen.entries()]
      .filter(([, count]) => count > 1)
      .map(([email]) => email);

    const now = new Date();
    const [batch] = await db
      .insert(importBatch)
      .values({
        cycleId,
        filename,
        status: "previewed",
        headerMapping: mapping as unknown as Record<string, unknown>,
        rowCount: sheet.rows.length,
        successCount: okCount,
        errorCount: sheet.rows.length - okCount,
        createdBy: acUser.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!batch) {
      throw new HttpError(500, "Failed to record the import");
    }

    // Persist raw rows verbatim so a commit never depends on the file being
    // re-uploaded, and so an import can be debugged after the fact.
    if (sheet.rows.length > 0) {
      await db.insert(importRow).values(
        sheet.rows.map((row, index) => {
          const result = results[index];
          return {
            importId: batch.id,
            sourceRowNumber: row.sourceRowNumber,
            rawJson: row as unknown as Record<string, unknown>,
            rowHash:
              result && !result.ok ? result.rowHash : result?.ok ? result.application.rowHash : "",
            status: result?.ok ? ("pending" as const) : ("error" as const),
            errorMessage:
              result && !result.ok
                ? result.errors.map((e) => `${e.column}: ${e.message}`).join("; ")
                : null,
            createdAt: now,
            updatedAt: now,
          };
        }),
      );
    }

    await recordAuditEvent({
      cycleId,
      actorUserId: acUser.id,
      action: "import.previewed",
      entityType: "import_batch",
      entityId: batch.id,
      metadata: { filename, rowCount: sheet.rows.length, errorCount: sheet.rows.length - okCount },
    });

    return {
      importId: batch.id,
      preview: {
        sheetName: sheet.sheetName,
        mapping,
        rowCount: sheet.rows.length,
        okCount,
        errorCount: sheet.rows.length - okCount,
        failures: results
          .filter((result) => !result.ok)
          .map((result) => ({
            sourceRowNumber: result.sourceRowNumber,
            errors: result.ok ? [] : result.errors,
          })),
        duplicateEmails,
      },
    };
  },

  /**
   * Commits a previewed import.
   *
   * Idempotent on `cycle + normalised email`. Re-importing updates the
   * application's own fields and answers, and adds any missing candidacy, but
   * never deletes a candidacy and never touches a review: human work is not
   * the importer's to discard.
   */
  commitImport: async (acUser: RecruitmentUser, importId: string): Promise<ImportCommitReport> => {
    if (!canImportApplications({ user: acUser })) {
      throw new HttpError(403, "You are not allowed to import applications");
    }

    const [batch] = await db.select().from(importBatch).where(eq(importBatch.id, importId));

    if (!batch) {
      throw new HttpError(404, "Import not found");
    }
    if (batch.status === "committed") {
      throw new HttpError(409, "This import has already been committed");
    }

    const [cycle] = await db
      .select({
        id: recruitmentCycle.id,
        candidacyTopN: recruitmentCycle.candidacyTopN,
        includeOptIns: recruitmentCycle.candidacyIncludeOptIns,
      })
      .from(recruitmentCycle)
      .where(eq(recruitmentCycle.id, batch.cycleId));

    if (!cycle) {
      throw new HttpError(404, "Cycle not found");
    }

    const committees = await db
      .select({ id: committee.id, slug: committee.slug })
      .from(cycleCommittee)
      .innerJoin(committee, eq(cycleCommittee.committeeId, committee.id))
      .where(eq(cycleCommittee.cycleId, batch.cycleId));

    const committeeIdBySlug = new Map(committees.map((row) => [row.slug, row.id]));

    const mapping = batch.headerMapping as unknown as HeaderMapping;
    const questionIdByKey = await upsertQuestionDefinitions(
      batch.cycleId,
      mapping,
      committeeIdBySlug,
    );

    const storedRows = await db.select().from(importRow).where(eq(importRow.importId, importId));

    const report: ImportCommitReport = {
      importId,
      rowCount: storedRows.length,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
      candidaciesCreated: 0,
      unknownCommitteeSlugs: [],
    };

    const unknownSlugs = new Set<string>();
    const now = new Date();

    for (const stored of storedRows) {
      if (stored.status === "error") {
        report.errors += 1;
        continue;
      }

      const result = normalizeRow(stored.rawJson as unknown as RawRow, mapping);
      if (!result.ok) {
        report.errors += 1;
        await db
          .update(importRow)
          .set({
            status: "error",
            errorMessage: result.errors.map((e) => `${e.column}: ${e.message}`).join("; "),
            updatedAt: now,
          })
          .where(eq(importRow.id, stored.id));
        continue;
      }

      const outcome = await importService.upsertApplication(
        batch.cycleId,
        result.application,
        committeeIdBySlug,
        questionIdByKey,
        { candidacyTopN: cycle.candidacyTopN, includeOptIns: cycle.includeOptIns },
        unknownSlugs,
        now,
      );

      report[outcome.action] += 1;
      report.candidaciesCreated += outcome.candidaciesCreated;

      await db
        .update(importRow)
        .set({
          status: outcome.action === "created" ? "imported" : "updated",
          applicationId: outcome.applicationId,
          errorMessage: null,
          updatedAt: now,
        })
        .where(eq(importRow.id, stored.id));
    }

    report.unknownCommitteeSlugs = [...unknownSlugs];

    await db
      .update(importBatch)
      .set({
        status: "committed",
        committedAt: now,
        successCount: report.created + report.updated,
        errorCount: report.errors,
        updatedAt: now,
      })
      .where(eq(importBatch.id, importId));

    await recordAuditEvent({
      cycleId: batch.cycleId,
      actorUserId: acUser.id,
      action: "import.committed",
      entityType: "import_batch",
      entityId: importId,
      metadata: {
        created: report.created,
        updated: report.updated,
        errors: report.errors,
        candidaciesCreated: report.candidaciesCreated,
      },
    });

    return report;
  },

  /** Writes one normalised row. Extracted so the commit loop stays readable. */
  upsertApplication: async (
    cycleId: string,
    normalized: NormalizedApplication,
    committeeIdBySlug: Map<string, string>,
    questionIdByKey: Map<string, string>,
    settings: { candidacyTopN: number; includeOptIns: boolean },
    unknownSlugs: Set<string>,
    now: Date,
  ): Promise<{
    action: "created" | "updated" | "skipped";
    applicationId: string;
    candidaciesCreated: number;
  }> => {
    const [person] = await db
      .insert(applicant)
      .values({
        email: normalized.email,
        rawEmail: normalized.rawEmail,
        fullName: normalized.fullName,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: applicant.email,
        set: { fullName: normalized.fullName, rawEmail: normalized.rawEmail, updatedAt: now },
      })
      .returning();

    if (!person) {
      throw new HttpError(500, `Failed to upsert applicant ${normalized.email}`);
    }

    const [existing] = await db
      .select({ id: application.id })
      .from(application)
      .where(and(eq(application.cycleId, cycleId), eq(application.applicantId, person.id)));

    const [applicationRow] = await db
      .insert(application)
      .values({
        cycleId,
        applicantId: person.id,
        year: normalized.year,
        rawYear: normalized.rawYear,
        major: normalized.major,
        rankingExplanation: normalized.rankingExplanation,
        friendRequest: normalized.friendRequest,
        heardAboutScottylabs: normalized.heardAboutScottylabs,
        rawResponse: {} as Record<string, unknown>,
        sourceRowNumber: normalized.sourceRowNumber,
        submittedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [application.cycleId, application.applicantId],
        set: {
          year: normalized.year,
          rawYear: normalized.rawYear,
          major: normalized.major,
          rankingExplanation: normalized.rankingExplanation,
          friendRequest: normalized.friendRequest,
          heardAboutScottylabs: normalized.heardAboutScottylabs,
          sourceRowNumber: normalized.sourceRowNumber,
          updatedAt: now,
        },
      })
      .returning();

    if (!applicationRow) {
      throw new HttpError(500, `Failed to upsert application for ${normalized.email}`);
    }

    for (const answer of normalized.answers) {
      const questionId = questionIdByKey.get(answer.questionKey);
      if (!questionId) continue;

      await db
        .insert(applicationAnswer)
        .values({
          applicationId: applicationRow.id,
          questionDefinitionId: questionId,
          answerText: answer.answerText,
          answerJson: answer.answerJson ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [applicationAnswer.applicationId, applicationAnswer.questionDefinitionId],
          set: {
            answerText: answer.answerText,
            answerJson: answer.answerJson ?? null,
            updatedAt: now,
          },
        });
    }

    const rankedSlugs: Array<{ slug: string; rank: number }> = [];
    for (const [slug, entry] of Object.entries(normalized.committeePreferences)) {
      const committeeId = committeeIdBySlug.get(slug);
      if (!committeeId) {
        unknownSlugs.add(slug);
        continue;
      }
      rankedSlugs.push({ slug, rank: entry.rank });

      await db
        .insert(committeePreference)
        .values({
          applicationId: applicationRow.id,
          committeeId,
          rank: entry.rank,
          rawRankLabel: entry.rawLabel,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [committeePreference.applicationId, committeePreference.committeeId],
          set: { rank: entry.rank, rawRankLabel: entry.rawLabel, updatedAt: now },
        });
    }

    // Candidacies for the top N, plus any committee whose questions they chose
    // to answer when the cycle is configured to include opt-ins.
    const topSlugs = rankedSlugs
      .sort((a, b) => a.rank - b.rank)
      .slice(0, settings.candidacyTopN)
      .map((entry) => entry.slug);

    const optInSlugs = settings.includeOptIns
      ? Object.entries(normalized.committeeOptIns)
          .filter(([, optedIn]) => optedIn)
          .map(([slug]) => slug)
      : [];

    const wanted = [...new Set([...topSlugs, ...optInSlugs])];

    const already = await db
      .select({ committeeId: committeeCandidacy.committeeId })
      .from(committeeCandidacy)
      .where(eq(committeeCandidacy.applicationId, applicationRow.id));
    const existingCommitteeIds = new Set(already.map((row) => row.committeeId));

    let candidaciesCreated = 0;
    for (const slug of wanted) {
      const committeeId = committeeIdBySlug.get(slug);
      if (!committeeId) {
        unknownSlugs.add(slug);
        continue;
      }
      if (existingCommitteeIds.has(committeeId)) continue;

      await db.insert(committeeCandidacy).values({
        applicationId: applicationRow.id,
        committeeId,
        source: topSlugs.includes(slug) ? "top_preference" : "committee_question_opt_in",
        createdAt: now,
        updatedAt: now,
      });
      candidaciesCreated += 1;
    }

    return {
      action: existing ? "updated" : "created",
      applicationId: applicationRow.id,
      candidaciesCreated,
    };
  },

  /** Routes keyed by an import still need its cycle to resolve the caller. */
  getCycleIdForImport: async (importId: string): Promise<string | null> => {
    const [row] = await db
      .select({ cycleId: importBatch.cycleId })
      .from(importBatch)
      .where(eq(importBatch.id, importId));
    return row?.cycleId ?? null;
  },

  listImports: async (acUser: RecruitmentUser, cycleId: string): Promise<ImportSummary[]> => {
    if (!canImportApplications({ user: acUser })) {
      throw new HttpError(403, "You are not allowed to view imports");
    }

    return db
      .select({
        id: importBatch.id,
        filename: importBatch.filename,
        status: importBatch.status,
        rowCount: importBatch.rowCount,
        successCount: importBatch.successCount,
        errorCount: importBatch.errorCount,
        committedAt: importBatch.committedAt,
        createdAt: importBatch.createdAt,
      })
      .from(importBatch)
      .where(eq(importBatch.cycleId, cycleId));
  },

  /** Per-row outcomes for one import, so an admin can fix and re-upload. */
  listImportRows: async (acUser: RecruitmentUser, importId: string) => {
    if (!canImportApplications({ user: acUser })) {
      throw new HttpError(403, "You are not allowed to view imports");
    }

    return db
      .select({
        sourceRowNumber: importRow.sourceRowNumber,
        status: importRow.status,
        errorMessage: importRow.errorMessage,
        applicationId: importRow.applicationId,
      })
      .from(importRow)
      .where(eq(importRow.importId, importId));
  },
};

/** Exported for tests that need to confirm nothing outside a cycle is touched. */
export async function countApplicationsInCycle(cycleId: string): Promise<number> {
  const rows = await db
    .select({ id: application.id })
    .from(application)
    .where(eq(application.cycleId, cycleId));
  return rows.length;
}

/** Exported for tests asserting that answers survive a re-import unchanged. */
export async function listAnswerKeys(applicationId: string): Promise<string[]> {
  const rows = await db
    .select({ key: questionDefinition.key })
    .from(applicationAnswer)
    .innerJoin(
      questionDefinition,
      eq(applicationAnswer.questionDefinitionId, questionDefinition.id),
    )
    .where(eq(applicationAnswer.applicationId, applicationId));

  return rows.map((row) => row.key).sort();
}

/** Exported so a test can assert candidacies are additive across re-imports. */
export async function listCandidacyCommitteeIds(applicationId: string): Promise<string[]> {
  const rows = await db
    .select({ committeeId: committeeCandidacy.committeeId })
    .from(committeeCandidacy)
    .where(inArray(committeeCandidacy.applicationId, [applicationId]));
  return rows.map((row) => row.committeeId).sort();
}
