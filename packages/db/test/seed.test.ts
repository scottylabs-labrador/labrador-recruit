/**
 * The development seed.
 *
 * Every other workstream develops against this, so its shape is a contract
 * rather than a convenience. These tests pin down what a developer can rely on
 * being there, and that running it twice is safe — v1's seed created its cycle
 * outright and died on the slug constraint, which meant dropping the database
 * to re-seed.
 */
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  application,
  candidateProfile,
  form,
  formResponse,
  formVersion,
  permissionGrant,
  question,
  recruitmentCycle,
  recruitmentOpening,
  review,
  reviewAssignment,
  rubric,
  rubricCriterion,
  team,
  user,
} from "../src/schema/index.ts";
import { seedDevelopmentData } from "../src/seed.ts";
import { db, resetDb } from "./harness.ts";

beforeEach(resetDb);

describe("seedDevelopmentData", () => {
  it("produces one open cycle", async () => {
    await seedDevelopmentData(db);

    const cycles = await db.select().from(recruitmentCycle);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]!.status).toBe("open");
  });

  it("produces committees including a subteam, so parent and child rules can be exercised", async () => {
    await seedDevelopmentData(db);

    const teams = await db.select().from(team);
    expect(teams.length).toBeGreaterThanOrEqual(3);
    expect(teams.filter((t) => t.parentTeamId !== null).length).toBeGreaterThanOrEqual(1);
  });

  it("opens every top-level committee for applications", async () => {
    await seedDevelopmentData(db);

    const openings = await db.select().from(recruitmentOpening);
    expect(openings.length).toBeGreaterThanOrEqual(2);
    expect(openings.every((o) => o.status === "open")).toBe(true);
  });

  it("publishes a common form with a conditional question", async () => {
    await seedDevelopmentData(db);

    const [common] = await db.select().from(form).where(eq(form.kind, "common"));
    const [version] = await db
      .select()
      .from(formVersion)
      .where(and(eq(formVersion.formId, common!.id), eq(formVersion.status, "published")));
    const questions = await db
      .select()
      .from(question)
      .where(eq(question.formVersionId, version!.id));

    expect(questions.length).toBeGreaterThanOrEqual(5);
    // The evaluator and the renderer both need a real rule to develop against.
    expect(questions.some((q) => q.visibilityRuleJson !== null)).toBe(true);
  });

  it("publishes a committee form per opening", async () => {
    await seedDevelopmentData(db);

    const openings = await db.select().from(recruitmentOpening);
    const committeeForms = await db.select().from(form).where(eq(form.kind, "committee"));

    expect(committeeForms).toHaveLength(openings.length);
  });

  it("produces applicants with a common response each", async () => {
    await seedDevelopmentData(db);

    const profiles = await db.select().from(candidateProfile);
    const commonResponses = await db
      .select()
      .from(formResponse)
      .where(isNotNull(formResponse.candidateProfileId));

    expect(profiles.length).toBeGreaterThanOrEqual(10);
    expect(commonResponses).toHaveLength(profiles.length);
  });

  it("produces applications across every status a developer needs to see", async () => {
    await seedDevelopmentData(db);

    const statuses = new Set((await db.select().from(application)).map((a) => a.status));

    for (const expected of ["draft", "submitted", "under_review", "shortlisted", "withdrawn"]) {
      expect(statuses).toContain(expected);
    }
  });

  it("produces staff grants covering every role", async () => {
    await seedDevelopmentData(db);

    const roles = new Set((await db.select().from(permissionGrant)).map((g) => g.role));

    expect(roles).toContain("org_admin");
    expect(roles).toContain("committee_director");
    expect(roles).toContain("question_editor");
    expect(roles).toContain("reviewer");
  });

  it("produces a rubric per opening with several criteria", async () => {
    await seedDevelopmentData(db);

    const openings = await db.select().from(recruitmentOpening);
    const rubrics = await db.select().from(rubric);
    const criteria = await db.select().from(rubricCriterion);

    expect(rubrics).toHaveLength(openings.length);
    expect(criteria.length).toBeGreaterThanOrEqual(rubrics.length * 3);
  });

  it("produces both a submitted and an unsubmitted review, so blinding is observable", async () => {
    await seedDevelopmentData(db);

    const submitted = await db.select().from(review).where(isNotNull(review.submittedAt));
    const drafts = await db.select().from(review).where(isNull(review.submittedAt));

    // Track B needs both to see the unblinding rule work without writing
    // fixtures of their own.
    expect(submitted.length).toBeGreaterThanOrEqual(1);
    expect(drafts.length).toBeGreaterThanOrEqual(1);
  });

  it("assigns reviewers to applications under review", async () => {
    await seedDevelopmentData(db);

    const assignments = await db.select().from(reviewAssignment);

    expect(assignments.length).toBeGreaterThanOrEqual(2);
  });

  it("is deterministic", async () => {
    await seedDevelopmentData(db);
    const first = (await db.select().from(user)).map((u) => u.id).sort();

    await seedDevelopmentData(db);
    const second = (await db.select().from(user)).map((u) => u.id).sort();

    // A failing test has to be reproducible, which rules out random ids.
    expect(second).toEqual(first);
  });

  it("can be run twice without dropping the database", async () => {
    await seedDevelopmentData(db);

    // v1's seed died here on the cycle slug's unique constraint, so re-seeding
    // meant dropping the database. Nobody should have to learn that twice.
    await seedDevelopmentData(db);

    const cycles = await db.select().from(recruitmentCycle);
    expect(cycles).toHaveLength(1);
  });
});
