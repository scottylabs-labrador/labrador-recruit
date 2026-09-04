import request from "supertest";
import { describe, expect, it } from "vitest";

import { app } from "../src/app.ts";
import { adminAuth, adminUser, seedAdmin } from "./fixtures.ts";
import {
  linkCommitteeToCycle,
  seedApplicant,
  seedApplication,
  seedCandidacy,
  seedCommittees,
  seedCycle,
  seedMembership,
} from "./recruitmentFixtures.ts";

/**
 * `cycle_committee.minimum_reviews` has been written since the schema was
 * created and read by nothing: aggregation took the cycle-wide value. A
 * committee that asked for three reviews silently got the cycle's two, and the
 * "complete" badge and the shortfall shown beside the decision buttons were
 * both computed from the wrong number.
 */
async function setup(committeeMinimum: number | null) {
  await seedAdmin();

  const cycle = await seedCycle({ minimumReviews: 2 });
  const committees = await seedCommittees();
  const tech = committees["tech"];
  if (!tech) throw new Error("missing tech");

  await linkCommitteeToCycle(cycle.id, tech.id, 10, committeeMinimum);

  // Being a global admin configures a cycle but does not open its applicant
  // data - that needs a membership, which is audited. `abac.ts` is explicit
  // about the distinction.
  await seedMembership({
    cycleId: cycle.id,
    userId: adminUser.id,
    role: "recruitment_admin",
    committeeId: null,
  });

  const person = await seedApplicant({ email: "one@andrew.cmu.edu", fullName: "One" });
  const application = await seedApplication({ cycleId: cycle.id, applicantId: person.id });
  await seedCandidacy({ applicationId: application.id, committeeId: tech.id });

  return { cycle, tech };
}

describe("a committee's own review minimum", () => {
  it("overrides the cycle's when the committee sets one", async () => {
    const { cycle, tech } = await setup(3);

    const res = await request(app)
      .get(`/recruitment/cycles/${cycle.id}/committees/${tech.id}/aggregates`)
      .set(adminAuth());

    expect(res.status).toBe(200);
    expect(res.body[0].minimumReviews).toBe(3);
  });

  it("falls back to the cycle's when the committee sets none", async () => {
    const { cycle, tech } = await setup(null);

    const res = await request(app)
      .get(`/recruitment/cycles/${cycle.id}/committees/${tech.id}/aggregates`)
      .set(adminAuth());

    expect(res.body[0].minimumReviews).toBe(2);
  });

  /**
   * Zero is a committee deciding it needs no reviews, which is a real answer
   * and must not be mistaken for "unset" by a truthiness check.
   */
  it("treats zero as a real setting rather than as unset", async () => {
    const { cycle, tech } = await setup(0);

    const res = await request(app)
      .get(`/recruitment/cycles/${cycle.id}/committees/${tech.id}/aggregates`)
      .set(adminAuth());

    expect(res.body[0].minimumReviews).toBe(0);
  });

  /** The ranking reads the same aggregate, so the shortfall must agree. */
  it("carries through to the shortfall shown beside the decision buttons", async () => {
    const { cycle, tech } = await setup(3);

    const res = await request(app)
      .get(`/recruitment/cycles/${cycle.id}/committees/${tech.id}/ranking`)
      .set(adminAuth());

    expect(res.status).toBe(200);
    expect(res.body[0].minimumReviews).toBe(3);
    expect(res.body[0].reviewsShortBy).toBe(3);
  });
});
