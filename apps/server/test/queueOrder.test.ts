import request from "supertest";
import { describe, expect, it } from "vitest";

import { app } from "../src/app.ts";
import { alice, aliceAuth, seedAlice } from "./fixtures.ts";
import {
  linkCommitteeToCycle,
  seedApplicant,
  seedApplication,
  seedAssignment,
  seedCandidacy,
  seedCommitteeAnswer,
  seedCommittees,
  seedCycle,
  seedMembership,
  seedPreference,
} from "./recruitmentFixtures.ts";

/**
 * Reviewing is finite, so the order of the queue decides who gets read
 * carefully and who gets skimmed at midnight. The rule: applicants who both
 * ranked this committee highly and wrote something for it come first.
 */
async function setupQueue() {
  await seedAlice();

  const cycle = await seedCycle();
  const committees = await seedCommittees();
  const tech = committees["tech"];
  if (!tech) throw new Error("missing tech");
  const techId = tech.id;
  await linkCommitteeToCycle(cycle.id, techId, 10);
  await seedMembership({
    cycleId: cycle.id,
    userId: alice.id,
    role: "reviewer",
    committeeId: techId,
  });

  /** Creates one applicant with a given rank and optional committee answer. */
  async function candidate(name: string, rank: number | null, answered: boolean) {
    const person = await seedApplicant({ email: `${name}@andrew.cmu.edu`, fullName: name });
    const application = await seedApplication({ cycleId: cycle.id, applicantId: person.id });
    if (rank !== null) {
      await seedPreference({ applicationId: application.id, committeeId: techId, rank });
    }
    if (answered) {
      await seedCommitteeAnswer({
        cycleId: cycle.id,
        applicationId: application.id,
        committeeId: techId,
        key: `tech_${name}`,
      });
    }
    const candidacy = await seedCandidacy({
      applicationId: application.id,
      committeeId: techId,
    });
    await seedAssignment({ candidacyId: candidacy.id, reviewerUserId: alice.id });
    return name;
  }

  return { cycle, tech, committees, candidate };
}

describe("review queue order", () => {
  it("puts answered top choices first, in the applicant's own rank order", async () => {
    const { cycle, candidate } = await setupQueue();

    // Seeded deliberately out of order.
    await candidate("cthird", 3, true);
    await candidate("afirst", 1, true);
    await candidate("bsecond", 2, true);

    const res = await request(app).get(`/recruitment/cycles/${cycle.id}/my-queue`).set(aliceAuth());

    expect(res.status).toBe(200);
    expect(res.body.map((row: { applicantName: string }) => row.applicantName)).toEqual([
      "afirst",
      "bsecond",
      "cthird",
    ]);
    expect(res.body.map((row: { priorityTier: number }) => row.priorityTier)).toEqual([1, 2, 3]);
  });

  /**
   * The signal that matters is "is there something here to read". A first
   * choice who left every question blank is further down than a third choice
   * who wrote something.
   */
  it("puts an answered third choice above an unanswered first choice", async () => {
    const { cycle, candidate } = await setupQueue();

    await candidate("silent", 1, false);
    await candidate("wrote", 3, true);

    const res = await request(app).get(`/recruitment/cycles/${cycle.id}/my-queue`).set(aliceAuth());

    expect(res.body.map((row: { applicantName: string }) => row.applicantName)).toEqual([
      "wrote",
      "silent",
    ]);
    expect(res.body[0].priorityTier).toBe(3);
    expect(res.body[1].priorityTier).toBe(4);
  });

  it("orders the unanswered remainder by the rank they gave", async () => {
    const { cycle, candidate } = await setupQueue();

    await candidate("third", 3, false);
    await candidate("first", 1, false);

    const res = await request(app).get(`/recruitment/cycles/${cycle.id}/my-queue`).set(aliceAuth());

    expect(res.body.map((row: { applicantName: string }) => row.applicantName)).toEqual([
      "first",
      "third",
    ]);
  });

  it("reports whether there is a committee response to read", async () => {
    const { cycle, candidate } = await setupQueue();

    await candidate("wrote", 1, true);
    await candidate("silent", 2, false);

    const res = await request(app).get(`/recruitment/cycles/${cycle.id}/my-queue`).set(aliceAuth());

    const byName = new Map(
      res.body.map((row: { applicantName: string; hasCommitteeResponse: boolean }) => [
        row.applicantName,
        row.hasCommitteeResponse,
      ]),
    );
    expect(byName.get("wrote")).toBe(true);
    expect(byName.get("silent")).toBe(false);
  });

  /**
   * Blank answers are dropped at import rather than stored as "", so an
   * applicant who ticked the opt-in and then wrote nothing must not be treated
   * as having written something.
   */
  it("does not count an answer row whose text is null", async () => {
    const { cycle, tech, candidate } = await setupQueue();
    await candidate("blank", 1, false);

    const applications = await request(app)
      .get(`/recruitment/cycles/${cycle.id}/applications`)
      .set(aliceAuth());
    const applicationId = applications.body[0].applicationId;

    await seedCommitteeAnswer({
      cycleId: cycle.id,
      applicationId,
      committeeId: tech.id,
      key: "tech_blank",
      answerText: null,
    });

    const res = await request(app).get(`/recruitment/cycles/${cycle.id}/my-queue`).set(aliceAuth());

    expect(res.body[0].hasCommitteeResponse).toBe(false);
    expect(res.body[0].priorityTier).toBe(4);
  });

  /**
   * An answer scoped to a different committee is not an answer for this one:
   * the whole point of `question_definition.committee_id`.
   */
  it("does not count another committee's answer", async () => {
    const { cycle, committees, candidate } = await setupQueue();
    const design = committees["design"];
    if (!design) throw new Error("missing design");

    await candidate("elsewhere", 1, false);

    const applications = await request(app)
      .get(`/recruitment/cycles/${cycle.id}/applications`)
      .set(aliceAuth());

    await seedCommitteeAnswer({
      cycleId: cycle.id,
      applicationId: applications.body[0].applicationId,
      committeeId: design.id,
      key: "design_elsewhere",
    });

    const res = await request(app).get(`/recruitment/cycles/${cycle.id}/my-queue`).set(aliceAuth());

    expect(res.body[0].hasCommitteeResponse).toBe(false);
  });
});
