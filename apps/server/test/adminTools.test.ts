import { review, rubric as rubricTable } from "@labrador/db/schema";
import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { app } from "../src/app.ts";
import {
  adminAuth,
  adminUser,
  alice,
  aliceAuth,
  bob,
  bobAuth,
  seedAdmin,
  seedAlice,
  seedBob,
} from "./fixtures.ts";
import { testDb } from "./harness.ts";
import {
  linkCommitteeToCycle,
  seedApplicant,
  seedApplication,
  seedAssignment,
  seedCandidacy,
  seedCommittees,
  seedCycle,
  seedMembership,
  seedPreference,
  seedRubric,
} from "./recruitmentFixtures.ts";

const VALID_CRITERIA = [
  { key: "interest", label: "Interest", weight: 0.5 },
  { key: "initiative", label: "Initiative", weight: 0.5 },
];

async function setup() {
  await seedAlice();
  await seedAdmin();

  const cycle = await seedCycle();
  const committees = await seedCommittees();
  const tech = committees["tech"];
  if (!tech) throw new Error("missing tech");
  await linkCommitteeToCycle(cycle.id, tech.id, 10);

  await seedMembership({ cycleId: cycle.id, userId: adminUser.id, role: "recruitment_admin" });
  await seedMembership({
    cycleId: cycle.id,
    userId: alice.id,
    role: "reviewer",
    committeeId: tech.id,
  });

  const person = await seedApplicant({ email: "ex@andrew.cmu.edu", fullName: "Ex Ample" });
  const application = await seedApplication({ cycleId: cycle.id, applicantId: person.id });
  await seedPreference({ applicationId: application.id, committeeId: tech.id, rank: 1 });
  const candidacy = await seedCandidacy({ applicationId: application.id, committeeId: tech.id });
  const { rubric } = await seedRubric({ cycleId: cycle.id });
  const assignment = await seedAssignment({
    candidacyId: candidacy.id,
    reviewerUserId: alice.id,
  });

  return { cycle, tech, application, candidacy, rubric, assignment };
}

describe("exports", () => {
  it("carries the arithmetic beside each ranking row so a reader can reproduce it", async () => {
    const { cycle, tech, assignment } = await setup();

    await request(app)
      .post(`/recruitment/assignments/${assignment.id}/review/submit`)
      .set(aliceAuth())
      .send({
        scores: { interest: 5, initiative: 5, ideas: 5, experience: 5, growth: 5 },
        recommendation: "strong_yes",
        confidence: "high",
        rationale: "Outstanding.",
      });

    const res = await request(app)
      .get(`/recruitment/cycles/${cycle.id}/exports/committees/${tech.id}/ranking`)
      .set(adminAuth());

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);

    const row = res.body[0];
    expect(row.rank).toBe(1);
    expect(row.applicantName).toBe("Ex Ample");
    expect(row.submittedReviews).toBe(1);
    expect(row.minimumReviews).toBe(3);
    expect(row.mean).toBe(100);
    expect(row.strongYes).toBe(1);
    expect(row.applicantRank).toBe(1);
    expect(row.decision).toBe("pending");
  });

  it("refuses a decisions export to anyone who cannot make placements", async () => {
    const { cycle } = await setup();

    const denied = await request(app)
      .get(`/recruitment/cycles/${cycle.id}/exports/decisions`)
      .set(aliceAuth());
    expect(denied.status).toBe(403);

    const allowed = await request(app)
      .get(`/recruitment/cycles/${cycle.id}/exports/decisions`)
      .set(adminAuth());
    expect(allowed.status).toBe(200);
  });

  /** Coverage reporting should be circulatable without exposing candidates. */
  it("keeps applicant data out of the reviewer load export", async () => {
    const { cycle } = await setup();

    const res = await request(app)
      .get(`/recruitment/cycles/${cycle.id}/exports/reviewer-load`)
      .set(adminAuth());

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);

    const serialised = JSON.stringify(res.body);
    expect(serialised).not.toContain("Ex Ample");
    expect(serialised).not.toContain("ex@andrew.cmu.edu");

    const reviewerRow = res.body.find(
      (row: { reviewerUserId: string }) => row.reviewerUserId === alice.id,
    );
    expect(reviewerRow.assigned).toBe(1);
    expect(reviewerRow.submitted).toBe(0);
    expect(reviewerRow.outstanding).toBe(1);
  });

  /**
   * Reviewer coverage is the one export with no applicant data, so requiring
   * placement rights inverted the privacy story: a lead could pull the
   * PII-bearing ranking for their committee but not the PII-free report they
   * need in order to ask for more reviewers.
   */
  it("lets a committee lead pull coverage, which carries no applicant data", async () => {
    const { cycle, tech } = await setup();
    await seedBob();
    await seedMembership({
      cycleId: cycle.id,
      userId: bob.id,
      role: "committee_lead",
      committeeId: tech.id,
    });

    const coverage = await request(app)
      .get(`/recruitment/cycles/${cycle.id}/exports/reviewer-load`)
      .set(bobAuth());
    expect(coverage.status).toBe(200);

    // But decisions, which do carry applicant data, stay with placement rights.
    const decisions = await request(app)
      .get(`/recruitment/cycles/${cycle.id}/exports/decisions`)
      .set(bobAuth());
    expect(decisions.status).toBe(403);
  });

  it("still refuses coverage to an ordinary reviewer", async () => {
    const { cycle } = await setup();

    const res = await request(app)
      .get(`/recruitment/cycles/${cycle.id}/exports/reviewer-load`)
      .set(aliceAuth());

    expect(res.status).toBe(403);
  });

  it("records every export in the audit log", async () => {
    const { cycle } = await setup();

    await request(app).get(`/recruitment/cycles/${cycle.id}/exports/decisions`).set(adminAuth());

    const audit = await request(app).get(`/recruitment/cycles/${cycle.id}/audit`).set(adminAuth());

    expect(audit.body.some((row: { action: string }) => row.action === "export.decisions")).toBe(
      true,
    );
  });
});

describe("committee configuration", () => {
  /**
   * Before this endpoint the development seed was the only thing that could
   * create a committee, so a real cycle could not be configured without shell
   * access to the server.
   */
  it("creates a committee and attaches it to the cycle", async () => {
    const { cycle } = await setup();

    const res = await request(app)
      .post(`/recruitment/cycles/${cycle.id}/committees`)
      .set(adminAuth())
      .send({ slug: "labrador", name: "Labrador", capacity: 12, displayOrder: 5 });

    expect(res.status).toBe(201);
    expect(res.body.slug).toBe("labrador");
    expect(res.body.capacity).toBe(12);

    const listed = await request(app)
      .get(`/recruitment/cycles/${cycle.id}/committees`)
      .set(adminAuth());
    expect(listed.body.map((row: { slug: string }) => row.slug)).toContain("labrador");
  });

  it("is idempotent, updating capacity rather than failing on a second call", async () => {
    const { cycle } = await setup();

    await request(app)
      .post(`/recruitment/cycles/${cycle.id}/committees`)
      .set(adminAuth())
      .send({ slug: "labrador", name: "Labrador", capacity: 12 });

    const again = await request(app)
      .post(`/recruitment/cycles/${cycle.id}/committees`)
      .set(adminAuth())
      .send({ slug: "labrador", name: "Labrador", capacity: 20 });

    expect(again.status).toBe(201);
    expect(again.body.capacity).toBe(20);

    const listed = await request(app)
      .get(`/recruitment/cycles/${cycle.id}/committees`)
      .set(adminAuth());
    const labrador = listed.body.filter((row: { slug: string }) => row.slug === "labrador");
    expect(labrador).toHaveLength(1);
  });

  it("normalises the slug so casing cannot create a second committee", async () => {
    const { cycle } = await setup();

    await request(app)
      .post(`/recruitment/cycles/${cycle.id}/committees`)
      .set(adminAuth())
      .send({ slug: "Labrador", name: "Labrador" });

    const listed = await request(app)
      .get(`/recruitment/cycles/${cycle.id}/committees`)
      .set(adminAuth());
    expect(listed.body.filter((row: { slug: string }) => row.slug === "labrador")).toHaveLength(1);
  });

  it("refuses a blank name rather than creating an unnamed committee", async () => {
    const { cycle } = await setup();

    const res = await request(app)
      .post(`/recruitment/cycles/${cycle.id}/committees`)
      .set(adminAuth())
      .send({ slug: "ghost", name: "   " });

    expect(res.status).toBe(422);
  });

  it("does not let a reviewer configure committees", async () => {
    const { cycle } = await setup();

    const res = await request(app)
      .post(`/recruitment/cycles/${cycle.id}/committees`)
      .set(aliceAuth())
      .send({ slug: "labrador", name: "Labrador" });

    expect(res.status).toBe(403);
  });
});

describe("rubric versions", () => {
  it("publishes a new version and deactivates the previous one", async () => {
    const { cycle, rubric } = await setup();

    const res = await request(app)
      .post(`/recruitment/cycles/${cycle.id}/rubrics`)
      .set(adminAuth())
      .send({ name: "Revised", criteria: VALID_CRITERIA });

    expect(res.status).toBe(201);
    expect(res.body.version).toBe(2);
    expect(res.body.active).toBe(true);
    expect(res.body.criteria).toHaveLength(2);

    const [previous] = await testDb.select().from(rubricTable).where(eq(rubricTable.id, rubric.id));
    expect(previous?.active).toBe(false);
  });

  /**
   * The guarantee that makes rubric editing safe: a submitted review keeps the
   * version it was scored under, so revising policy never restates what a
   * reviewer meant earlier.
   */
  it("leaves an existing review pinned to the version it was scored under", async () => {
    const { cycle, rubric, assignment } = await setup();

    await request(app)
      .post(`/recruitment/assignments/${assignment.id}/review/submit`)
      .set(aliceAuth())
      .send({
        scores: { interest: 4, initiative: 4, ideas: 4, experience: 4, growth: 4 },
        recommendation: "yes",
        confidence: "high",
        rationale: "Solid.",
      });

    await request(app)
      .post(`/recruitment/cycles/${cycle.id}/rubrics`)
      .set(adminAuth())
      .send({ name: "Revised", criteria: VALID_CRITERIA });

    const [existing] = await testDb
      .select()
      .from(review)
      .where(eq(review.assignmentId, assignment.id));

    expect(existing?.rubricId).toBe(rubric.id);
    // And the score it was given is unchanged by the new weights.
    expect(Number(existing?.computedScore)).toBeGreaterThan(0);
  });

  it("refuses weights that do not sum to one rather than rescaling them", async () => {
    const { cycle } = await setup();

    const res = await request(app)
      .post(`/recruitment/cycles/${cycle.id}/rubrics`)
      .set(adminAuth())
      .send({
        name: "Broken",
        criteria: [
          { key: "a", label: "A", weight: 0.5 },
          { key: "b", label: "B", weight: 0.3 },
        ],
      });

    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/weight/i);
  });

  it("refuses a duplicate criterion key", async () => {
    const { cycle } = await setup();

    const res = await request(app)
      .post(`/recruitment/cycles/${cycle.id}/rubrics`)
      .set(adminAuth())
      .send({
        name: "Dup",
        criteria: [
          { key: "same", label: "One", weight: 0.5 },
          { key: "same", label: "Two", weight: 0.5 },
        ],
      });

    expect(res.status).toBe(422);
  });

  it("validates a draft without saving it", async () => {
    const { cycle } = await setup();

    const invalid = await request(app)
      .post(`/recruitment/cycles/${cycle.id}/rubrics/validate`)
      .set(adminAuth())
      .send({ criteria: [{ key: "a", label: "A", weight: 0.9 }] });

    expect(invalid.status).toBe(200);
    expect(invalid.body.valid).toBe(false);
    expect(invalid.body.issues.length).toBeGreaterThan(0);

    const valid = await request(app)
      .post(`/recruitment/cycles/${cycle.id}/rubrics/validate`)
      .set(adminAuth())
      .send({ criteria: VALID_CRITERIA });
    expect(valid.body.valid).toBe(true);

    // Nothing was persisted by either call.
    const versions = await request(app)
      .get(`/recruitment/cycles/${cycle.id}/rubrics`)
      .set(adminAuth());
    expect(versions.body).toHaveLength(1);
  });

  it("reports how many submitted reviews depend on each version", async () => {
    const { cycle, assignment } = await setup();

    await request(app)
      .post(`/recruitment/assignments/${assignment.id}/review/submit`)
      .set(aliceAuth())
      .send({
        scores: { interest: 3, initiative: 3, ideas: 3, experience: 3, growth: 3 },
        recommendation: "unsure",
        confidence: "medium",
        rationale: "Middling.",
      });

    const res = await request(app).get(`/recruitment/cycles/${cycle.id}/rubrics`).set(adminAuth());

    expect(res.body[0].reviewCount).toBe(1);
  });

  it("does not let a reviewer publish or read rubric configuration", async () => {
    const { cycle } = await setup();

    const read = await request(app).get(`/recruitment/cycles/${cycle.id}/rubrics`).set(aliceAuth());
    expect(read.status).toBe(403);

    const write = await request(app)
      .post(`/recruitment/cycles/${cycle.id}/rubrics`)
      .set(aliceAuth())
      .send({ name: "Nope", criteria: VALID_CRITERIA });
    expect(write.status).toBe(403);
  });
});
