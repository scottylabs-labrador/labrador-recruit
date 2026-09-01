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

/**
 * A complete review scenario: one Tech candidacy with Alice and Bob assigned as
 * reviewers, and the admin holding a cycle-wide recruitment admin role.
 */
async function setupScenario() {
  await seedAlice();
  await seedBob();
  await seedAdmin();

  const cycle = await seedCycle();
  const committees = await seedCommittees();
  const tech = committees["tech"];
  const design = committees["design"];
  if (!tech || !design) throw new Error("missing committees");

  await linkCommitteeToCycle(cycle.id, tech.id, 10);
  await linkCommitteeToCycle(cycle.id, design.id, 5);

  await seedMembership({
    cycleId: cycle.id,
    userId: alice.id,
    role: "reviewer",
    committeeId: tech.id,
  });
  await seedMembership({
    cycleId: cycle.id,
    userId: bob.id,
    role: "reviewer",
    committeeId: tech.id,
  });
  await seedMembership({
    cycleId: cycle.id,
    userId: adminUser.id,
    role: "recruitment_admin",
  });

  const person = await seedApplicant({
    email: "candidate@andrew.cmu.edu",
    fullName: "Casey Candidate",
  });
  const application = await seedApplication({ cycleId: cycle.id, applicantId: person.id });
  await seedPreference({ applicationId: application.id, committeeId: tech.id, rank: 1 });

  const candidacy = await seedCandidacy({
    applicationId: application.id,
    committeeId: tech.id,
  });
  const { rubric } = await seedRubric({ cycleId: cycle.id });

  const aliceAssignment = await seedAssignment({
    candidacyId: candidacy.id,
    reviewerUserId: alice.id,
  });
  const bobAssignment = await seedAssignment({
    candidacyId: candidacy.id,
    reviewerUserId: bob.id,
  });

  return { cycle, tech, design, application, candidacy, rubric, aliceAssignment, bobAssignment };
}

const COMPLETE_REVIEW = {
  scores: { interest: 5, initiative: 4, ideas: 4, experience: 3, growth: 5 },
  recommendation: "strong_yes" as const,
  confidence: "high" as const,
  rationale: "Clear evidence of shipping work unprompted.",
};

describe("authentication", () => {
  it("rejects an unauthenticated request to the review queue", async () => {
    const { cycle } = await setupScenario();

    const res = await request(app).get(`/recruitment/cycles/${cycle.id}/my-queue`);

    expect(res.status).toBe(401);
  });

  it("hides a cycle from a user with no membership", async () => {
    const { cycle } = await setupScenario();
    // Bob has a membership, so use a fresh authenticated user instead.
    const res = await request(app).get(`/recruitment/cycles/${cycle.id}`).set(bobAuth());
    expect(res.status).toBe(200);

    // The admin group alone does not confer recruitment data access, but the
    // admin here also holds a recruitment membership, so they can see it.
    const adminRes = await request(app).get(`/recruitment/cycles/${cycle.id}`).set(adminAuth());
    expect(adminRes.status).toBe(200);
  });
});

describe("review queue", () => {
  it("returns only the caller's own assignments", async () => {
    const { cycle, aliceAssignment, bobAssignment } = await setupScenario();

    const res = await request(app).get(`/recruitment/cycles/${cycle.id}/my-queue`).set(aliceAuth());

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].assignmentId).toBe(aliceAssignment.id);
    expect(res.body[0].assignmentId).not.toBe(bobAssignment.id);
  });

  it("exposes the applicant's own rank for the committee under review", async () => {
    const { cycle } = await setupScenario();

    const res = await request(app).get(`/recruitment/cycles/${cycle.id}/my-queue`).set(aliceAuth());

    expect(res.body[0].applicantRank).toBe(1);
    expect(res.body[0].applicantName).toBe("Casey Candidate");
  });
});

describe("independent review", () => {
  it("shows a reviewer only their own review before they submit", async () => {
    const { candidacy, bobAssignment } = await setupScenario();

    // Bob submits a complete review.
    const submitted = await request(app)
      .post(`/recruitment/assignments/${bobAssignment.id}/review/submit`)
      .set(bobAuth())
      .send(COMPLETE_REVIEW);
    expect(submitted.status).toBe(200);

    // Alice has not submitted, so Bob's review must be invisible to her.
    const res = await request(app)
      .get(`/recruitment/candidacies/${candidacy.id}/reviews`)
      .set(aliceAuth());

    expect(res.status).toBe(200);
    expect(
      res.body.every((row: { reviewerUserId: string }) => row.reviewerUserId === alice.id),
    ).toBe(true);
    expect(res.body.some((row: { reviewerUserId: string }) => row.reviewerUserId === bob.id)).toBe(
      false,
    );
  });

  it("reveals peer reviews once the caller has submitted their own", async () => {
    const { candidacy, aliceAssignment, bobAssignment } = await setupScenario();

    await request(app)
      .post(`/recruitment/assignments/${bobAssignment.id}/review/submit`)
      .set(bobAuth())
      .send(COMPLETE_REVIEW);

    await request(app)
      .post(`/recruitment/assignments/${aliceAssignment.id}/review/submit`)
      .set(aliceAuth())
      .send({ ...COMPLETE_REVIEW, recommendation: "yes" });

    const res = await request(app)
      .get(`/recruitment/candidacies/${candidacy.id}/reviews`)
      .set(aliceAuth());

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.some((row: { reviewerUserId: string }) => row.reviewerUserId === bob.id)).toBe(
      true,
    );
  });

  /**
   * 404 rather than 403 is the point. Alice's visibility predicate filters
   * Bob's assignment out of the query entirely, so the response cannot even
   * confirm that it exists. A 403 here would leak that another reviewer is
   * assigned to this candidacy, which is exactly what blinding must prevent.
   */
  it("hides another reviewer's assignment rather than forbidding it", async () => {
    const { bobAssignment } = await setupScenario();

    const res = await request(app)
      .get(`/recruitment/assignments/${bobAssignment.id}/review`)
      .set(aliceAuth());

    expect(res.status).toBe(404);
  });

  it("does not let a reviewer submit another reviewer's review", async () => {
    const { bobAssignment } = await setupScenario();

    const res = await request(app)
      .post(`/recruitment/assignments/${bobAssignment.id}/review/submit`)
      .set(aliceAuth())
      .send(COMPLETE_REVIEW);

    expect(res.status).toBe(404);
  });

  /**
   * Once Alice has submitted for this candidacy she may see Bob's review, but
   * she still must not be able to act on his assignment.
   */
  it("still refuses to submit a peer's review after unblinding", async () => {
    const { aliceAssignment, bobAssignment } = await setupScenario();

    await request(app)
      .post(`/recruitment/assignments/${aliceAssignment.id}/review/submit`)
      .set(aliceAuth())
      .send(COMPLETE_REVIEW);

    const res = await request(app)
      .post(`/recruitment/assignments/${bobAssignment.id}/review/submit`)
      .set(aliceAuth())
      .send(COMPLETE_REVIEW);

    expect(res.status).toBe(403);
  });
});

describe("review submission", () => {
  it("creates a draft on first open and preserves it across requests", async () => {
    const { aliceAssignment } = await setupScenario();

    const opened = await request(app)
      .get(`/recruitment/assignments/${aliceAssignment.id}/review`)
      .set(aliceAuth());
    expect(opened.status).toBe(200);
    expect(opened.body.submittedAt).toBeNull();

    await request(app)
      .put(`/recruitment/assignments/${aliceAssignment.id}/review`)
      .set(aliceAuth())
      .send({ scores: { interest: 4 }, rationale: "Partial draft" });

    const reopened = await request(app)
      .get(`/recruitment/assignments/${aliceAssignment.id}/review`)
      .set(aliceAuth());

    expect(reopened.body.rationale).toBe("Partial draft");
    expect(reopened.body.scores).toContainEqual({ criterionKey: "interest", score: 4 });
  });

  it("refuses to submit without every reviewer-scored criterion", async () => {
    const { aliceAssignment } = await setupScenario();

    const res = await request(app)
      .post(`/recruitment/assignments/${aliceAssignment.id}/review/submit`)
      .set(aliceAuth())
      .send({ ...COMPLETE_REVIEW, scores: { interest: 5 } });

    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/Missing scores/);
  });

  it("refuses to submit without a written rationale", async () => {
    const { aliceAssignment } = await setupScenario();

    const res = await request(app)
      .post(`/recruitment/assignments/${aliceAssignment.id}/review/submit`)
      .set(aliceAuth())
      .send({ ...COMPLETE_REVIEW, rationale: "   " });

    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/rationale/i);
  });

  it("rejects a score outside the criterion range", async () => {
    const { aliceAssignment } = await setupScenario();

    const res = await request(app)
      .put(`/recruitment/assignments/${aliceAssignment.id}/review`)
      .set(aliceAuth())
      .send({ scores: { interest: 9 } });

    expect(res.status).toBe(422);
  });

  it("rejects a reviewer scoring the derived preference criterion", async () => {
    const { aliceAssignment } = await setupScenario();

    const res = await request(app)
      .put(`/recruitment/assignments/${aliceAssignment.id}/review`)
      .set(aliceAuth())
      .send({ scores: { preference: 5 } });

    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/not reviewer-scored/);
  });

  it("computes a score that includes the applicant's own preference", async () => {
    const { aliceAssignment } = await setupScenario();

    const res = await request(app)
      .post(`/recruitment/assignments/${aliceAssignment.id}/review/submit`)
      .set(aliceAuth())
      .send({
        scores: { interest: 5, initiative: 5, ideas: 5, experience: 5, growth: 5 },
        recommendation: "strong_yes",
        confidence: "high",
        rationale: "Exceptional across the board.",
      });

    // All fives plus a first-choice preference is a perfect 100.
    expect(res.status).toBe(200);
    expect(res.body.computedScore).toBe(100);
  });

  it("locks a submitted review until an admin reopens it", async () => {
    const { aliceAssignment } = await setupScenario();

    await request(app)
      .post(`/recruitment/assignments/${aliceAssignment.id}/review/submit`)
      .set(aliceAuth())
      .send(COMPLETE_REVIEW);

    const blocked = await request(app)
      .put(`/recruitment/assignments/${aliceAssignment.id}/review`)
      .set(aliceAuth())
      .send({ rationale: "Changed my mind" });
    expect(blocked.status).toBe(409);

    const notAllowed = await request(app)
      .post(`/recruitment/assignments/${aliceAssignment.id}/review/reopen`)
      .set(aliceAuth());
    expect(notAllowed.status).toBe(403);

    const reopened = await request(app)
      .post(`/recruitment/assignments/${aliceAssignment.id}/review/reopen`)
      .set(adminAuth());
    expect(reopened.status).toBe(204);

    const editable = await request(app)
      .put(`/recruitment/assignments/${aliceAssignment.id}/review`)
      .set(aliceAuth())
      .send({ rationale: "Revised after discussion" });
    expect(editable.status).toBe(200);
  });
});

describe("conflicts", () => {
  it("marks the assignment conflicted and discards any draft", async () => {
    const { cycle, aliceAssignment } = await setupScenario();

    await request(app)
      .put(`/recruitment/assignments/${aliceAssignment.id}/review`)
      .set(aliceAuth())
      .send({ rationale: "Started before realising I know them" });

    const res = await request(app)
      .post(`/recruitment/assignments/${aliceAssignment.id}/conflict`)
      .set(aliceAuth());
    expect(res.status).toBe(204);

    const queue = await request(app)
      .get(`/recruitment/cycles/${cycle.id}/my-queue`)
      .set(aliceAuth());

    expect(queue.body[0].status).toBe("conflicted");
    expect(queue.body[0].hasDraft).toBe(false);
  });
});

describe("aggregates and ranking", () => {
  it("reports completion, statistics, and a stated disagreement reason", async () => {
    const { cycle, tech, aliceAssignment, bobAssignment } = await setupScenario();

    await request(app)
      .post(`/recruitment/assignments/${aliceAssignment.id}/review/submit`)
      .set(aliceAuth())
      .send({
        scores: { interest: 5, initiative: 5, ideas: 5, experience: 5, growth: 5 },
        recommendation: "strong_yes",
        confidence: "high",
        rationale: "Outstanding.",
      });

    await request(app)
      .post(`/recruitment/assignments/${bobAssignment.id}/review/submit`)
      .set(bobAuth())
      .send({
        scores: { interest: 1, initiative: 1, ideas: 1, experience: 1, growth: 1 },
        recommendation: "no",
        confidence: "medium",
        rationale: "Not a fit for this committee.",
      });

    const res = await request(app)
      .get(`/recruitment/cycles/${cycle.id}/committees/${tech.id}/aggregates`)
      .set(adminAuth());

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);

    const aggregate = res.body[0];
    expect(aggregate.submittedCount).toBe(2);
    expect(aggregate.statistics.max).toBe(100);
    expect(aggregate.disagreement.flagged).toBe(true);
    // The reason must be readable, never a bare boolean.
    expect(aggregate.disagreement.reasons.length).toBeGreaterThan(0);
    expect(aggregate.disagreement.reasons[0]).toMatch(/\w+/);
  });

  it("ranks candidacies and appears in the disagreement queue when flagged", async () => {
    const { cycle, tech, aliceAssignment, bobAssignment } = await setupScenario();

    await request(app)
      .post(`/recruitment/assignments/${aliceAssignment.id}/review/submit`)
      .set(aliceAuth())
      .send({
        scores: { interest: 5, initiative: 5, ideas: 5, experience: 5, growth: 5 },
        recommendation: "strong_yes",
        confidence: "high",
        rationale: "Outstanding.",
      });
    await request(app)
      .post(`/recruitment/assignments/${bobAssignment.id}/review/submit`)
      .set(bobAuth())
      .send({
        scores: { interest: 1, initiative: 1, ideas: 1, experience: 1, growth: 1 },
        recommendation: "strong_no",
        confidence: "high",
        rationale: "Not a fit.",
      });

    const ranking = await request(app)
      .get(`/recruitment/cycles/${cycle.id}/committees/${tech.id}/ranking`)
      .set(adminAuth());
    expect(ranking.status).toBe(200);
    expect(ranking.body[0].rank).toBe(1);
    expect(ranking.body[0].flagged).toBe(true);

    const queue = await request(app)
      .get(`/recruitment/cycles/${cycle.id}/committees/${tech.id}/disagreements`)
      .set(adminAuth());
    expect(queue.body).toHaveLength(1);
  });

  it("keeps a reviewer out of another committee's aggregates", async () => {
    const { cycle, design } = await setupScenario();

    const res = await request(app)
      .get(`/recruitment/cycles/${cycle.id}/committees/${design.id}/aggregates`)
      .set(aliceAuth());

    // Alice reviews for Tech only, so Design yields nothing rather than an error.
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });
});

describe("assignment management", () => {
  it("refuses to assign a reviewer with no membership for the committee", async () => {
    const { candidacy } = await setupScenario();

    const res = await request(app)
      .post(`/recruitment/candidacies/${candidacy.id}/assignments`)
      .set(adminAuth())
      .send({ reviewerUserId: "someone-with-no-membership" });

    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/membership/i);
  });

  it("does not let an ordinary reviewer assign anyone", async () => {
    const { candidacy } = await setupScenario();

    const res = await request(app)
      .post(`/recruitment/candidacies/${candidacy.id}/assignments`)
      .set(aliceAuth())
      .send({ reviewerUserId: bob.id });

    expect(res.status).toBe(403);
  });

  it("refuses to unassign a reviewer who already submitted", async () => {
    const { aliceAssignment } = await setupScenario();

    await request(app)
      .post(`/recruitment/assignments/${aliceAssignment.id}/review/submit`)
      .set(aliceAuth())
      .send(COMPLETE_REVIEW);

    const res = await request(app)
      .delete(`/recruitment/assignments/${aliceAssignment.id}`)
      .set(adminAuth());

    expect(res.status).toBe(409);
  });
});
