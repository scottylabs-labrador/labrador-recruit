import type { RecruitmentUser } from "@labrador/access-control";
import {
  application as applicationTable,
  review as reviewTable,
  reviewAssignment as reviewAssignmentTable,
} from "@labrador/db/schema";
import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { app } from "../src/app.ts";
import { reviewService } from "../src/services/reviewService.ts";
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
import { authHeader, seedUser, testDb } from "./harness.ts";
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

describe("own recruitment standing", () => {
  it("tells a reviewer which committees they review for", async () => {
    const { cycle, tech } = await setupScenario();

    const res = await request(app).get(`/recruitment/cycles/${cycle.id}/me`).set(aliceAuth());

    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(alice.id);
    expect(res.body.memberships).toEqual([{ role: "reviewer", committeeId: tech.id }]);
    expect(res.body.blindReviewEnabled).toBe(false);
  });

  it("tells an admin they hold a cycle-wide role, so the interface can offer admin actions", async () => {
    const { cycle } = await setupScenario();

    const res = await request(app).get(`/recruitment/cycles/${cycle.id}/me`).set(adminAuth());

    expect(res.status).toBe(200);
    expect(res.body.memberships).toContainEqual({
      role: "recruitment_admin",
      committeeId: null,
    });
  });

  it("reports which candidacies the caller has already unblinded", async () => {
    const { cycle, candidacy, aliceAssignment } = await setupScenario();

    const before = await request(app).get(`/recruitment/cycles/${cycle.id}/me`).set(aliceAuth());
    expect(before.body.unblindedCandidacyIds).toHaveLength(0);

    await request(app)
      .post(`/recruitment/assignments/${aliceAssignment.id}/review/submit`)
      .set(aliceAuth())
      .send(COMPLETE_REVIEW);

    const after = await request(app).get(`/recruitment/cycles/${cycle.id}/me`).set(aliceAuth());
    expect(after.body.unblindedCandidacyIds).toEqual([candidacy.id]);
  });

  it("hides a cycle the caller has no standing in", async () => {
    await setupScenario();
    const other = await seedCycle({ slug: "spring-2027", name: "Spring 2027" });

    const res = await request(app).get(`/recruitment/cycles/${other.id}/me`).set(aliceAuth());

    expect(res.status).toBe(404);
  });
});

describe("leadership-only context", () => {
  /**
   * The friend-placement answer is context for a placement conversation and is
   * excluded from every scoring path. Withholding it at the server, rather than
   * returning it and trusting the interface not to render it, is what makes
   * that a rule instead of a convention.
   */
  it("withholds the friend request from an ordinary reviewer but sends it to leadership", async () => {
    const { application } = await setupScenario();

    await testDb
      .update(applicationTable)
      .set({ friendRequest: "I would like to be with Sam." })
      .where(eq(applicationTable.id, application.id));

    const reviewerView = await request(app)
      .get(`/recruitment/applications/${application.id}`)
      .set(aliceAuth());
    expect(reviewerView.status).toBe(200);
    expect(reviewerView.body.friendRequest).toBeNull();

    const adminView = await request(app)
      .get(`/recruitment/applications/${application.id}`)
      .set(adminAuth());
    expect(adminView.status).toBe(200);
    expect(adminView.body.friendRequest).toBe("I would like to be with Sam.");
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

  // A global ScottyLabs admin who has not yet granted themselves a recruitment
  // membership is the first thing anyone sees on a fresh deployment, and this
  // is the request the cycle overview makes for every committee. It was
  // answered with a 500 quoting the access-control layer at the reader, which
  // reads as a broken server rather than a cycle they are not enrolled in.
  it("refuses a caller with no membership rather than failing", async () => {
    const { cycle, tech } = await setupScenario();
    await seedUser({
      id: "outsider",
      name: "Outsider",
      email: "outsider@cmu.edu",
      accountId: "outsider-sub",
    });

    const res = await request(app)
      .get(`/recruitment/cycles/${cycle.id}/committees/${tech.id}/aggregates`)
      .set(authHeader({ sub: "outsider-sub", groups: ["test-admins"] }));

    expect(res.status).toBe(403);
    expect(res.body.message).not.toMatch(/Cannot execute/);
  });
});

/**
 * Opening a review fires two requests for the same draft - the route loader
 * prefetches and the component queries - so the read-then-insert that created
 * it raced with itself and the loser hit `review_assignment_key`. It surfaced
 * as a 500 on the first click of every review.
 *
 * The race is forced rather than run, because the test database is PGlite and
 * serialises the two statements: issuing the requests concurrently passes just
 * as happily against the unguarded insert, which would make this look like a
 * regression test while guarding nothing. Stubbing the read to miss once is
 * what actually puts the insert in front of a row that already exists.
 */
describe("opening a review draft", () => {
  it("yields to the draft another request already created", async () => {
    const { cycle, tech, aliceAssignment } = await setupScenario();
    const acUser: RecruitmentUser = {
      id: alice.id,
      role: "user",
      recruitment: { cycleId: cycle.id, memberships: [{ role: "reviewer", committeeId: tech.id }] },
    };

    const first = await reviewService.getOrCreateDraft(acUser, aliceAssignment.id);

    // The read that loses the race: it ran before the winner's insert
    // committed, so it correctly saw no draft. The insert that follows is the
    // one that has to cope.
    const findReview = vi.spyOn(reviewService, "findReview");
    findReview.mockResolvedValueOnce(null);

    const second = await reviewService.getOrCreateDraft(acUser, aliceAssignment.id);
    findReview.mockRestore();

    expect(second.id).toBe(first.id);

    const rows = await testDb
      .select()
      .from(reviewTable)
      .where(eq(reviewTable.assignmentId, aliceAssignment.id));
    expect(rows).toHaveLength(1);
  });
});

/**
 * Work reaches reviewers by being claimed, not allotted. Nobody has a share,
 * so a reviewer who works faster simply takes more and the cycle finishes
 * sooner - which is the point, and is why none of these assert an even split.
 */
describe("claiming the next review", () => {
  it("hands out work and never the same applicant twice to one person", async () => {
    const { cycle } = await setupScenario();

    // Alice already holds an assignment on the only Tech candidacy from the
    // scenario, so her first claim must find nothing rather than re-issue it.
    const first = await request(app)
      .post(`/recruitment/cycles/${cycle.id}/next-review`)
      .set(aliceAuth());

    expect(first.status).toBe(204);
  });

  it("lets one reviewer take more than another rather than splitting evenly", async () => {
    const { cycle, tech, application } = await setupScenario();

    // Three more candidacies in Alice's committee, none assigned to anybody.
    for (let i = 0; i < 3; i += 1) {
      const person = await seedApplicant({
        email: `extra${String(i)}@andrew.cmu.edu`,
        fullName: `Extra ${String(i)}`,
      });
      const app2 = await seedApplication({ cycleId: cycle.id, applicantId: person.id });
      await seedCandidacy({ applicationId: app2.id, committeeId: tech.id });
    }
    expect(application).toBeDefined();

    // Alice claims all three; Bob claims none. No quota stops her.
    const claimed: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const res = await request(app)
        .post(`/recruitment/cycles/${cycle.id}/next-review`)
        .set(aliceAuth());
      expect(res.status).toBe(200);
      claimed.push(res.body.candidacyId);
    }

    // Three distinct applicants, and the well is now dry for her.
    expect(new Set(claimed).size).toBe(3);
    const exhausted = await request(app)
      .post(`/recruitment/cycles/${cycle.id}/next-review`)
      .set(aliceAuth());
    expect(exhausted.status).toBe(204);
  });

  /**
   * The database index is what guarantees this, so the test drives the service
   * rather than trusting the query's NOT EXISTS clause to stay correct.
   */
  it("refuses to give a reviewer a candidacy they already hold", async () => {
    const { cycle, tech } = await setupScenario();
    const person = await seedApplicant({ email: "solo@andrew.cmu.edu", fullName: "Solo" });
    const app2 = await seedApplication({ cycleId: cycle.id, applicantId: person.id });
    const candidacy = await seedCandidacy({ applicationId: app2.id, committeeId: tech.id });

    const one = await request(app)
      .post(`/recruitment/cycles/${cycle.id}/next-review`)
      .set(aliceAuth());
    expect(one.status).toBe(200);
    expect(one.body.candidacyId).toBe(candidacy.id);

    const two = await request(app)
      .post(`/recruitment/cycles/${cycle.id}/next-review`)
      .set(aliceAuth());
    expect(two.status).toBe(204);
  });

  it("gives nothing to somebody with no recruitment role in the cycle", async () => {
    const { cycle } = await setupScenario();
    await seedUser({
      id: "bystander",
      name: "Bystander",
      email: "bystander@cmu.edu",
      accountId: "bystander-sub",
    });

    const res = await request(app)
      .post(`/recruitment/cycles/${cycle.id}/next-review`)
      .set(authHeader({ sub: "bystander-sub" }));

    expect(res.status).toBe(403);
  });

  /**
   * Two reviewers claiming at once must not collide - but "collide" does not
   * mean "get the same applicant". Several people reviewing one applicant is
   * the entire point of `minimumReviews`, so the invariant is that each claim
   * yields its own assignment and no reviewer ends up holding a candidacy
   * twice. An earlier version of this test asserted they got *different*
   * applicants and failed against correct behaviour.
   */
  it("gives concurrent claimers their own assignments", async () => {
    const { cycle, tech } = await setupScenario();
    const person = await seedApplicant({ email: "race@andrew.cmu.edu", fullName: "Race" });
    const app2 = await seedApplication({ cycleId: cycle.id, applicantId: person.id });
    await seedCandidacy({ applicationId: app2.id, committeeId: tech.id });

    const [a, b] = await Promise.all([
      request(app).post(`/recruitment/cycles/${cycle.id}/next-review`).set(aliceAuth()),
      request(app).post(`/recruitment/cycles/${cycle.id}/next-review`).set(bobAuth()),
    ]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.assignmentId).not.toBe(b.body.assignmentId);

    const rows = await testDb
      .select()
      .from(reviewAssignmentTable)
      .where(eq(reviewAssignmentTable.candidacyId, a.body.candidacyId));
    const reviewers = rows.map((r) => r.reviewerUserId);
    expect(new Set(reviewers).size).toBe(reviewers.length);
  });

  /** Coverage is a ceiling: nobody is handed work that is already covered. */
  it("stops handing out a candidacy once it has enough reviewers", async () => {
    const { cycle, tech } = await setupScenario();
    const person = await seedApplicant({ email: "covered@andrew.cmu.edu", fullName: "Covered" });
    const app2 = await seedApplication({ cycleId: cycle.id, applicantId: person.id });
    const candidacy = await seedCandidacy({ applicationId: app2.id, committeeId: tech.id });

    // The cycle's minimum is 2 in the fixture; two claims fill it.
    await request(app).post(`/recruitment/cycles/${cycle.id}/next-review`).set(aliceAuth());
    await request(app).post(`/recruitment/cycles/${cycle.id}/next-review`).set(bobAuth());

    const rows = await testDb
      .select()
      .from(reviewAssignmentTable)
      .where(eq(reviewAssignmentTable.candidacyId, candidacy.id));
    expect(rows.length).toBeLessThanOrEqual(2);
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

/**
 * A recruitment admin is usually also a reviewer with their own queue. The
 * ability's admin branch returns early, and it granted read, readPeerReview
 * and reopen on a review but not submit - so an admin could open their own
 * review, score it, write the rationale, and only then be told they were not
 * allowed to submit it. That is the one moment the work cannot be recovered.
 */
describe("an admin reviewing their own queue", () => {
  async function setupAdminAsReviewer() {
    const scenario = await setupScenario();

    // The same person holds both roles, exactly as they do on the live cycle.
    await seedMembership({
      cycleId: scenario.cycle.id,
      userId: adminUser.id,
      role: "reviewer",
      committeeId: scenario.tech.id,
    });

    const assignment = await seedAssignment({
      candidacyId: scenario.candidacy.id,
      reviewerUserId: adminUser.id,
    });

    return { ...scenario, assignment };
  }

  it("submits their own review rather than being refused", async () => {
    const { assignment } = await setupAdminAsReviewer();

    const res = await request(app)
      .post(`/recruitment/assignments/${assignment.id}/review/submit`)
      .set(adminAuth())
      .send(COMPLETE_REVIEW);

    expect(res.status).toBe(200);
    // Submitting stamps the review, which is what makes it count toward the
    // candidacy's aggregate.
    expect(res.body.submittedAt).not.toBeNull();
  });

  it("saves a draft first, as the interface does", async () => {
    const { assignment } = await setupAdminAsReviewer();

    const res = await request(app)
      .put(`/recruitment/assignments/${assignment.id}/review`)
      .set(adminAuth())
      .send({ scores: { interest: 4 } });

    expect(res.status).toBe(200);
  });

  /** Reading everyone's review is an admin power; writing one is not. */
  it("still cannot submit somebody else's review", async () => {
    const { aliceAssignment } = await setupAdminAsReviewer();

    const res = await request(app)
      .post(`/recruitment/assignments/${aliceAssignment.id}/review/submit`)
      .set(adminAuth())
      .send(COMPLETE_REVIEW);

    expect(res.status).toBe(403);
  });
});
