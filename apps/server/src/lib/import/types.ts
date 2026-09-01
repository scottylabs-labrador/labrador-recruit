import type { answerType, applicantYear } from "@labrador/db/schema";

/**
 * Mirrored from the database enums rather than re-declared, so the importer can
 * never drift from the columns it eventually writes into. These are type-only
 * imports, which keeps this module free of any runtime dependency on the db.
 */
export type ApplicantYear = (typeof applicantYear.enumValues)[number];
export type AnswerType = (typeof answerType.enumValues)[number];

/**
 * One spreadsheet cell after parsing. Numbers stay numbers because the Finance
 * sub-team ranking columns are exported as bare integers while every other
 * ranking column is exported as a label, and a blank cell is `null` rather than
 * `""` so "left unanswered" stays distinguishable from "answered with nothing".
 */
export type RawCell = string | number | null;

/**
 * One row keyed by its trimmed column header. `sourceRowNumber` is the 1-based
 * spreadsheet row (the header is row 1, the first applicant is row 2) so an
 * error can point an admin at the exact line of the file they uploaded.
 */
export type RawRow = Record<string, RawCell> & { sourceRowNumber: number };

/** The result of reading one worksheet or CSV document, before any mapping. */
export interface ParsedSheet {
  /** The worksheet name, or `"csv"` for a CSV document. */
  sheetName: string;
  /** Headers in column order, with duplicates and blanks already removed. */
  headers: string[];
  rows: RawRow[];
}

/**
 * What a column means to the importer. Roles rather than per-column special
 * cases are what let Outreach have a top-level ranking column but no question
 * block: it simply contributes a `committee_rank` field and nothing else.
 */
export type FieldRole =
  | "identity"
  | "committee_rank"
  | "subteam_rank"
  | "opt_in"
  | "answer"
  | "ignored";

/** How confidently a sheet header was matched, surfaced in the admin preview. */
export type HeaderMatchKind = "exact" | "normalized" | "pattern";

/**
 * A column the importer knows about ahead of time. Declarative on purpose:
 * changing the form between cycles should mean editing this table, not the
 * normalisation code.
 */
export interface KnownHeader {
  /** The header exactly as the Google Forms export writes it. */
  header: string;
  /** Stable identifier the rest of the codebase refers to the column by. */
  key: string;
  /** Grouping for display, for example `"general"`, `"ranking"` or `"tech"`. */
  section: string;
  /** Set when the column belongs to exactly one committee. */
  committeeSlug?: string;
  /** Set for `subteam_rank` columns, identifying the team within a committee. */
  subteamKey?: string;
  answerType: AnswerType;
  role: FieldRole;
}

/** A {@link KnownHeader} bound to a header that actually appeared in the file. */
export interface MappedField extends KnownHeader {
  /** The header as it appeared in the uploaded sheet, used in error messages. */
  header: string;
  matchedBy: HeaderMatchKind;
}

/**
 * The outcome of matching a sheet's headers. Unrecognised and missing headers
 * are reported rather than thrown, because the fix is an admin repairing the
 * mapping in the UI, not the upload failing.
 */
export interface HeaderMapping {
  /** Sheet header text to the field it was matched to, in column order. */
  fields: MappedField[];
  /** Headers present in the sheet that nothing matched. */
  unmappedHeaders: string[];
  /** Known Fall 2026 headers that the sheet did not supply. */
  missingHeaders: string[];
}

/** The applicant's own ranking of one committee. 1 is their first choice. */
export interface CommitteeRank {
  rank: number;
  /** The original cell text, for example `"1st Choice"` or `"3"`. */
  rawLabel: string;
}

/** The applicant's own ranking of one team inside a committee. */
export interface SubteamRank extends CommitteeRank {
  committeeSlug: string;
  subteamKey: string;
}

/** One answer, stored verbatim. Never summarised, scored, or interpreted. */
export interface NormalizedAnswer {
  questionKey: string;
  /** The applicant's text exactly as submitted, only outer whitespace removed. */
  answerText: string;
  /**
   * Present only for `url` columns. `url` is `null` when the applicant wrote
   * something that is not a well-shaped http(s) link, so the interface can
   * render the text inertly instead of turning it into a clickable target. The
   * server never fetches either value.
   */
  answerJson?: { url: string | null };
}

/** One row reduced to the shape the application tables expect. */
export interface NormalizedApplication {
  sourceRowNumber: number;
  /** Trimmed and lowercased; the identity an applicant is deduplicated by. */
  email: string;
  /** Exactly what the form supplied, retained for audit. */
  rawEmail: string;
  fullName: string;
  major: string | null;
  year: ApplicantYear;
  /** Whatever the form supplied, kept even when `year` is `"unknown"`. */
  rawYear: string | null;
  /** The form timestamp, unparsed. Time zone handling belongs to the service. */
  submittedAtRaw: string | null;
  rankingExplanation: string | null;
  friendRequest: string | null;
  heardAboutScottylabs: string | null;
  /** Committee slug to the rank the applicant gave it. */
  committeePreferences: Record<string, CommitteeRank>;
  subteamPreferences: SubteamRank[];
  /** Committee slug to whether they opted into that committee's questions. */
  committeeOptIns: Record<string, boolean>;
  /** Blank answers are absent rather than stored as empty strings. */
  answers: NormalizedAnswer[];
  /** Stable hash of the row, so an unchanged re-import is a no-op. */
  rowHash: string;
}

/** A validation failure that names the column an admin has to look at. */
export interface ImportRowError {
  /** The offending header exactly as it appeared in the sheet. */
  column: string;
  /** The stable field key, so the UI can link to the mapping entry. */
  field: string;
  message: string;
  /** The rejected cell, stringified. Never a whole row: rows are PII. */
  value: string | null;
}

/**
 * Per-row outcome. A discriminated union rather than an exception so that one
 * malformed row can never fail the other 117 rows of a batch.
 */
export type ImportRowResult =
  | { ok: true; sourceRowNumber: number; application: NormalizedApplication }
  | { ok: false; sourceRowNumber: number; rowHash: string; errors: ImportRowError[] };

/** Everything an admin needs to review an upload before committing it. */
export interface ImportPreview {
  sheetName: string;
  mapping: HeaderMapping;
  /** Data rows read, excluding the header row. */
  rowCount: number;
  okCount: number;
  errorCount: number;
  results: ImportRowResult[];
  /**
   * Normalised emails that appear on more than one row. Reported rather than
   * resolved here: whether a later row supersedes an earlier one is a decision
   * for the import service, which can see what is already in the database.
   */
  duplicateEmails: string[];
}
