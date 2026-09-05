import { reviewAssignment } from "@labrador/db/schema";
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
} from "./recruitmentFixtures.ts";

/**
 * Bulk assignment. The invariants matter more than the arithmetic: this writes
 * a queue for every reviewer in a committee at once, and getting it wrong
 * either destroys work or quietly undoes a declared conflict.
 */
async function setup(opts: { applicants: number; reviewers: number }) {
  await seedAdmin();
  await seedAlice();
  await seedBob();

  const cycle = await seedCycle();
  const committees = await seedCommittees();
  const tech = committees["tech"];
  const design = committees["design"];
  if (!tech || !design) throw new Error("missing committees");
  await linkCommitteeToCycle(cycle.id, tech.id, 10);
  await linkCommitteeToCycle(cycle.id, design.id, 10);

  await seedMembership({ cycleId: cycle.id, userId: adminUser.id, role: "recruitment_admin" });

  const reviewers = [alice.id, bob.id].slice(0, opts.reviewers);
  for (const userId of reviewers) {
    await seedMembership({ cycleId: cycle.id, userId, role: "reviewer", committeeId: tech.id });
  }

  const candidacies = [];
  for (let i = 0; i < opts.applicants; i += 1) {
    const person = await seedApplicant({
      email: `person${i}@andrew.cmu.edu`,
      fullName: `Person ${i}`,
    });
    const application = await seedApplication({ cycleId: cycle.id, applicantId: person.id });
    candidacies.push(await seedCandidacy({ applicationId: application.id, committeeId: tech.id }));
  }

  return { cycle, tech, design, candidacies, reviewers };
}

function distribute(cycleId: string, committeeId: string, body: Record<string, unknown>) {
  return request(app)
    .post(`/recruitment/cycles/${cycleId}/committees/${committeeId}/assignments/distribute`)
    .set(adminAuth())
    .send(body);
}

describe("bulk assignment", () => {
  it("writes nothing on a dry run", async () => {
    const { cycle, tech } = await setup({ applicants: 3, reviewers: 2 });

    const res = await distribute(cycle.id, tech.id, {
      reviewersPerCandidacy: 2,
      dryRun: true,
    });

    expect(res.status).toBe(200);
    expect(res.body.planned).toHaveLength(6);
    expect(res.body.created).toBeUndefined();

    const rows = await testDb.select().from(reviewAssignment);
    expect(rows).toHaveLength(0);
  });

  it("creates the assignments the dry run promised", async () => {
    const { cycle, tech } = await setup({ applicants: 3, reviewers: 2 });

    const preview = await distribute(cycle.id, tech.id, {
      reviewersPerCandidacy: 2,
      dryRun: true,
    });
    const applied = await distribute(cycle.id, tech.id, {
      reviewersPerCandidacy: 2,
      dryRun: false,
    });

    expect(applied.body.created).toBe(preview.body.planned.length);
    const rows = await testDb.select().from(reviewAssignment);
    expect(rows).toHaveLength(6);
  });

  it("spreads the load evenly", async () => {
    const { cycle, tech } = await setup({ applicants: 4, reviewers: 2 });

    await distribute(cycle.id, tech.id, { reviewersPerCandidacy: 1, dryRun: false });

    const rows = await testDb.select().from(reviewAssignment);
    const perReviewer = new Map<string, number>();
    for (const row of rows) {
      perReviewer.set(row.reviewerUserId, (perReviewer.get(row.reviewerUserId) ?? 0) + 1);
    }
    // Four applicants, one reviewer each, two reviewers: two apiece.
    expect([...perReviewer.values()].sort((a, b) => a - b)).toEqual([2, 2]);
  });

  it("is idempotent: a second run adds nothing", async () => {
    const { cycle, tech } = await setup({ applicants: 3, reviewers: 2 });

    await distribute(cycle.id, tech.id, { reviewersPerCandidacy: 2, dryRun: false });
    const second = await distribute(cycle.id, tech.id, {
      reviewersPerCandidacy: 2,
      dryRun: false,
    });

    expect(second.body.planned).toHaveLength(0);
    const rows = await testDb.select().from(reviewAssignment);
    expect(rows).toHaveLength(6);
  });

  it("tops up an existing assignment rather than duplicating it", async () => {
    const { cycle, tech, candidacies } = await setup({ applicants: 1, reviewers: 2 });
    const candidacy = candidacies[0];
    if (!candidacy) throw new Error("missing candidacy");
    await seedAssignment({ candidacyId: candidacy.id, reviewerUserId: alice.id });

    await distribute(cycle.id, tech.id, { reviewersPerCandidacy: 2, dryRun: false });

    const rows = await testDb
      .select()
      .from(reviewAssignment)
      .where(eq(reviewAssignment.candidacyId, candidacy.id));
    expect(rows).toHaveLength(2);
    // Alice's original row is untouched, and she is not on it twice.
    expect(rows.filter((row) => row.reviewerUserId === alice.id)).toHaveLength(1);
  });

  it("never reassigns someone who declared a conflict", async () => {
    const { cycle, tech, candidacies } = await setup({ applicants: 1, reviewers: 2 });
    const candidacy = candidacies[0];
    if (!candidacy) throw new Error("missing candidacy");

    const assignment = await seedAssignment({
      candidacyId: candidacy.id,
      reviewerUserId: alice.id,
    });
    await testDb
      .update(reviewAssignment)
      .set({ status: "conflicted" })
      .where(eq(reviewAssignment.id, assignment.id));

    await distribute(cycle.id, tech.id, { reviewersPerCandidacy: 1, dryRun: false });

    const rows = await testDb
      .select()
      .from(reviewAssignment)
      .where(eq(reviewAssignment.candidacyId, candidacy.id));

    // A conflict does not count as coverage, so Bob is added - but Alice is
    // never given a second row, which would undo her declaration.
    expect(rows.filter((row) => row.reviewerUserId === alice.id)).toHaveLength(1);
    expect(rows.some((row) => row.reviewerUserId === bob.id)).toBe(true);
  });

  it("reports a shortfall instead of assigning the same person twice", async () => {
    const { cycle, tech } = await setup({ applicants: 1, reviewers: 1 });

    const res = await distribute(cycle.id, tech.id, {
      reviewersPerCandidacy: 3,
      dryRun: true,
    });

    // One eligible reviewer cannot cover three slots.
    expect(res.body.planned).toHaveLength(1);
    expect(res.body.shortfalls).toHaveLength(1);
    expect(res.body.shortfalls[0]).toMatchObject({ have: 1, want: 3 });
  });

  it("only assigns reviewers whose membership covers the committee", async () => {
    const { cycle, design } = await setup({ applicants: 2, reviewers: 2 });

    // Alice and Bob are Tech reviewers; nobody is enrolled for Design.
    const res = await distribute(cycle.id, design.id, {
      reviewersPerCandidacy: 2,
      dryRun: true,
    });

    expect(res.body.planned).toHaveLength(0);
  });

  it("does not volunteer a cycle-wide admin, but assigns one when named", async () => {
    const { cycle, tech } = await setup({ applicants: 2, reviewers: 2 });

    // The admin holds a cycle-wide membership, which makes them assignable.
    // Running the cycle is not the same as being on the reading rota, so a
    // default split must not hand them a queue of every applicant.
    const auto = await distribute(cycle.id, tech.id, {
      reviewersPerCandidacy: 1,
      dryRun: true,
    });
    expect(
      auto.body.planned.some(
        (row: { reviewerUserId: string }) => row.reviewerUserId === adminUser.id,
      ),
    ).toBe(false);

    // Naming them is an explicit choice, and still works.
    const named = await distribute(cycle.id, tech.id, {
      reviewersPerCandidacy: 1,
      reviewerUserIds: [adminUser.id],
      dryRun: true,
    });
    expect(named.body.planned).toHaveLength(2);
    expect(
      named.body.planned.every(
        (row: { reviewerUserId: string }) => row.reviewerUserId === adminUser.id,
      ),
    ).toBe(true);
  });

  it("can be narrowed to named reviewers", async () => {
    const { cycle, tech } = await setup({ applicants: 2, reviewers: 2 });

    await distribute(cycle.id, tech.id, {
      reviewersPerCandidacy: 1,
      reviewerUserIds: [bob.id],
      dryRun: false,
    });

    const rows = await testDb.select().from(reviewAssignment);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.reviewerUserId === bob.id)).toBe(true);
  });

  it("refuses a reviewer, and an out-of-range target", async () => {
    const { cycle, tech } = await setup({ applicants: 1, reviewers: 2 });

    const forbidden = await request(app)
      .post(`/recruitment/cycles/${cycle.id}/committees/${tech.id}/assignments/distribute`)
      .set(aliceAuth())
      .send({ reviewersPerCandidacy: 2, dryRun: true });
    expect(forbidden.status).toBe(403);

    expect((await distribute(cycle.id, tech.id, { reviewersPerCandidacy: 0 })).status).toBe(422);
    expect((await distribute(cycle.id, tech.id, { reviewersPerCandidacy: 99 })).status).toBe(422);
  });
});
