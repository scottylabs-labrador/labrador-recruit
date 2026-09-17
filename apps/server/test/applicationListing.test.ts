import request from "supertest";
import { describe, expect, it } from "vitest";

import { app } from "../src/app.ts";
import { alice, aliceAuth, seedAlice } from "./fixtures.ts";
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
 * The applicants screen searches the rows this endpoint returned rather than
 * asking the server, so the page size decides who can be found at all. It was
 * capped at 200 against a cycle of 455: the page asked for 500, got 200, and
 * an applicant in the remaining 255 was unreachable by any search term while
 * the screen honestly reported "200 shown".
 */
describe("listing applications", () => {
  async function setup(count: number) {
    await seedAlice();
    const cycle = await seedCycle();
    const committees = await seedCommittees();
    const tech = committees["tech"];
    if (!tech) throw new Error("missing tech");
    await linkCommitteeToCycle(cycle.id, tech.id, 10);
    await seedMembership({
      cycleId: cycle.id,
      userId: alice.id,
      committeeId: tech.id,
      role: "recruitment_admin",
    });

    for (let i = 0; i < count; i += 1) {
      const person = await seedApplicant({
        email: `p${String(i)}@andrew.cmu.edu`,
        fullName: `Person ${String(i)}`,
      });
      const created = await seedApplication({ cycleId: cycle.id, applicantId: person.id });
      await seedPreference({ applicationId: created.id, committeeId: tech.id, rank: 1 });
      // Leadership sees a committee's pool through its candidacies, so a
      // preference alone leaves the row invisible.
      await seedCandidacy({ applicationId: created.id, committeeId: tech.id });
    }

    return { cycle };
  }

  it("returns more than the old 200-row cap when asked for it", async () => {
    const { cycle } = await setup(205);

    const res = await request(app)
      .get(`/recruitment/cycles/${cycle.id}/applications`)
      .query({ limit: 1000 })
      .set(aliceAuth());

    expect(res.status).toBe(200);
    // All 205, not the 200 the clamp used to allow.
    expect(res.body).toHaveLength(205);
  });

  /** Still bounded: the cap exists so one request cannot drag an unbounded
   *  table across the wire, and an absurd limit is clamped rather than obeyed. */
  it("still clamps an absurd limit", async () => {
    const { cycle } = await setup(3);

    const res = await request(app)
      .get(`/recruitment/cycles/${cycle.id}/applications`)
      .query({ limit: 500000 })
      .set(aliceAuth());

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
  });
});
