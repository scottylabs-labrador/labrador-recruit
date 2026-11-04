/**
 * Constraints on the organization tables.
 *
 * These are the rules that decide who holds authority, so the database enforces
 * them rather than a service. A service-level check is one caller away from
 * being skipped; a `CHECK` is not.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { permissionGrant, recruitmentCycle, team, user } from "../src/schema/index.ts";
import { db, expectRejection, resetDb } from "./harness.ts";

beforeEach(resetDb);

const now = new Date();

async function insertUser(id: string) {
  await db.insert(user).values({
    id,
    name: id,
    email: `${id}@andrew.cmu.edu`,
    createdAt: now,
    updatedAt: now,
  });
}

async function insertTeam(slug: string, parentTeamId: string | null = null) {
  const [row] = await db
    .insert(team)
    .values({ slug, name: slug, parentTeamId, createdAt: now, updatedAt: now })
    .returning({ id: team.id });
  return row!.id;
}

describe("team", () => {
  it("rejects a duplicate slug", async () => {
    await insertTeam("labrador");

    await expectRejection(() => insertTeam("labrador"), "23505");
  });

  it("accepts a subteam pointing at a parent", async () => {
    const parent = await insertTeam("tech");

    const child = await insertTeam("tech-infra", parent);

    expect(child).not.toBe(parent);
  });

  it("rejects a parent that does not exist", async () => {
    await expectRejection(
      () => insertTeam("orphan", "00000000-0000-0000-0000-000000000000"),
      "23503",
    );
  });
});

describe("permission_grant", () => {
  it("rejects an organization-scope grant that names a team", async () => {
    await insertUser("semathew");
    const teamId = await insertTeam("labrador");

    await expectRejection(
      () =>
        db.insert(permissionGrant).values({
          userId: "semathew",
          role: "org_admin",
          scope: "organization",
          teamId,
          grantedBy: "semathew",
          createdAt: now,
        }),
      "23514",
    );
  });

  it("rejects a team-scope grant that names no team", async () => {
    await insertUser("semathew");

    await expectRejection(
      () =>
        db.insert(permissionGrant).values({
          userId: "semathew",
          role: "reviewer",
          scope: "team",
          teamId: null,
          grantedBy: "semathew",
          createdAt: now,
        }),
      "23514",
    );
  });

  it("rejects a second live grant identical to an existing one", async () => {
    await insertUser("semathew");
    const teamId = await insertTeam("labrador");
    const grant = {
      userId: "semathew",
      role: "reviewer" as const,
      scope: "team" as const,
      teamId,
      grantedBy: "semathew",
      createdAt: now,
    };
    await db.insert(permissionGrant).values(grant);

    await expectRejection(() => db.insert(permissionGrant).values(grant), "23505");
  });

  it("rejects a grant naming a cycle that does not exist", async () => {
    await insertUser("semathew");
    const teamId = await insertTeam("labrador");

    // A grant scoped to a cycle that was deleted would be authority with no
    // window, which is either nothing or everything depending on who reads it.
    await expectRejection(
      () =>
        db.insert(permissionGrant).values({
          userId: "semathew",
          role: "reviewer",
          scope: "team",
          teamId,
          cycleId: "00000000-0000-0000-0000-000000000000",
          grantedBy: "semathew",
          createdAt: now,
        }),
      "23503",
    );
  });

  it("disappears with the cycle it is scoped to", async () => {
    await insertUser("semathew");
    const teamId = await insertTeam("labrador");
    const [cycle] = await db
      .insert(recruitmentCycle)
      .values({
        slug: "spring-2027",
        name: "Spring 2027",
        createdBy: "semathew",
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: recruitmentCycle.id });
    await db.insert(permissionGrant).values({
      userId: "semathew",
      role: "reviewer",
      scope: "team",
      teamId,
      cycleId: cycle!.id,
      grantedBy: "semathew",
      createdAt: now,
    });

    await db.delete(recruitmentCycle);

    const rows = await db.select().from(permissionGrant);
    expect(rows).toHaveLength(0);
  });

  it("allows the same grant again once the first is revoked", async () => {
    await insertUser("semathew");
    const teamId = await insertTeam("labrador");
    const grant = {
      userId: "semathew",
      role: "reviewer" as const,
      scope: "team" as const,
      teamId,
      grantedBy: "semathew",
      createdAt: now,
    };
    await db.insert(permissionGrant).values({ ...grant, revokedAt: now });

    // Re-granting somebody who was revoked must work. The partial unique index
    // covers only live grants for exactly this reason: v1's equivalent index
    // covered cancelled rows too, so re-adding a removed reviewer returned 409.
    await db.insert(permissionGrant).values(grant);

    const rows = await db.select().from(permissionGrant);
    expect(rows).toHaveLength(2);
  });
});
