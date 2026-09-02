/**
 * RFC 4180 CSV serialisation.
 *
 * Exports arrive from the server as typed rows, so the only thing left to get
 * wrong is the text encoding — and `rows.map((row) => values.join(","))` gets it
 * wrong the first time an applicant writes a comma in their major or a newline
 * in a rationale. That failure is silent: the file opens, the columns shift, and
 * the spreadsheet reads as if the data were different. Hence a real serialiser
 * with its own unit tests.
 */

/** Everything a typed export row can hold in a single cell. */
export type CsvValue = string | number | boolean | null | undefined;

export interface CsvColumn<Row> {
  /** The header text, written verbatim as the first record. */
  header: string;
  value: (row: Row) => CsvValue;
}

/**
 * A field must be quoted when it contains the delimiter, a double quote, or
 * either half of a line break. Carriage return is listed separately from line
 * feed because a lone `\r` is just as capable of splitting a record.
 */
const NEEDS_QUOTING = /[",\r\n]/;

const RECORD_SEPARATOR = "\r\n";

/**
 * Escapes one field.
 *
 * `null` and `undefined` become an empty field rather than the strings `"null"`
 * and `"undefined"`: a missing email is missing, not the word "null". Embedded
 * double quotes are doubled, which is the only escape RFC 4180 defines.
 */
export function escapeCsvField(value: CsvValue): string {
  if (value === null || value === undefined) return "";

  const text = typeof value === "string" ? value : String(value);
  if (!NEEDS_QUOTING.test(text)) return text;

  return `"${text.replaceAll('"', '""')}"`;
}

/**
 * Serialises rows to a CSV document: one header record, then one record per
 * row, separated by CRLF as RFC 4180 requires. There is no trailing separator,
 * because the specification makes the final line break optional and omitting it
 * keeps the output free of a spurious empty record.
 */
export function toCsv<Row>(columns: ReadonlyArray<CsvColumn<Row>>, rows: readonly Row[]): string {
  const header = columns.map((column) => escapeCsvField(column.header)).join(",");
  const body = rows.map((row) =>
    columns.map((column) => escapeCsvField(column.value(row))).join(","),
  );

  return [header, ...body].join(RECORD_SEPARATOR);
}

/**
 * Lowercases and hyphenates a fragment so the assembled filename is safe on
 * every filesystem, for example `Fall 2026` becoming `fall-2026`.
 */
export function slugifyForFilename(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug === "" ? "export" : slug;
}

/** Builds a filename such as `fall-2026-tech-ranking.csv`. */
export function csvFilename(...parts: readonly string[]): string {
  return `${parts.map(slugifyForFilename).join("-")}.csv`;
}

/**
 * Hands the browser a file without a server round trip.
 *
 * The object URL is revoked immediately after the click, because it otherwise
 * pins the whole blob in memory for the lifetime of the document — and an export
 * blob holds applicant PII.
 */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
