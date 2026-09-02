//
// Runnable entry point for `bun run db:seed`.
//
// Kept separate from `seed.ts` so that module stays importable from anywhere,
// including Playwright, which transpiles its test files to CommonJS and rejects
// the `import.meta` guard a self-executing script would need.
//

import { createDb } from "./index.ts";
import { CRITERIA, seedRecruitmentData } from "./seed.ts";

async function main() {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const db = createDb(databaseUrl);
  const summary = await seedRecruitmentData(db);

  console.log(
    [
      `Seeded cycle ${summary.cycleId}`,
      `  ${summary.staffCount} staff users`,
      `  ${summary.committeeCount} committees`,
      `  ${CRITERIA.length} rubric criteria`,
      `  ${summary.applicantCount} synthetic applicants`,
      `  ${summary.candidacyCount} candidacies`,
      `  ${summary.assignmentCount} review assignments`,
    ].join("\n"),
  );

  await db.$client.end();
}

main().catch((error: unknown) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
