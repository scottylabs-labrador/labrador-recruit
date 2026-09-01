import type { CellValue, Row, Worksheet } from "exceljs";
import { Workbook } from "exceljs";

import type { ParsedSheet, RawCell, RawRow } from "./types.ts";

/**
 * Headers are trimmed at the edges but never internally: several Fall 2026
 * Foundry columns genuinely contain a newline (`"Pick your team\n\n*Note: ..."`)
 * and stripping it would stop the header from matching the declared mapping.
 * CRLF is folded to LF so a CSV and an .xlsx export of the same form produce the
 * same header string.
 */
function normalizeHeaderText(raw: string): string {
  return raw.replaceAll("\r\n", "\n").trim();
}

/** True when the cell object is an exceljs rich-text value. */
function isRichText(value: object): value is { richText: { text: string }[] } {
  return "richText" in value && Array.isArray((value as { richText: unknown }).richText);
}

/** True when the cell object is an exceljs hyperlink value. */
function isHyperlink(value: object): value is { text: string; hyperlink: string } {
  return "hyperlink" in value && "text" in value;
}

/** True when the cell object is an exceljs formula value carrying a result. */
function isFormula(value: object): value is { result?: CellValue } {
  return "formula" in value || "sharedFormula" in value;
}

/**
 * Flattens the many shapes exceljs can hand back into the two the importer
 * cares about. A formula cell yields its cached result, a hyperlink cell yields
 * the visible text, and an error cell yields null; none of them are ever
 * dereferenced or followed.
 */
function toRawCell(value: CellValue): RawCell {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    return value === "" ? null : value;
  }
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (isRichText(value)) {
    const text = value.richText.map((part) => part.text).join("");
    return text === "" ? null : text;
  }
  if (isHyperlink(value)) {
    return toRawCell(value.text);
  }
  if (isFormula(value)) {
    return value.result === undefined ? null : toRawCell(value.result);
  }
  // An error cell (`{ error: "#N/A" }`) or anything unexpected reads as blank.
  return null;
}

/**
 * Builds the header list. Blank header cells are dropped rather than given a
 * placeholder name, and a header repeated in the same sheet keeps only its
 * first column, because a `Record` cannot hold both and silently overwriting
 * the first with the last would lose the answer an applicant actually gave.
 */
function readHeaders(row: Row, columnCount: number): (string | null)[] {
  const seen = new Set<string>();
  const headers: (string | null)[] = [];

  for (let column = 1; column <= columnCount; column += 1) {
    const value = toRawCell(row.getCell(column).value);
    const text = typeof value === "string" ? normalizeHeaderText(value) : "";

    if (text === "" || seen.has(text)) {
      headers.push(null);
      continue;
    }
    seen.add(text);
    headers.push(text);
  }

  return headers;
}

function readSheet(worksheet: Worksheet): ParsedSheet {
  const columnCount = Math.max(worksheet.columnCount, worksheet.getRow(1).cellCount);
  const headerSlots = readHeaders(worksheet.getRow(1), columnCount);
  const headers = headerSlots.filter((header): header is string => header !== null);

  const rows: RawRow[] = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const sheetRow = worksheet.getRow(rowNumber);
    const cells: Record<string, RawCell> = {};
    let hasValue = false;

    for (const [index, header] of headerSlots.entries()) {
      if (header === null) {
        continue;
      }
      const value = toRawCell(sheetRow.getCell(index + 1).value);
      cells[header] = value;
      if (value !== null) {
        hasValue = true;
      }
    }

    // A wholly empty row is spreadsheet padding, not an applicant.
    if (hasValue) {
      rows.push({ ...cells, sourceRowNumber: rowNumber });
    }
  }

  return { sheetName: worksheet.name, headers, rows };
}

/**
 * Reads one worksheet of a Google Forms .xlsx export. Defaults to the first
 * worksheet because the Fall 2026 export contains only `Form Responses 1`, but
 * accepts a name so a multi-sheet workbook can be imported deliberately.
 */
export async function parseXlsx(
  buffer: ArrayBuffer | Buffer,
  sheetName?: string,
): Promise<ParsedSheet> {
  const workbook = new Workbook();
  // exceljs only accepts a Buffer, so an uploaded ArrayBuffer is wrapped first.
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
  // exceljs ships `declare interface Buffer extends ArrayBuffer {}`, which is
  // wrong wherever a real Node Buffer type exists. The value below is a genuine
  // Buffer at runtime; only exceljs's declaration of the parameter is bogus.
  const data = Buffer.from(bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0];
  await workbook.xlsx.load(data);

  const worksheet =
    sheetName === undefined ? workbook.worksheets[0] : workbook.getWorksheet(sheetName);

  if (worksheet === undefined) {
    throw new Error(
      sheetName === undefined
        ? "Workbook contains no worksheets"
        : `Workbook has no worksheet named "${sheetName}"`,
    );
  }

  return readSheet(worksheet);
}

/**
 * Splits CSV text into records per RFC 4180. Hand-written rather than taken
 * from a dependency because the only hard requirements are quoted fields,
 * embedded commas, embedded newlines and doubled `""` escapes -- all of which
 * appear in real form exports, and none of which a `split(",")` survives.
 */
function splitCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;
  let sawAnyCharacter = false;

  // Strip a UTF-8 BOM, which Google Sheets prepends and which would otherwise
  // become part of the first header.
  const source = text.startsWith("\uFEFF") ? text.slice(1) : text;

  function endField(): void {
    record.push(field);
    field = "";
  }

  function endRecord(): void {
    endField();
    records.push(record);
    record = [];
  }

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === undefined) {
      break;
    }
    sawAnyCharacter = true;

    if (inQuotes) {
      if (character !== '"') {
        field += character;
        continue;
      }
      // A doubled quote is a literal quote; a lone quote closes the field.
      if (source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = false;
      }
      continue;
    }

    if (character === '"' && field === "") {
      inQuotes = true;
    } else if (character === ",") {
      endField();
    } else if (character === "\n") {
      endRecord();
    } else if (character === "\r") {
      // Both CRLF and a lone CR terminate a record.
      if (source[index + 1] === "\n") {
        index += 1;
      }
      endRecord();
    } else {
      field += character;
    }
  }

  // A file that does not end in a newline still has a final record.
  if (field !== "" || record.length > 0 || (sawAnyCharacter && records.length === 0)) {
    endRecord();
  }

  return records;
}

/**
 * Parses CSV text into the same {@link ParsedSheet} shape as {@link parseXlsx},
 * so downstream mapping and normalisation never learn which format was
 * uploaded. Values stay strings; a blank field becomes null so it is treated as
 * unanswered exactly like an empty spreadsheet cell.
 */
export function parseCsv(text: string): ParsedSheet {
  const records = splitCsvRecords(text);
  const headerRecord = records[0] ?? [];

  const seen = new Set<string>();
  const headerSlots: (string | null)[] = headerRecord.map((raw) => {
    const header = normalizeHeaderText(raw);
    if (header === "" || seen.has(header)) {
      return null;
    }
    seen.add(header);
    return header;
  });
  const headers = headerSlots.filter((header): header is string => header !== null);

  const rows: RawRow[] = [];
  for (const [offset, record] of records.slice(1).entries()) {
    const cells: Record<string, RawCell> = {};
    let hasValue = false;

    for (const [index, header] of headerSlots.entries()) {
      if (header === null) {
        continue;
      }
      const raw = record[index];
      const value = raw === undefined || raw === "" ? null : raw;
      cells[header] = value;
      if (value !== null) {
        hasValue = true;
      }
    }

    if (hasValue) {
      // Records are 0-based here; the header is spreadsheet row 1.
      rows.push({ ...cells, sourceRowNumber: offset + 2 });
    }
  }

  return { sheetName: "csv", headers, rows };
}
