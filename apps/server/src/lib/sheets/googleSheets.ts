import jwt from "jsonwebtoken";

import type { ParsedSheet, RawRow } from "../import/types.ts";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_URL = "https://sheets.googleapis.com/v4/spreadsheets";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

/** How long to wait on Google before giving up, in milliseconds. */
const TIMEOUT_MS = 20_000;

/**
 * The half of a Google service-account key file this needs.
 *
 * Only these two fields are read, so the whole key JSON goes in one variable
 * and nothing else about it has to be understood here.
 */
export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

/** Raised for every failure here, so callers can report a reason rather than a stack. */
export class SheetError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "SheetError";
  }
}

/**
 * Parses the service-account key out of an environment variable.
 *
 * The JSON is often pasted with literal `\n` in the private key rather than
 * real newlines, which produces a key that looks right and fails to sign. That
 * is repaired here because the failure it causes otherwise is unreadable.
 */
export function parseServiceAccountKey(raw: string): ServiceAccountKey {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SheetError("The Google service account key is not valid JSON");
  }

  const key = parsed as Partial<ServiceAccountKey>;
  if (typeof key.client_email !== "string" || typeof key.private_key !== "string") {
    throw new SheetError("The Google service account key needs client_email and private_key");
  }

  return {
    client_email: key.client_email,
    private_key: key.private_key.replace(/\\n/gu, "\n"),
  };
}

/**
 * Exchanges a signed assertion for an access token.
 *
 * This is the whole of the service-account flow, which is why `googleapis` is
 * not a dependency: `jsonwebtoken` is already here for verifying our own
 * tokens, and the exchange is one request.
 */
async function accessToken(key: ServiceAccountKey, now: number): Promise<string> {
  const assertion = jwt.sign(
    {
      iss: key.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: Math.floor(now / 1000),
      exp: Math.floor(now / 1000) + 3600,
    },
    key.private_key,
    { algorithm: "RS256" },
  );

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new SheetError(
      "Google refused the service account credentials. Check the key is current and the account is not disabled.",
      response.status,
    );
  }

  const body = (await response.json()) as { access_token?: string };
  if (typeof body.access_token !== "string") {
    throw new SheetError("Google returned no access token");
  }
  return body.access_token;
}

/**
 * The spreadsheet id inside a Google Sheets URL, or null.
 *
 * Takes a URL because that is what somebody pastes; a bare id is accepted too,
 * since that is what they get if they read the documentation instead.
 */
export function parseSpreadsheetId(raw: string): string | null {
  const text = raw.trim();
  if (text === "") {
    return null;
  }

  const fromUrl = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/u.exec(text);
  if (fromUrl?.[1] !== undefined) {
    return fromUrl[1];
  }

  // A bare id. Google's are long and use this alphabet; anything else is
  // almost certainly a mistyped URL, and guessing would produce a 404 whose
  // cause is invisible.
  return /^[a-zA-Z0-9_-]{20,}$/u.test(text) ? text : null;
}

/**
 * Turns a Sheets `values` grid into the same shape a parsed upload produces.
 *
 * Doing the conversion here means the sync path and the upload path share every
 * later step - mapping, normalisation, preview, commit - rather than growing a
 * second importer that drifts from the first.
 *
 * Trailing empty cells are omitted by the API, so rows are shorter than the
 * header and every missing cell has to be filled rather than assumed present.
 */
export function toParsedSheet(values: string[][], sheetName: string): ParsedSheet {
  const [headerRow, ...bodyRows] = values;
  if (headerRow === undefined) {
    return { sheetName, headers: [], rows: [] };
  }

  // Blank and duplicate headers are dropped, matching `parseXlsx`: a column
  // with no name cannot be mapped, and a repeated name would silently take the
  // last value.
  const headers: string[] = [];
  const seen = new Set<string>();
  const keptIndexes: number[] = [];
  headerRow.forEach((cell, index) => {
    const header = cell.trim();
    if (header === "" || seen.has(header)) {
      return;
    }
    seen.add(header);
    headers.push(header);
    keptIndexes.push(index);
  });

  const rows: RawRow[] = bodyRows.map((cells, index) => {
    const row: Record<string, string> = {};
    keptIndexes.forEach((columnIndex, headerIndex) => {
      const header = headers[headerIndex];
      if (header !== undefined) {
        row[header] = cells[columnIndex] ?? "";
      }
    });
    // The header is row 1, so the first applicant is row 2 - the same numbering
    // the person looking at the sheet sees.
    return { ...row, sourceRowNumber: index + 2 } as RawRow;
  });

  // A row where every cell is blank is spreadsheet padding, not an applicant.
  const populated = rows.filter((row) =>
    headers.some((header) => String(row[header] ?? "").trim() !== ""),
  );

  return { sheetName, headers, rows: populated };
}

/**
 * Reads a spreadsheet as if it had been uploaded.
 *
 * `range` may be null, which reads the first worksheet whole - what a form's
 * response sheet wants, and what an admin who pasted a link expects.
 */
export async function fetchSheet(
  key: ServiceAccountKey,
  spreadsheetId: string,
  range: string | null,
  now: number = Date.now(),
): Promise<ParsedSheet> {
  const token = await accessToken(key, now);

  const resolvedRange = range ?? (await firstSheetName(token, spreadsheetId));
  const url = `${SHEETS_URL}/${spreadsheetId}/values/${encodeURIComponent(resolvedRange)}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (response.status === 403) {
    throw new SheetError(
      `The service account cannot read this sheet. Share it with ${key.client_email} as a viewer.`,
      403,
    );
  }
  if (response.status === 404) {
    throw new SheetError("No spreadsheet with that id, or the range does not exist", 404);
  }
  if (!response.ok) {
    throw new SheetError(`Google Sheets returned ${String(response.status)}`, response.status);
  }

  const body = (await response.json()) as { values?: string[][] };
  return toParsedSheet(body.values ?? [], resolvedRange);
}

/** The first worksheet's name, used when no explicit range is configured. */
async function firstSheetName(token: string, spreadsheetId: string): Promise<string> {
  const response = await fetch(`${SHEETS_URL}/${spreadsheetId}?fields=sheets.properties.title`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (response.status === 403) {
    throw new SheetError("The service account cannot read this sheet", 403);
  }
  if (!response.ok) {
    throw new SheetError(`Could not read the spreadsheet's worksheets`, response.status);
  }

  const body = (await response.json()) as {
    sheets?: Array<{ properties?: { title?: string } }>;
  };
  const title = body.sheets?.[0]?.properties?.title;
  if (typeof title !== "string") {
    throw new SheetError("The spreadsheet has no worksheets");
  }
  return title;
}
