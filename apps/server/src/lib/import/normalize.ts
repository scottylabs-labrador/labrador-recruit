import { createHash } from "node:crypto";

import type { ApplicantYear, RawCell, RawRow } from "./types.ts";

/**
 * Highest rank the form can express. Seven committees is the ceiling today; the
 * Finance sub-team block only goes to six. Ranks outside the range are rejected
 * rather than clamped, because a clamped rank silently changes an applicant's
 * stated preference.
 */
const MAX_RANK = 7;

/** `"1st Choice"`, `"2nd choice"`, ... The suffix is not validated for agreement
 * with the digit, because Google Forms generates it and an applicant cannot. */
const CHOICE_LABEL = /^(\d+)\s*(?:st|nd|rd|th)?\s*choice$/;

/** A bare integer, which is how the Finance sub-team ranking columns export. */
const BARE_INTEGER = /^\d+$/;

/**
 * Deliberately loose: this is a shape check, not a deliverability check. The
 * platform must never verify an address by contacting anything.
 */
const EMAIL_SHAPE = /^[^\s@,;]+@[^\s@,;.]+(?:\.[^\s@,;.]+)+$/;

/** `scheme:` at the start of a string, per RFC 3986. */
const URL_SCHEME = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;

/** A host with at least one dot, optionally followed by a path/query/fragment. */
const BARE_DOMAIN = /^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+(?:[/?#]\S*)?$/;

/**
 * Converts a cell to a trimmed string, or null when it holds nothing. Central
 * so that every normaliser treats a number, a blank string and an empty cell
 * identically no matter which parser produced the row.
 */
function toTrimmedString(raw: RawCell | undefined): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  const text = typeof raw === "number" ? String(raw) : raw.trim();
  return text === "" ? null : text;
}

/**
 * Trims a free-text answer without touching its interior. Applicant prose is
 * displayed verbatim, so paragraph breaks and internal spacing are preserved.
 */
export function normalizeText(raw: RawCell | undefined): string | null {
  return toTrimmedString(raw);
}

/**
 * Lowercases and trims an address so a repeat applicant is recognised across
 * cycles regardless of how they capitalised it. Returns null for anything that
 * is not shaped like an address, which the caller turns into a row error rather
 * than importing an applicant nobody can be contacted at.
 */
export function normalizeEmail(raw: RawCell | undefined): string | null {
  const text = toTrimmedString(raw);
  if (text === null) {
    return null;
  }
  const lowered = text.toLowerCase();
  return EMAIL_SHAPE.test(lowered) ? lowered : null;
}

/**
 * Collapses runs of whitespace inside a name so `"Ada   Lovelace"` and
 * `"Ada Lovelace"` sort and display identically. Unlike free text, a name has
 * no meaningful internal formatting to preserve.
 */
export function normalizeName(raw: RawCell | undefined): string | null {
  const text = toTrimmedString(raw);
  if (text === null) {
    return null;
  }
  const collapsed = text.replaceAll(/\s+/gu, " ").trim();
  return collapsed === "" ? null : collapsed;
}

/**
 * Turns a ranking cell into 1..7. Accepts both dialects the Fall 2026 form
 * emits: `"1st Choice"` labels for committee and Foundry rankings, and bare
 * integers for the Finance sub-team block. Anything else returns null so the
 * caller can raise a row error; garbage is never coerced to a rank, because a
 * wrong rank silently misrepresents what the applicant asked for.
 */
export function parseChoiceRank(raw: RawCell | undefined): number | null {
  if (typeof raw === "number") {
    return Number.isInteger(raw) && raw >= 1 && raw <= MAX_RANK ? raw : null;
  }

  const text = toTrimmedString(raw);
  if (text === null) {
    return null;
  }

  const lowered = text.toLowerCase().replaceAll(/\s+/gu, " ");
  const digits = BARE_INTEGER.test(lowered) ? lowered : CHOICE_LABEL.exec(lowered)?.[1];
  if (digits === undefined) {
    return null;
  }

  const rank = Number.parseInt(digits, 10);
  return rank >= 1 && rank <= MAX_RANK ? rank : null;
}

/** Spellings seen in Google Forms exports, mapped to the `applicant_year` enum. */
const YEAR_ALIASES = new Map<string, ApplicantYear>([
  ["first year", "first_year"],
  ["first-year", "first_year"],
  ["firstyear", "first_year"],
  ["first", "first_year"],
  ["freshman", "first_year"],
  ["frosh", "first_year"],
  ["1st year", "first_year"],
  ["year 1", "first_year"],
  ["sophomore", "sophomore"],
  ["second year", "sophomore"],
  ["2nd year", "sophomore"],
  ["year 2", "sophomore"],
  ["junior", "junior"],
  ["third year", "junior"],
  ["3rd year", "junior"],
  ["year 3", "junior"],
  ["senior", "senior"],
  ["fourth year", "senior"],
  ["4th year", "senior"],
  ["year 4", "senior"],
  ["grad", "grad"],
  ["graduate", "grad"],
  ["grad student", "grad"],
  ["graduate student", "grad"],
  ["masters", "grad"],
  ["master's", "grad"],
  ["phd", "grad"],
]);

/**
 * Maps a year cell onto the `applicant_year` enum. Unrecognised values become
 * `"unknown"` rather than an error: an odd year is not a reason to drop an
 * application, and the caller retains the raw string so a human can read it.
 */
export function normalizeYear(raw: RawCell | undefined): ApplicantYear {
  const text = toTrimmedString(raw);
  if (text === null) {
    return "unknown";
  }
  const lowered = text.toLowerCase().replaceAll(/\s+/gu, " ");
  return YEAR_ALIASES.get(lowered) ?? "unknown";
}

/**
 * Shape-checks an applicant-supplied link and adds `https://` to a bare domain.
 * This never resolves, fetches, or otherwise contacts the address: product rule
 * 1 forbids the platform from visiting applicant links, so "valid" here means
 * "parses as an http(s) URL" and nothing more. Any other scheme -- notably
 * `javascript:` and `data:` -- returns null so it can never reach an `href`.
 */
export function normalizeUrl(raw: RawCell | undefined): string | null {
  const text = toTrimmedString(raw);
  if (text === null || /\s/u.test(text)) {
    return null;
  }

  const scheme = URL_SCHEME.exec(text)?.[1]?.toLowerCase();
  let candidate: string;
  if (scheme === "http" || scheme === "https") {
    candidate = text;
  } else if (scheme !== undefined) {
    // An explicit scheme we do not allow. Never rescue it by prepending https.
    return null;
  } else if (text.startsWith("//")) {
    candidate = `https:${text}`;
  } else if (BARE_DOMAIN.test(text)) {
    candidate = `https://${text}`;
  } else {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }
  if (!parsed.hostname.includes(".")) {
    return null;
  }
  return parsed.href;
}

const AFFIRMATIVE = new Set(["yes", "y", "true", "1"]);
const NEGATIVE = new Set(["no", "n", "false", "0"]);

/**
 * Reads a yes/no opt-in cell. The Events block answers `"No, let me be done"`
 * rather than `"No"`, so a prefix match backs up the exact match. Blank or
 * unrecognised returns null, which reads as "the applicant did not say" and is
 * not the same as an explicit no.
 */
export function isAffirmative(raw: RawCell | undefined): boolean | null {
  const text = toTrimmedString(raw);
  if (text === null) {
    return null;
  }
  const lowered = text.toLowerCase().replaceAll(/\s+/gu, " ");

  if (AFFIRMATIVE.has(lowered)) {
    return true;
  }
  if (NEGATIVE.has(lowered)) {
    return false;
  }
  if (lowered.startsWith("yes,") || lowered.startsWith("yes ")) {
    return true;
  }
  if (lowered.startsWith("no,") || lowered.startsWith("no ")) {
    return false;
  }
  return null;
}

/**
 * Canonicalises a row for hashing: the spreadsheet position is dropped, values
 * are stringified and trimmed, blanks are removed, and keys are sorted. The
 * result is identical whether the row arrived as .xlsx or .csv and whether it
 * moved rows between exports, which is exactly the property an idempotent
 * re-import needs.
 */
function compareEntries(a: [string, string], b: [string, string]): number {
  if (a[0] === b[0]) {
    return 0;
  }
  return a[0] < b[0] ? -1 : 1;
}

function canonicalizeRow(raw: RawRow): string {
  const entries: [string, string][] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (key === "sourceRowNumber") {
      continue;
    }
    const text = toTrimmedString(value);
    if (text !== null) {
      entries.push([key, text]);
    }
  }
  entries.sort(compareEntries);
  return JSON.stringify(entries);
}

/**
 * Stable content hash of a row, used to detect that a re-uploaded export has
 * not changed so the importer can skip it instead of rewriting history.
 */
export function hashRow(raw: RawRow): string {
  return createHash("sha256").update(canonicalizeRow(raw), "utf8").digest("hex");
}
