import {
  committeeCandidacy,
  recruitmentCycle,
  review,
  reviewAssignment,
  rubric as rubricTable,
} from "@labrador/db/schema";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { alice, bob, seedAlice, seedBob } from "./fixtures.ts";
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
  seedReview,
  seedRubric,
} from "./recruitmentFixtures.ts";

describe("recruitment schema", () => {
  it("migrates and accepts a full cycle, committee, applicant, and candidacy chain", async () => {
    const cycle = await seedCycle();
    const committees = await seedCommittees();
    const tech = committees["tech"];
    expect(tech).toBeDefined();
    if (!tech) return;

    await linkCommitteeToCycle(cycle.id, tech.id, 12);

    const person = await seedApplicant({ email: "zoe@andrew.cmu.edu", fullName: "Zoe Zhao" });
    const app = await seedApplication({ cycleId: cycle.id, applicantId: person.id });
    await seedPreference({ applicationId: app.id, committeeId: tech.id, rank: 1 });
    const candidacy = await seedCandidacy({ applicationId: app.id, committeeId: tech.id });

    expect(candidacy.status).toBe("pending_assignment");
    expect(candidacy.active).toBe(true);
  });

  it("normalises the applicant email and rejects a duplicate", async () => {
    await seedApplicant({ email: "Dup@Andrew.CMU.edu", fullName: "Dup One" });

    await expect(
      seedApplicant({ email: "dup@andrew.cmu.edu", fullName: "Dup Two" }),
    ).rejects.toThrow();
  });

  it("allows one application per applicant per cycle and rejects a second", async () => {
    const cycle = await seedCycle();
    const person = await seedApplicant({ email: "once@andrew.cmu.edu", fullName: "Once" });

    await seedApplication({ cycleId: cycle.id, applicantId: person.id });

    await expect(seedApplication({ cycleId: cycle.id, applicantId: person.id })).rejects.toThrow();
  });

  it("allows the same applicant to apply again in a different cycle", async () => {
    const fall = await seedCycle({ slug: "fall-2026", name: "Fall 2026" });
    const spring = await seedCycle({ slug: "spring-2027", name: "Spring 2027" });
    const person = await seedApplicant({ email: "repeat@andrew.cmu.edu", fullName: "Repeat" });

    await seedApplication({ cycleId: fall.id, applicantId: person.id });
    const second = await seedApplication({ cycleId: spring.id, applicantId: person.id });

    expect(second.cycleId).toBe(spring.id);
  });

  it("rejects a duplicate candidacy for the same application and committee", async () => {
    const cycle = await seedCycle();
    const committees = await seedCommittees();
    const tech = committees["tech"];
    if (!tech) throw new Error("missing tech committee");

    const person = await seedApplicant({ email: "dupcand@andrew.cmu.edu", fullName: "Dup Cand" });
    const app = await seedApplication({ cycleId: cycle.id, applicantId: person.id });
    await seedCandidacy({ applicationId: app.id, committeeId: tech.id });

    await expect(seedCandidacy({ applicationId: app.id, committeeId: tech.id })).rejects.toThrow();
  });

  it("never assigns the same reviewer to a candidacy twice", async () => {
    await seedAlice();
    const cycle = await seedCycle();
    const committees = await seedCommittees();
    const tech = committees["tech"];
    if (!tech) throw new Error("missing tech committee");

    const person = await seedApplicant({ email: "assign@andrew.cmu.edu", fullName: "Assign" });
    const app = await seedApplication({ cycleId: cycle.id, applicantId: person.id });
    const candidacy = await seedCandidacy({ applicationId: app.id, committeeId: tech.id });

    await seedAssignment({ candidacyId: candidacy.id, reviewerUserId: alice.id });

    await expect(
      seedAssignment({ candidacyId: candidacy.id, reviewerUserId: alice.id }),
    ).rejects.toThrow();
  });

  it("allows different reviewers on the same candidacy", async () => {
    await seedAlice();
    await seedBob();
    const cycle = await seedCycle();
    const committees = await seedCommittees();
    const tech = committees["tech"];
    if (!tech) throw new Error("missing tech committee");

    const person = await seedApplicant({ email: "two@andrew.cmu.edu", fullName: "Two" });
    const app = await seedApplication({ cycleId: cycle.id, applicantId: person.id });
    const candidacy = await seedCandidacy({ applicationId: app.id, committeeId: tech.id });

    await seedAssignment({ candidacyId: candidacy.id, reviewerUserId: alice.id });
    await seedAssignment({ candidacyId: candidacy.id, reviewerUserId: bob.id });

    const rows = await testDb
      .select()
      .from(reviewAssignment)
      .where(eq(reviewAssignment.candidacyId, candidacy.id));

    expect(rows).toHaveLength(2);
  });

  it("permits at most one review per assignment", async () => {
    await seedAlice();
    const cycle = await seedCycle();
    const committees = await seedCommittees();
    const tech = committees["tech"];
    if (!tech) throw new Error("missing tech committee");

    const person = await seedApplicant({ email: "onereview@andrew.cmu.edu", fullName: "One" });
    const app = await seedApplication({ cycleId: cycle.id, applicantId: person.id });
    const candidacy = await seedCandidacy({ applicationId: app.id, committeeId: tech.id });
    const assignment = await seedAssignment({
      candidacyId: candidacy.id,
      reviewerUserId: alice.id,
    });
    const { rubric } = await seedRubric({ cycleId: cycle.id });

    await seedReview({ assignmentId: assignment.id, rubricId: rubric.id });

    await expect(
      seedReview({ assignmentId: assignment.id, rubricId: rubric.id }),
    ).rejects.toThrow();
  });

  it("pins the rubric version to a review and refuses to delete a rubric still in use", async () => {
    await seedAlice();
    const cycle = await seedCycle();
    const committees = await seedCommittees();
    const tech = committees["tech"];
    if (!tech) throw new Error("missing tech committee");

    const person = await seedApplicant({ email: "pinned@andrew.cmu.edu", fullName: "Pinned" });
    const app = await seedApplication({ cycleId: cycle.id, applicantId: person.id });
    const candidacy = await seedCandidacy({ applicationId: app.id, committeeId: tech.id });
    const assignment = await seedAssignment({
      candidacyId: candidacy.id,
      reviewerUserId: alice.id,
    });
    const { rubric: seeded } = await seedRubric({ cycleId: cycle.id });
    const reviewRow = await seedReview({ assignmentId: assignment.id, rubricId: seeded.id });

    expect(reviewRow.rubricId).toBe(seeded.id);

    // `onDelete: "restrict"` protects the audit trail: a submitted review must
    // always be able to name the rubric it was scored under.
    await expect(testDb.delete(rubricTable).where(eq(rubricTable.id, seeded.id))).rejects.toThrow();
  });

  it("cascades a cycle delete without orphaning candidacies", async () => {
    const cycle = await seedCycle();
    const committees = await seedCommittees();
    const tech = committees["tech"];
    if (!tech) throw new Error("missing tech committee");

    const person = await seedApplicant({ email: "cascade@andrew.cmu.edu", fullName: "Cascade" });
    const app = await seedApplication({ cycleId: cycle.id, applicantId: person.id });
    await seedCandidacy({ applicationId: app.id, committeeId: tech.id });

    await testDb.delete(recruitmentCycle).where(eq(recruitmentCycle.id, cycle.id));

    const orphanedCandidacies = await testDb.select().from(committeeCandidacy);
    const orphanedReviews = await testDb.select().from(review);

    expect(orphanedCandidacies).toHaveLength(0);
    expect(orphanedReviews).toHaveLength(0);
  });

  it("deduplicates a cycle-wide membership even though its committee is null", async () => {
    await seedAlice();
    const cycle = await seedCycle();

    await seedMembership({ cycleId: cycle.id, userId: alice.id, role: "recruitment_admin" });

    await expect(
      seedMembership({ cycleId: cycle.id, userId: alice.id, role: "recruitment_admin" }),
    ).rejects.toThrow();
  });

  it("allows the same user to lead two different committees in one cycle", async () => {
    await seedAlice();
    const cycle = await seedCycle();
    const committees = await seedCommittees();
    const tech = committees["tech"];
    const design = committees["design"];
    if (!tech || !design) throw new Error("missing committees");

    await seedMembership({
      cycleId: cycle.id,
      userId: alice.id,
      role: "committee_lead",
      committeeId: tech.id,
    });
    const second = await seedMembership({
      cycleId: cycle.id,
      userId: alice.id,
      role: "committee_lead",
      committeeId: design.id,
    });

    expect(second).toBeDefined();
  });

  it("stores the preference score map on the cycle so policy is configuration", async () => {
    const cycle = await seedCycle();
    const [row] = await testDb
      .select()
      .from(recruitmentCycle)
      .where(eq(recruitmentCycle.id, cycle.id));

    expect(row?.preferenceScoreMap).toMatchObject({ "1": 5, "7": 1 });
    expect(row?.minimumReviews).toBe(3);
    expect(row?.disagreementSpreadThreshold).toBe(20);
  });
});
