import { finalPlacement } from "@labrador/db/schema";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { app } from "../src/app.ts";
import {
  adminAuth,
  adminUser,
  alice,
  aliceAuth,
  bob,
  seedAdmin,
  seedAlice,
  seedBob,
} from "./fixtures.ts";
import { testDb } from "./harness.ts";
import {
  linkCommitteeToCycle,
  seedApplicant,
  seedApplication,
  seedCandidacy,
  seedCommittees,
  seedCycle,
  seedMembership,
  seedPreference,
} from "./recruitmentFixtures.ts";

/**
 * One applicant wanted by two committees, which is the case final placement
 * exists to resolve.
 */
async function setupTwoCommitteeScenario() {
  await seedAlice();
  await seedBob();
  await seedAdmin();

  const cycle = await seedCycle();
  const committees = await seedCommittees();
  const tech = committees["tech"];
  const design = committees["design"];
  if (!tech || !design) throw new Error("missing committees");

  await linkCommitteeToCycle(cycle.id, tech.id, 1);
  await linkCommitteeToCycle(cycle.id, design.id, 5);

  await seedMembership({
    cycleId: cycle.id,
    userId: adminUser.id,
    role: "recruitment_admin",
  });
  await seedMembership({
    cycleId: cycle.id,
    userId: alice.id,
    role: "reviewer",
    committeeId: tech.id,
  });

  const person = await seedApplicant({
    email: "wanted@andrew.cmu.edu",
    fullName: "Wanda Wanted",
  });
  const application = await seedApplication({ cycleId: cycle.id, applicantId: person.id });

  // Design is their first choice, Tech their second.
  await seedPreference({ applicationId: application.id, committeeId: design.id, rank: 1 });
  await seedPreference({ applicationId: application.id, committeeId: tech.id, rank: 2 });

  const techCandidacy = await seedCandidacy({
    applicationId: application.id,
    committeeId: tech.id,
  });
  const designCandidacy = await seedCandidacy({
    applicationId: application.id,
    committeeId: design.id,
  });

  return { cycle, tech, design, application, techCandidacy, designCandidacy };
}

describe("committee decisions", () => {
  it("records a proposal without creating a placement", async () => {
    const { cycle, techCandidacy } = await setupTwoCommitteeScenario();

    const res = await request(app)
      .put(`/recruitment/candidacies/${techCandidacy.id}/decision`)
      .set(adminAuth())
      .send({ status: "accept", notes: "Strong across the board." });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("accept");

    // A committee proposal must never become a final placement by itself.
    const placements = await testDb.select().from(finalPlacement);
    expect(placements).toHaveLength(0);

    const progress = await request(app)
      .get(`/recruitment/cycles/${cycle.id}/progress`)
      .set(adminAuth());
    expect(progress.body.placementCount).toBe(0);
    expect(progress.body.applicationCount).toBe(1);
  });

  it("requires a committee when redirecting", async () => {
    const { techCandidacy } = await setupTwoCommitteeScenario();

    const res = await request(app)
      .put(`/recruitment/candidacies/${techCandidacy.id}/decision`)
      .set(adminAuth())
      .send({ status: "redirect" });

    expect(res.status).toBe(422);
  });

  it("does not let an ordinary reviewer decide", async () => {
    const { techCandidacy } = await setupTwoCommitteeScenario();

    const res = await request(app)
      .put(`/recruitment/candidacies/${techCandidacy.id}/decision`)
      .set(aliceAuth())
      .send({ status: "accept" });

    expect(res.status).toBe(403);
  });

  it("warns when accepted candidates exceed the committee capacity", async () => {
    const { cycle, tech, techCandidacy } = await setupTwoCommitteeScenario();

    // Capacity for Tech is 1; accept a second applicant to exceed it.
    const other = await seedApplicant({ email: "second@andrew.cmu.edu", fullName: "Sam Second" });
    const otherApplication = await seedApplication({
      cycleId: cycle.id,
      applicantId: other.id,
    });
    const otherCandidacy = await seedCandidacy({
      applicationId: otherApplication.id,
      committeeId: tech.id,
    });

    for (const candidacyId of [techCandidacy.id, otherCandidacy.id]) {
      await request(app)
        .put(`/recruitment/candidacies/${candidacyId}/decision`)
        .set(adminAuth())
        .send({ status: "accept" });
    }

    const res = await request(app)
      .get(`/recruitment/cycles/${cycle.id}/committees/${tech.id}/decisions`)
      .set(adminAuth());

    expect(res.body.capacity).toBe(1);
    expect(res.body.acceptedCount).toBe(2);
    expect(res.body.overCapacity).toBe(true);
  });
});

describe("final placement", () => {
  it("surfaces an applicant wanted by two committees, ordered by their own preference", async () => {
    const { cycle, techCandidacy, designCandidacy } = await setupTwoCommitteeScenario();

    for (const candidacyId of [techCandidacy.id, designCandidacy.id]) {
      await request(app)
        .put(`/recruitment/candidacies/${candidacyId}/decision`)
        .set(adminAuth())
        .send({ status: "accept" });
    }

    const res = await request(app)
      .get(`/recruitment/cycles/${cycle.id}/placements`)
      .set(adminAuth());

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].interestedCommittees).toHaveLength(2);
    // Design is their first choice, so it leads the conversation.
    expect(res.body[0].interestedCommittees[0].applicantRank).toBe(1);
    expect(res.body[0].interestedCommittees[0].committeeName).toBe("Design");
    expect(res.body[0].currentPlacement).toBeNull();
  });

  it("requires a committee when the status is placed", async () => {
    const { application } = await setupTwoCommitteeScenario();

    const res = await request(app)
      .put(`/recruitment/applications/${application.id}/placement`)
      .set(adminAuth())
      .send({ status: "placed" });

    expect(res.status).toBe(422);
  });

  it("records a human placement and keeps exactly one per application", async () => {
    const { application, design, tech } = await setupTwoCommitteeScenario();

    const first = await request(app)
      .put(`/recruitment/applications/${application.id}/placement`)
      .set(adminAuth())
      .send({ status: "placed", committeeId: design.id, notes: "Their first choice." });
    expect(first.status).toBe(200);

    // Leadership changes their mind: the placement is replaced, not duplicated.
    const second = await request(app)
      .put(`/recruitment/applications/${application.id}/placement`)
      .set(adminAuth())
      .send({ status: "placed", committeeId: tech.id, notes: "Design filled up." });
    expect(second.status).toBe(200);

    const placements = await testDb.select().from(finalPlacement);
    expect(placements).toHaveLength(1);
    expect(placements[0]?.committeeId).toBe(tech.id);
  });

  it("does not let a reviewer view or make placements", async () => {
    const { cycle, application } = await setupTwoCommitteeScenario();

    const list = await request(app)
      .get(`/recruitment/cycles/${cycle.id}/placements`)
      .set(aliceAuth());
    expect(list.status).toBe(403);

    const write = await request(app)
      .put(`/recruitment/applications/${application.id}/placement`)
      .set(aliceAuth())
      .send({ status: "rejected" });
    expect(write.status).toBe(403);
  });
});

describe("memberships", () => {
  it("grants a reviewer role to an existing user", async () => {
    const { cycle, design } = await setupTwoCommitteeScenario();

    const res = await request(app)
      .post(`/recruitment/cycles/${cycle.id}/memberships`)
      .set(adminAuth())
      .send({ userId: bob.id, role: "reviewer", committeeId: design.id });

    expect(res.status).toBe(201);

    const list = await request(app)
      .get(`/recruitment/cycles/${cycle.id}/memberships`)
      .set(adminAuth());
    expect(list.body.some((row: { userId: string }) => row.userId === bob.id)).toBe(true);
  });

  /**
   * Two admins setting a cycle up, or a double-submitted form, used to surface
   * the unique index as a 500 from the database driver - which reads as "the
   * app is broken" rather than "they already have that role".
   */
  it("is idempotent when the user already holds the role", async () => {
    const { cycle, tech } = await setupTwoCommitteeScenario();

    const first = await request(app)
      .post(`/recruitment/cycles/${cycle.id}/memberships`)
      .set(adminAuth())
      .send({ userId: bob.id, role: "reviewer", committeeId: tech.id });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post(`/recruitment/cycles/${cycle.id}/memberships`)
      .set(adminAuth())
      .send({ userId: bob.id, role: "reviewer", committeeId: tech.id });
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);

    const listed = await request(app)
      .get(`/recruitment/cycles/${cycle.id}/memberships`)
      .set(adminAuth());
    const bobRows = listed.body.filter(
      (row: { userId: string; role: string }) => row.userId === bob.id && row.role === "reviewer",
    );
    expect(bobRows).toHaveLength(1);
  });

  /** Revoking deactivates rather than deletes, so re-granting must revive it. */
  it("reactivates a revoked membership instead of duplicating it", async () => {
    const { cycle, tech } = await setupTwoCommitteeScenario();

    const granted = await request(app)
      .post(`/recruitment/cycles/${cycle.id}/memberships`)
      .set(adminAuth())
      .send({ userId: bob.id, role: "reviewer", committeeId: tech.id });

    await request(app).delete(`/recruitment/memberships/${granted.body.id}`).set(adminAuth());

    const regranted = await request(app)
      .post(`/recruitment/cycles/${cycle.id}/memberships`)
      .set(adminAuth())
      .send({ userId: bob.id, role: "reviewer", committeeId: tech.id });

    expect(regranted.status).toBe(201);
    expect(regranted.body.id).toBe(granted.body.id);
    expect(regranted.body.active).toBe(true);
  });

  it("refuses a user who has never signed in", async () => {
    const { cycle, design } = await setupTwoCommitteeScenario();

    const res = await request(app)
      .post(`/recruitment/cycles/${cycle.id}/memberships`)
      .set(adminAuth())
      .send({ userId: "never-signed-in", role: "reviewer", committeeId: design.id });

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/sign in/i);
  });

  it("refuses a committee lead with no committee", async () => {
    const { cycle } = await setupTwoCommitteeScenario();

    const res = await request(app)
      .post(`/recruitment/cycles/${cycle.id}/memberships`)
      .set(adminAuth())
      .send({ userId: bob.id, role: "committee_lead" });

    expect(res.status).toBe(422);
  });

  it("does not let a reviewer grant themselves more access", async () => {
    const { cycle } = await setupTwoCommitteeScenario();

    const res = await request(app)
      .post(`/recruitment/cycles/${cycle.id}/memberships`)
      .set(aliceAuth())
      .send({ userId: alice.id, role: "recruitment_admin" });

    expect(res.status).toBe(403);
  });

  it("lists only reviewers eligible for the committee being assigned", async () => {
    const { cycle, tech, design } = await setupTwoCommitteeScenario();

    await request(app)
      .post(`/recruitment/cycles/${cycle.id}/memberships`)
      .set(adminAuth())
      .send({ userId: bob.id, role: "reviewer", committeeId: design.id });

    const res = await request(app)
      .get(`/recruitment/cycles/${cycle.id}/committees/${tech.id}/eligible-reviewers`)
      .set(adminAuth());

    const ids = res.body.map((row: { userId: string }) => row.userId);
    // Alice reviews Tech; the admin is cycle-wide; Bob only covers Design.
    expect(ids).toContain(alice.id);
    expect(ids).toContain(adminUser.id);
    expect(ids).not.toContain(bob.id);
  });
});
