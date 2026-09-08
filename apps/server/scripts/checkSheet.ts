//
// Checks that this deployment can actually read a Google Sheet, and says which
// of the four separate things went wrong when it cannot.
//
//   bun run apps/server/scripts/checkSheet.ts <sheet-url-or-id> [range]
//
// Configuring a sheet source fails in ways that look identical from the
// interface: a key that is not valid JSON, a key Google refuses, a spreadsheet
// nobody shared with the service account, and - the quiet one - the right
// spreadsheet with the wrong worksheet chosen, which stages a preview of zero
// applicants and reports no error at all. The sync endpoint can only report the
// first failure it reaches. This walks all of them in order.
//
// Prints counts, headers and worksheet names. It never prints a cell of
// applicant data, so its output is safe to paste into an issue.
//
import { detectMapping } from "../src/lib/import/headerMap.ts";
import {
  fetchSheet,
  inspectSpreadsheet,
  parseServiceAccountKey,
  parseSpreadsheetId,
  SheetError,
} from "../src/lib/sheets/googleSheets.ts";

const [target, range] = process.argv.slice(2);

if (target === undefined) {
  console.error("Usage: checkSheet.ts <sheet-url-or-id> [range]");
  process.exit(2);
}

function fail(step: string, detail: string, remedy?: string): never {
  console.error(`\n  ✗ ${step}\n    ${detail}`);
  if (remedy !== undefined) {
    console.error(`\n    ${remedy}`);
  }
  process.exit(1);
}

// 1. The id. Refused here rather than by Google, whose answer would be a 404
//    with nothing to say the link was the problem.
const spreadsheetId = parseSpreadsheetId(target);
if (spreadsheetId === null) {
  fail(
    "Read the spreadsheet id",
    `"${target}" is neither a Google Sheets link nor an id.`,
    "Paste the whole URL from your browser's address bar.",
  );
}
console.log(`  ✓ Spreadsheet id  ${spreadsheetId}`);

// 2. The key. Read straight from the environment, so this checks the variable
//    the server will actually use rather than a copy of it.
const raw = process.env["GOOGLE_SERVICE_ACCOUNT_KEY"];
if (raw === undefined || raw === "") {
  fail(
    "Find the service account key",
    "GOOGLE_SERVICE_ACCOUNT_KEY is not set.",
    "Put the whole key JSON on one line in .env.local, then run this again.",
  );
}

const key = (() => {
  try {
    return parseServiceAccountKey(raw);
  } catch (error) {
    fail(
      "Parse the service account key",
      error instanceof Error ? error.message : String(error),
      "The value must be the entire downloaded JSON file, on a single line.",
    );
  }
})();
console.log(`  ✓ Service account ${key.client_email}`);

// 3. Credentials, sharing, and the worksheet choice, in one round trip each.
const inspection = await (async () => {
  try {
    return await inspectSpreadsheet(key, spreadsheetId);
  } catch (error) {
    if (error instanceof SheetError && error.status === 403) {
      fail(
        "Open the spreadsheet",
        error.message,
        `Share the sheet with ${key.client_email} as a Viewer.`,
      );
    }
    if (error instanceof SheetError) {
      fail("Open the spreadsheet", error.message);
    }
    throw error;
  }
})();

console.log(`  ✓ Worksheets      ${inspection.titles.join(", ")}`);

const chosen = range ?? inspection.chosen;
console.log(
  range === undefined
    ? `  ✓ Reading         ${chosen}  (chosen by header match)`
    : `  ✓ Reading         ${chosen}  (range given explicitly)`,
);

// 4. The rows themselves, and whether the declared form recognises them. A
//    sheet that reads cleanly but maps nothing is the same failure as reading
//    the wrong tab, and needs to be as visible.
const sheet = await fetchSheet(key, spreadsheetId, range ?? null);
const mapping = detectMapping(sheet.headers);

console.log(`  ✓ Rows            ${sheet.rows.length}`);
console.log(`  ✓ Columns         ${sheet.headers.length} found, ${mapping.fields.length} mapped`);

if (mapping.unmappedHeaders.length > 0) {
  console.log(
    `\n  Unmapped columns (${mapping.unmappedHeaders.length}) — imported as free answers:`,
  );
  for (const header of mapping.unmappedHeaders) {
    console.log(`    · ${header.replaceAll("\n", " / ")}`);
  }
}

if (mapping.missingHeaders.length > 0) {
  console.log(
    `\n  Columns the form declares but this sheet lacks (${mapping.missingHeaders.length}):`,
  );
  for (const header of mapping.missingHeaders) {
    console.log(`    · ${header.replaceAll("\n", " / ")}`);
  }
}

if (sheet.rows.length === 0) {
  console.log(
    `\n  Nothing to import. "${chosen}" has a header row and no data under it.` +
      `\n  If that is the wrong tab, pass the right one as a range: ` +
      `checkSheet.ts <id> "Form Responses 1"`,
  );
  process.exit(1);
}

console.log(`\n  Ready. Set this sheet on the cycle's Settings screen and press Sync now.`);
process.exit(0);
