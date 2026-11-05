/**
 * Constraints on the cycle and opening tables.
 *
 * A cycle is the unit of historical isolation: a past season stays inspectable
 * and cannot be mutated by anything happening in the current one. An opening is
 * one committee's participation in one cycle, and it is the join almost every
 * scoped query reaches a team through.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { recruitmentCycle, recruitmentOpening, team, user } from "../src/schema/index.ts";
import { db, expectRejection, resetDb } from "./harness.ts";

beforeEach(async () => {
  await resetDb();
  // Every cycle names who created it, so a creator has to exist first.
  await db.insert(user).values({
    id: "semathew",
    name: "Sam",
    email: "semathew@andrew.cmu.edu",
    createdAt: now,
    updatedAt: now,
  });
});

const now = new Date();
const opens = new Date("2027-01-15T12:00:00Z");
const closes = new Date("2027-02-01T12:00:00Z");

async function insertCycle(slug: string, overrides: Record<string, unknown> = {}) {
  const [row] = await db
    .insert(recruitmentCycle)
    .values({
      slug,
      name: slug,
      timeZone: "America/New_York",
      opensAt: opens,
      closesAt: closes,
      createdBy: "semathew",
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .returning({ id: recruitmentCycle.id });
  return row!.id;
}

async function insertTeam(slug: string) {
  const [row] = await db
    .insert(team)
    .values({ slug, name: slug, createdAt: now, updatedAt: now })
    .returning({ id: team.id });
  return row!.id;
}

describe("recruitment_cycle", () => {
  it("rejects a duplicate slug", async () => {
    await insertCycle("spring-2027");

    await expectRejection(() => insertCycle("spring-2027"), "23505");
  });

  it("rejects a close date at or before the open date", async () => {
    await expectRejection(() => insertCycle("spring-2027", { closesAt: opens }), "23514");
  });

  it("defaults to draft", async () => {
    const id = await insertCycle("spring-2027");

    const [row] = await db.select().from(recruitmentCycle);

    expect(row!.id).toBe(id);
    expect(row!.status).toBe("draft");
  });

  it("keeps the configured time zone, because deadlines are evaluated in it", async () => {
    await insertCycle("spring-2027");

    const [row] = await db.select().from(recruitmentCycle);

    expect(row!.timeZone).toBe("America/New_York");
  });
});

describe("recruitment_opening", () => {
  it("rejects the same team twice in one cycle", async () => {
    const cycleId = await insertCycle("spring-2027");
    const teamId = await insertTeam("labrador");
    await db.insert(recruitmentOpening).values({ cycleId, teamId, createdAt: now, updatedAt: now });

    await expectRejection(
      () =>
        db.insert(recruitmentOpening).values({ cycleId, teamId, createdAt: now, updatedAt: now }),
      "23505",
    );
  });

  it("allows one team to recruit in two different cycles", async () => {
    const teamId = await insertTeam("labrador");
    const first = await insertCycle("fall-2026");
    const second = await insertCycle("spring-2027");

    await db
      .insert(recruitmentOpening)
      .values({ cycleId: first, teamId, createdAt: now, updatedAt: now });
    await db
      .insert(recruitmentOpening)
      .values({ cycleId: second, teamId, createdAt: now, updatedAt: now });

    const rows = await db.select().from(recruitmentOpening);
    expect(rows).toHaveLength(2);
  });

  it("starts as a draft, independent of the cycle status", async () => {
    const cycleId = await insertCycle("spring-2027", { status: "open" });
    const teamId = await insertTeam("labrador");

    await db.insert(recruitmentOpening).values({ cycleId, teamId, createdAt: now, updatedAt: now });

    // The cycle being open must not imply the committee accepts applications.
    // Its form may not be published yet, and these two states are deliberately
    // independent.
    const [row] = await db.select().from(recruitmentOpening);
    expect(row!.status).toBe("draft");
  });

  it("rejects a negative application limit", async () => {
    const cycleId = await insertCycle("spring-2027");
    const teamId = await insertTeam("labrador");

    await expectRejection(
      () =>
        db.insert(recruitmentOpening).values({
          cycleId,
          teamId,
          applicationLimit: -1,
          createdAt: now,
          updatedAt: now,
        }),
      "23514",
    );
  });

  it("disappears with its cycle", async () => {
    const cycleId = await insertCycle("spring-2027");
    const teamId = await insertTeam("labrador");
    await db.insert(recruitmentOpening).values({ cycleId, teamId, createdAt: now, updatedAt: now });

    await db.delete(recruitmentCycle);

    const rows = await db.select().from(recruitmentOpening);
    expect(rows).toHaveLength(0);
  });
});
