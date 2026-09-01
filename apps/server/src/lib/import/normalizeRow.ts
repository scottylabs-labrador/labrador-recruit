import {
  hashRow,
  isAffirmative,
  normalizeEmail,
  normalizeName,
  normalizeText,
  normalizeUrl,
  normalizeYear,
  parseChoiceRank,
} from "./normalize.ts";
import type {
  CommitteeRank,
  HeaderMapping,
  ImportPreview,
  ImportRowError,
  ImportRowResult,
  MappedField,
  NormalizedAnswer,
  NormalizedApplication,
  ParsedSheet,
  RawCell,
  RawRow,
  SubteamRank,
} from "./types.ts";

/**
 * Column names used in an error when the sheet omitted the column entirely, so
 * the message still tells an admin which question to look for.
 */
const EMAIL_LABEL = "Email Address";
const NAME_LABEL = "Full Name";

/**
 * Accumulates one row's fields. Deliberately mutable and local: a validation
 * failure is recorded and the remaining columns are still processed, so one
 * error message can name every bad cell in the row instead of only the first.
 */
interface RowAccumulator {
  identity: Map<string, RawCell>;
  committeePreferences: Record<string, CommitteeRank>;
  subteamPreferences: SubteamRank[];
  committeeOptIns: Record<string, boolean>;
  answers: NormalizedAnswer[];
  errors: ImportRowError[];
}

function readRank(
  field: MappedField,
  value: RawCell | undefined,
  accumulator: RowAccumulator,
): CommitteeRank | null {
  const rawLabel = normalizeText(value);
  if (rawLabel === null) {
    // A blank ranking cell means the applicant did not rank that option.
    return null;
  }

  const rank = parseChoiceRank(value);
  if (rank === null) {
    accumulator.errors.push({
      column: field.header,
      field: field.key,
      message:
        `Could not read "${rawLabel}" as a ranking. ` +
        `Expected "1st Choice" through "7th Choice", or a number from 1 to 7.`,
      value: rawLabel,
    });
    return null;
  }

  return { rank, rawLabel };
}

function applyAnswer(
  field: MappedField,
  value: RawCell | undefined,
  accumulator: RowAccumulator,
): void {
  const answerText = normalizeText(value);
  if (answerText === null) {
    // Blank optional answers are omitted entirely rather than stored as "".
    return;
  }

  if (field.answerType === "url") {
    // Shape-checked only: product rule 1 forbids the platform from resolving or
    // fetching an applicant link. A link that fails the shape check keeps its
    // text but gets a null `url`, so the interface can display what was written
    // without ever turning it into something clickable.
    accumulator.answers.push({
      questionKey: field.key,
      answerText,
      answerJson: { url: normalizeUrl(answerText) },
    });
    return;
  }

  accumulator.answers.push({ questionKey: field.key, answerText });
}

function applyField(
  field: MappedField,
  value: RawCell | undefined,
  accumulator: RowAccumulator,
): void {
  switch (field.role) {
    case "identity": {
      accumulator.identity.set(field.key, value ?? null);
      return;
    }
    case "committee_rank": {
      const slug = field.committeeSlug;
      const parsed = readRank(field, value, accumulator);
      if (slug !== undefined && parsed !== null) {
        accumulator.committeePreferences[slug] = parsed;
      }
      return;
    }
    case "subteam_rank": {
      const slug = field.committeeSlug;
      const subteamKey = field.subteamKey;
      const parsed = readRank(field, value, accumulator);
      if (slug !== undefined && subteamKey !== undefined && parsed !== null) {
        accumulator.subteamPreferences.push({ committeeSlug: slug, subteamKey, ...parsed });
      }
      return;
    }
    case "opt_in": {
      const slug = field.committeeSlug;
      const answer = isAffirmative(value);
      if (slug !== undefined && answer !== null) {
        accumulator.committeeOptIns[slug] = answer;
      }
      return;
    }
    case "answer": {
      applyAnswer(field, value, accumulator);
      return;
    }
    case "ignored": {
      return;
    }
  }
}

/** Renders a rejected cell for a message. Never dumps the whole row: rows are PII. */
function describeValue(value: RawCell | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return typeof value === "number" ? String(value) : value;
}

/**
 * Reduces one raw row to the shape the application tables expect.
 *
 * Never throws. A row that cannot become an application -- no usable email, no
 * name, or a ranking cell holding something that is not a rank -- comes back as
 * an `ok: false` result naming the offending columns, so an admin repairs a few
 * cells instead of re-exporting the entire form. The row hash is computed
 * either way, so a later upload can tell a repaired row from an unchanged one.
 */
export function normalizeRow(raw: RawRow, mapping: HeaderMapping): ImportRowResult {
  const accumulator: RowAccumulator = {
    identity: new Map<string, RawCell>(),
    committeePreferences: {},
    subteamPreferences: [],
    committeeOptIns: {},
    answers: [],
    errors: [],
  };

  for (const field of mapping.fields) {
    applyField(field, raw[field.header], accumulator);
  }

  const rowHash = hashRow(raw);
  const sourceRowNumber = raw.sourceRowNumber;
  const headersByKey = new Map(mapping.fields.map((field) => [field.key, field.header]));

  const emailCell = accumulator.identity.get("email");
  const nameCell = accumulator.identity.get("full_name");
  const email = normalizeEmail(emailCell);
  const rawEmail = normalizeText(emailCell);
  const fullName = normalizeName(nameCell);

  if (email === null || rawEmail === null || fullName === null) {
    if (email === null || rawEmail === null) {
      const value = describeValue(emailCell);
      accumulator.errors.push({
        column: headersByKey.get("email") ?? EMAIL_LABEL,
        field: "email",
        message:
          value === null
            ? `Required column "${EMAIL_LABEL}" is blank.`
            : `"${value}" is not shaped like an email address.`,
        value,
      });
    }
    if (fullName === null) {
      accumulator.errors.push({
        column: headersByKey.get("full_name") ?? NAME_LABEL,
        field: "full_name",
        message: `Required column "${NAME_LABEL}" is blank.`,
        value: describeValue(nameCell),
      });
    }
    return { ok: false, sourceRowNumber, rowHash, errors: accumulator.errors };
  }

  if (accumulator.errors.length > 0) {
    return { ok: false, sourceRowNumber, rowHash, errors: accumulator.errors };
  }

  const yearCell = accumulator.identity.get("year");
  const application: NormalizedApplication = {
    sourceRowNumber,
    email,
    rawEmail,
    fullName,
    major: normalizeText(accumulator.identity.get("major")),
    year: normalizeYear(yearCell),
    // Retained even when `year` is "unknown", so a human can read what was said.
    rawYear: normalizeText(yearCell),
    submittedAtRaw: normalizeText(accumulator.identity.get("timestamp")),
    rankingExplanation: normalizeText(accumulator.identity.get("ranking_explanation")),
    friendRequest: normalizeText(accumulator.identity.get("friend_request")),
    heardAboutScottylabs: normalizeText(accumulator.identity.get("heard_about")),
    committeePreferences: accumulator.committeePreferences,
    subteamPreferences: accumulator.subteamPreferences,
    committeeOptIns: accumulator.committeeOptIns,
    answers: accumulator.answers,
    rowHash,
  };

  return { ok: true, sourceRowNumber, application };
}

/**
 * Normalises every row of a sheet into the summary an admin reviews before
 * committing. Duplicate emails are reported rather than resolved, because
 * whether a later row supersedes an earlier one depends on what is already in
 * the database, which this pure layer deliberately cannot see.
 */
export function buildImportPreview(sheet: ParsedSheet, mapping: HeaderMapping): ImportPreview {
  const results = sheet.rows.map((row) => normalizeRow(row, mapping));

  const seen = new Set<string>();
  const duplicates = new Set<string>();
  let okCount = 0;

  for (const result of results) {
    if (!result.ok) {
      continue;
    }
    okCount += 1;
    const { email } = result.application;
    if (seen.has(email)) {
      duplicates.add(email);
    }
    seen.add(email);
  }

  return {
    sheetName: sheet.sheetName,
    mapping,
    rowCount: sheet.rows.length,
    okCount,
    errorCount: results.length - okCount,
    results,
    duplicateEmails: [...duplicates],
  };
}
