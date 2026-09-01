import {
  committeeCandidacy,
  committeePreference,
  recruitmentCycle,
  reviewAssignment,
  rubricCriterion,
} from "@labrador/db/schema";
import { seedRecruitmentData } from "@labrador/db/seed";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { testDb } from "./harness.ts";

/**
 * The development seed is a real migration consumer, so exercising it against
 * PGlite is the cheapest way to catch a schema change that breaks local setup
 * before a contributor hits it.
 */
describe("development seed", () => {
  it("populates a complete cycle", async () => {
    const summary = await seedRecruitmentData(
      testDb as unknown as Parameters<typeof seedRecruitmentData>[0],
    );

    expect(summary.committeeCount).toBe(7);
    expect(summary.applicantCount).toBe(12);
    // Every applicant gets a candidacy for each of their three preferences.
    expect(summary.candidacyCount).toBe(36);
    expect(summary.assignmentCount).toBeGreaterThan(0);

    const [cycle] = await testDb
      .select()
      .from(recruitmentCycle)
      .where(eq(recruitmentCycle.id, summary.cycleId));

    expect(cycle?.slug).toBe("fall-2026");
    expect(cycle?.minimumReviews).toBe(3);
  });

  it("ranks all seven committees for every applicant, not just their top three", async () => {
    const summary = await seedRecruitmentData(
      testDb as unknown as Parameters<typeof seedRecruitmentData>[0],
    );

    const preferences = await testDb.select().from(committeePreference);

    expect(preferences).toHaveLength(summary.applicantCount * 7);
    expect(preferences.every((row) => row.rank >= 1 && row.rank <= 7)).toBe(true);
  });

  it("creates a rubric whose weights sum to one", async () => {
    await seedRecruitmentData(testDb as unknown as Parameters<typeof seedRecruitmentData>[0]);

    const criteria = await testDb.select().from(rubricCriterion);
    const total = criteria.reduce((sum, row) => sum + Number(row.weight), 0);

    expect(criteria).toHaveLength(6);
    expect(total).toBeCloseTo(1, 6);
  });

  it("never assigns the same reviewer to a candidacy twice", async () => {
    await seedRecruitmentData(testDb as unknown as Parameters<typeof seedRecruitmentData>[0]);

    const assignments = await testDb.select().from(reviewAssignment);
    const pairs = assignments.map((row) => `${row.candidacyId}:${row.reviewerUserId}`);

    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it("only creates candidacies for committees the applicant actually ranked", async () => {
    await seedRecruitmentData(testDb as unknown as Parameters<typeof seedRecruitmentData>[0]);

    const candidacies = await testDb.select().from(committeeCandidacy);
    const preferences = await testDb.select().from(committeePreference);

    const ranked = new Set(
      preferences
        .filter((row) => row.rank <= 3)
        .map((row) => `${row.applicationId}:${row.committeeId}`),
    );

    for (const candidacy of candidacies) {
      expect(ranked.has(`${candidacy.applicationId}:${candidacy.committeeId}`)).toBe(true);
    }
  });
});
