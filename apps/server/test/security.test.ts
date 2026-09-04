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
} from "./recruitmentFixtures.ts";

/**
 * Access-control boundaries found by probing a live stack as every role in
 * turn. Each case here was a real failure: two of them leaked applicant names
 * and emails to an ordinary reviewer, the rest turned refusals into 500s or
 * answered an invisible row with an empty 200.
 *
 * Alice reviews for Tech and has not submitted. Bob leads Design. The admin
 * holds the global admin group and, unless a test says otherwise, no
 * recruitment membership at all - which is exactly the person who must see
 * nothing.
 */
async function setup() {
  await seedAlice();
  await seedBob();
  await seedAdmin();

  const cycle = await seedCycle();
  const committees = await seedCommittees();
  const tech = committees["tech"];
  const design = committees["design"];
  if (!tech || !design) throw new Error("missing committees");
  await linkCommitteeToCycle(cycle.id, tech.id, 5);
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
    role: "committee_lead",
    committeeId: design.id,
  });

  const person = await seedApplicant({ email: "probe@andrew.cmu.edu", fullName: "Pat Probe" });
  const application = await seedApplication({ cycleId: cycle.id, applicantId: person.id });
  const techCandidacy = await seedCandidacy({
    applicationId: application.id,
    committeeId: tech.id,
  });
  const designCandidacy = await seedCandidacy({
    applicationId: application.id,
    committeeId: design.id,
  });
  await seedAssignment({ candidacyId: techCandidacy.id, reviewerUserId: alice.id });

  return { cycle, tech, design, application, techCandidacy, designCandidacy };
}

describe("exports and the audit log stay with leadership", () => {
  it("refuses a reviewer the committee ranking export", async () => {
    const { cycle, tech } = await setup();

    const res = await request(app)
      .get(`/recruitment/cycles/${cycle.id}/exports/committees/${tech.id}/ranking`)
      .set(aliceAuth());

    // The file carries every applicant's name and email. A reviewer got it.
    expect(res.status).toBe(403);
  });

  it("refuses a reviewer the audit log", async () => {
    const { cycle } = await setup();

    const res = await request(app).get(`/recruitment/cycles/${cycle.id}/audit`).set(aliceAuth());

    expect(res.status).toBe(403);
  });

  it("lets a committee lead read the audit log", async () => {
    const { cycle } = await setup();

    const res = await request(app).get(`/recruitment/cycles/${cycle.id}/audit`).set(bobAuth());

    expect(res.status).toBe(200);
  });
});

describe("an invisible row is a 404, never an empty 200", () => {
  it("answers 404 for the reviews of a candidacy in another committee", async () => {
    const { techCandidacy } = await setup();

    // Bob leads Design; the Tech candidacy is not his to see. An empty list
    // would confirm the id is real.
    const res = await request(app)
      .get(`/recruitment/candidacies/${techCandidacy.id}/reviews`)
      .set(bobAuth());

    expect(res.status).toBe(404);
  });

  it("answers 404 for the assignments of a candidacy in another committee", async () => {
    const { techCandidacy } = await setup();

    const res = await request(app)
      .get(`/recruitment/candidacies/${techCandidacy.id}/assignments`)
      .set(bobAuth());

    expect(res.status).toBe(404);
  });

  it("answers 404 for a ranking of a committee the caller holds no role in", async () => {
    const { cycle, design } = await setup();

    const res = await request(app)
      .get(`/recruitment/cycles/${cycle.id}/committees/${design.id}/ranking`)
      .set(aliceAuth());

    expect(res.status).toBe(404);
  });
});

describe("aggregates respect blind review", () => {
  it("shows a reviewer nothing for candidacies they have not submitted on", async () => {
    const { cycle, tech } = await setup();

    // Alice is assigned to the Tech candidacy but has not submitted, so its
    // aggregate is peer scores she may not yet see.
    const res = await request(app)
      .get(`/recruitment/cycles/${cycle.id}/committees/${tech.id}/ranking`)
      .set(aliceAuth());

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("shows a committee lead every candidacy in their committee", async () => {
    const { cycle, design, designCandidacy } = await setup();

    const res = await request(app)
      .get(`/recruitment/cycles/${cycle.id}/committees/${design.id}/ranking`)
      .set(bobAuth());

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].candidacyId).toBe(designCandidacy.id);
  });
});

describe("refusals and bad input are never 500s", () => {
  it("gives a caller with no recruitment standing a 403", async () => {
    const { application } = await setup();

    // Global admin group, no membership. Previously CASL's ForbiddenError fell
    // through to the 500 branch.
    const res = await request(app)
      .get(`/recruitment/applications/${application.id}`)
      .set(adminAuth());

    expect(res.status).toBe(403);
  });

  it("treats a malformed id as not found, and never echoes the query", async () => {
    const { cycle } = await setup();
    await seedMembership({ cycleId: cycle.id, userId: adminUser.id, role: "recruitment_admin" });

    const res = await request(app).get(`/recruitment/applications/not-a-uuid`).set(adminAuth());

    expect(res.status).toBe(404);
    // The old 500 body included the failing SQL and its parameters.
    expect(JSON.stringify(res.body)).not.toMatch(/Failed query|select /i);
  });

  it("refuses an upload whose content is not base64", async () => {
    const { cycle } = await setup();
    await seedMembership({ cycleId: cycle.id, userId: adminUser.id, role: "recruitment_admin" });

    const res = await request(app)
      .post(`/recruitment/cycles/${cycle.id}/imports`)
      .set(adminAuth())
      .send({ filename: "x.csv", contentBase64: "!!!notbase64!!!" });

    // Node decodes garbage leniently, so this used to become a stored import
    // whose only header was a few stray bytes.
    expect(res.status).toBe(422);
  });
});
