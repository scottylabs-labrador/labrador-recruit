import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { RecruitmentUser } from "@labrador/access-control";
import { applicant, application, committeeCandidacy, review } from "@labrador/db/schema";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { importService } from "../src/services/importService.ts";
import { adminUser, seedAdmin, seedAlice, alice } from "./fixtures.ts";
import { testDb } from "./harness.ts";
import {
  linkCommitteeToCycle,
  seedAssignment,
  seedCommittees,
  seedCycle,
  seedMembership,
  seedRubric,
} from "./recruitmentFixtures.ts";

const FIXTURE = path.resolve(
  fileURLToPath(new URL("./fixtures/fall-2026-sample.xlsx", import.meta.url)),
);

function fixtureBase64(): string {
  return readFileSync(FIXTURE).toString("base64");
}

/**
 * The importer takes a resolved `RecruitmentUser` rather than a request, so the
 * tests build one directly instead of going through HTTP.
 */
function adminFor(cycleId: string): RecruitmentUser {
  return {
    id: adminUser.id,
    role: "user",
    recruitment: {
      cycleId,
      memberships: [{ role: "recruitment_admin", committeeId: null }],
    },
  };
}

function reviewerFor(cycleId: string, committeeId: string): RecruitmentUser {
  return {
    id: alice.id,
    role: "user",
    recruitment: {
      cycleId,
      memberships: [{ role: "reviewer", committeeId }],
    },
  };
}

async function setupCycle() {
  await seedAdmin();
  await seedAlice();

  const cycle = await seedCycle();
  const committees = await seedCommittees();

  for (const entry of Object.values(committees)) {
    await linkCommitteeToCycle(cycle.id, entry.id);
  }

  await seedMembership({
    cycleId: cycle.id,
    userId: adminUser.id,
    role: "recruitment_admin",
  });

  return { cycle, committees };
}

describe("import preview", () => {
  it("maps the Fall 2026 headers and isolates malformed rows", async () => {
    const { cycle } = await setupCycle();

    const { preview } = await importService.createImport(
      adminFor(cycle.id),
      cycle.id,
      "fall-2026-sample.xlsx",
      fixtureBase64(),
    );

    expect(preview.rowCount).toBeGreaterThan(0);
    expect(preview.okCount + preview.errorCount).toBe(preview.rowCount);
    // The fixture deliberately contains unusable rows.
    expect(preview.errorCount).toBeGreaterThan(0);
    // A bad row must not stop the good ones.
    expect(preview.okCount).toBeGreaterThan(0);
    expect(preview.mapping.fields.length).toBeGreaterThan(0);
  });

  /**
   * The preview screen renders counts and failures, so sending the parsed
   * applications for every clean row would put every answer of every applicant
   * on the wire for nothing.
   */
  it("keeps applicant answers out of the preview payload", async () => {
    const { cycle } = await setupCycle();

    const { preview } = await importService.createImport(
      adminFor(cycle.id),
      cycle.id,
      "fall-2026-sample.xlsx",
      fixtureBase64(),
    );

    expect(preview.okCount).toBeGreaterThan(0);
    expect(preview.failures.length).toBe(preview.errorCount);

    const serialised = JSON.stringify(preview);
    // No parsed applications, so no answers and no preference maps.
    expect(serialised).not.toContain('"answers"');
    expect(serialised).not.toContain('"committeePreferences"');
    expect("results" in preview).toBe(false);

    // Two disclosures are deliberate and minimal, because the admin cannot
    // repair the file without them: the duplicated address, and the cell that
    // failed to parse. Both are scoped to rows that need fixing.
    expect(preview.duplicateEmails.length).toBeGreaterThan(0);
    expect(preview.failures.every((row) => row.errors.length > 0)).toBe(true);
  });

  it("reports duplicate emails without resolving them", async () => {
    const { cycle } = await setupCycle();

    const { preview } = await importService.createImport(
      adminFor(cycle.id),
      cycle.id,
      "fall-2026-sample.xlsx",
      fixtureBase64(),
    );

    expect(Array.isArray(preview.duplicateEmails)).toBe(true);
  });

  it("writes nothing to the application tables before commit", async () => {
    const { cycle } = await setupCycle();

    await importService.createImport(
      adminFor(cycle.id),
      cycle.id,
      "fall-2026-sample.xlsx",
      fixtureBase64(),
    );

    const rows = await testDb
      .select({ id: application.id })
      .from(application)
      .where(eq(application.cycleId, cycle.id));

    expect(rows).toHaveLength(0);
  });

  it("refuses an unsupported file type", async () => {
    const { cycle } = await setupCycle();

    await expect(
      importService.createImport(adminFor(cycle.id), cycle.id, "notes.txt", "aGVsbG8="),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("refuses a caller who is not a recruitment admin", async () => {
    const { cycle, committees } = await setupCycle();
    const tech = committees["tech"];
    if (!tech) throw new Error("missing tech");

    await expect(
      importService.createImport(
        reviewerFor(cycle.id, tech.id),
        cycle.id,
        "fall-2026-sample.xlsx",
        fixtureBase64(),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe("import commit", () => {
  it("creates applications, preferences, and candidacies", async () => {
    const { cycle } = await setupCycle();
    const admin = adminFor(cycle.id);

    const { importId, preview } = await importService.createImport(
      admin,
      cycle.id,
      "fall-2026-sample.xlsx",
      fixtureBase64(),
    );

    const report = await importService.commitImport(admin, importId);

    // Every parseable row lands, but the fixture contains two rows sharing one
    // email, so one of them updates the other rather than creating a second
    // application. Deduplication inside a single file is the point here.
    expect(report.created + report.updated).toBe(preview.okCount);
    expect(report.updated).toBeGreaterThan(0);
    expect(report.errors).toBe(preview.errorCount);
    expect(report.candidaciesCreated).toBeGreaterThan(0);

    const applications = await testDb
      .select({ id: application.id })
      .from(application)
      .where(eq(application.cycleId, cycle.id));

    // Distinct applicants, not distinct rows.
    expect(applications).toHaveLength(report.created);
    expect(applications.length).toBeLessThan(preview.okCount);
  });

  it("refuses to commit the same import twice", async () => {
    const { cycle } = await setupCycle();
    const admin = adminFor(cycle.id);

    const { importId } = await importService.createImport(
      admin,
      cycle.id,
      "fall-2026-sample.xlsx",
      fixtureBase64(),
    );
    await importService.commitImport(admin, importId);

    await expect(importService.commitImport(admin, importId)).rejects.toMatchObject({
      status: 409,
    });
  });

  /**
   * The property that makes a re-upload safe: identity is cycle plus normalised
   * email, so importing the same file again updates rather than duplicates.
   */
  it("is idempotent across a second upload of the same file", async () => {
    const { cycle } = await setupCycle();
    const admin = adminFor(cycle.id);

    const first = await importService.createImport(
      admin,
      cycle.id,
      "fall-2026-sample.xlsx",
      fixtureBase64(),
    );
    const firstReport = await importService.commitImport(admin, first.importId);

    const second = await importService.createImport(
      admin,
      cycle.id,
      "fall-2026-sample.xlsx",
      fixtureBase64(),
    );
    const secondReport = await importService.commitImport(admin, second.importId);

    // Nothing new is created, and every parseable row is accounted for - now
    // as a skip where the content is unchanged, rather than as a rewrite.
    expect(secondReport.created).toBe(0);
    expect(secondReport.skipped + secondReport.updated).toBe(
      firstReport.created + firstReport.updated,
    );
    expect(secondReport.skipped).toBeGreaterThan(0);
    // No new candidacies, because the applicant's ranking has not changed.
    expect(secondReport.candidaciesCreated).toBe(0);

    const applications = await testDb
      .select({ id: application.id })
      .from(application)
      .where(eq(application.cycleId, cycle.id));

    expect(applications).toHaveLength(firstReport.created);
  });

  /**
   * The rule that protects human work: a re-import may refresh application data
   * but must never delete a candidacy or a review attached to it.
   */
  it("never destroys an existing review when re-importing", async () => {
    const { cycle } = await setupCycle();
    const admin = adminFor(cycle.id);

    const first = await importService.createImport(
      admin,
      cycle.id,
      "fall-2026-sample.xlsx",
      fixtureBase64(),
    );
    await importService.commitImport(admin, first.importId);

    const [candidacy] = await testDb.select().from(committeeCandidacy).limit(1);
    if (!candidacy) throw new Error("expected a candidacy from the import");

    await seedMembership({
      cycleId: cycle.id,
      userId: alice.id,
      role: "reviewer",
      committeeId: candidacy.committeeId,
    });
    const assignment = await seedAssignment({
      candidacyId: candidacy.id,
      reviewerUserId: alice.id,
    });
    const { rubric } = await seedRubric({ cycleId: cycle.id });

    const now = new Date();
    await testDb.insert(review).values({
      assignmentId: assignment.id,
      rubricId: rubric.id,
      rationale: "Human work that must survive a re-import.",
      submittedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const second = await importService.createImport(
      admin,
      cycle.id,
      "fall-2026-sample.xlsx",
      fixtureBase64(),
    );
    await importService.commitImport(admin, second.importId);

    const survivingReviews = await testDb.select().from(review);
    const survivingCandidacy = await testDb
      .select()
      .from(committeeCandidacy)
      .where(eq(committeeCandidacy.id, candidacy.id));

    expect(survivingReviews).toHaveLength(1);
    expect(survivingReviews[0]?.rationale).toBe("Human work that must survive a re-import.");
    expect(survivingCandidacy).toHaveLength(1);
  });

  it("records a per-row outcome an admin can act on", async () => {
    const { cycle } = await setupCycle();
    const admin = adminFor(cycle.id);

    const { importId } = await importService.createImport(
      admin,
      cycle.id,
      "fall-2026-sample.xlsx",
      fixtureBase64(),
    );
    await importService.commitImport(admin, importId);

    const rows = await importService.listImportRows(admin, importId);

    expect(rows.length).toBeGreaterThan(0);
    const errored = rows.filter((row) => row.status === "error");
    expect(errored.length).toBeGreaterThan(0);
    // Every failure names something actionable rather than failing silently.
    expect(errored.every((row) => (row.errorMessage ?? "").length > 0)).toBe(true);
  });
});

/**
 * `import_row.row_hash` was written from the day the table existed, with a
 * comment saying it detects an unchanged re-import, and compared by nothing.
 * Every commit therefore re-normalised and re-upserted every row and the
 * `skipped` counter was always zero. That was survivable while imports were
 * occasional and manual. A scheduled sheet sync makes it the normal case: an
 * hourly pull would rewrite all 118 applicants every hour.
 */
describe("re-importing the same rows", () => {
  it("skips every row whose content has not changed", async () => {
    const { cycle } = await setupCycle();
    const admin = adminFor(cycle.id);

    const first = await importService.createImport(
      admin,
      cycle.id,
      "fall-2026-sample.xlsx",
      fixtureBase64(),
    );
    const firstReport = await importService.commitImport(admin, first.importId);
    expect(firstReport.created).toBeGreaterThan(0);

    const second = await importService.createImport(
      admin,
      cycle.id,
      "fall-2026-sample.xlsx",
      fixtureBase64(),
    );
    const secondReport = await importService.commitImport(admin, second.importId);

    // Every row is accounted for, and the only ones re-applied are the two
    // that share an email: a duplicated applicant is always processed in full
    // so the later row still wins.
    expect(secondReport.created).toBe(0);
    expect(secondReport.skipped + secondReport.updated).toBe(
      firstReport.created + firstReport.updated,
    );
    expect(secondReport.skipped).toBeGreaterThan(0);
    expect(secondReport.updated).toBe(second.preview.duplicateEmails.length * 2);
  });

  it("writes nothing on the second run", async () => {
    const { cycle } = await setupCycle();
    const admin = adminFor(cycle.id);

    const first = await importService.createImport(
      admin,
      cycle.id,
      "fall-2026-sample.xlsx",
      fixtureBase64(),
    );
    await importService.commitImport(admin, first.importId);

    const before = await testDb
      .select({ id: application.id, updatedAt: application.updatedAt })
      .from(application)
      .where(eq(application.cycleId, cycle.id));

    const second = await importService.createImport(
      admin,
      cycle.id,
      "fall-2026-sample.xlsx",
      fixtureBase64(),
    );
    await importService.commitImport(admin, second.importId);

    const after = await testDb
      .select({ id: application.id, updatedAt: application.updatedAt, email: applicant.email })
      .from(application)
      .innerJoin(applicant, eq(application.applicantId, applicant.id))
      .where(eq(application.cycleId, cycle.id));

    expect(after).toHaveLength(before.length);

    // The applicant who appears twice in the file is rewritten on purpose;
    // everyone else must be untouched, down to the timestamp.
    const duplicated = new Set(second.preview.duplicateEmails);
    const beforeById = new Map(before.map((row) => [row.id, row.updatedAt?.getTime()]));
    const untouched = after.filter((row) => !duplicated.has(row.email));
    expect(untouched.length).toBeGreaterThan(0);
    for (const row of untouched) {
      expect(row.updatedAt?.getTime()).toBe(beforeById.get(row.id));
    }
  });
});
