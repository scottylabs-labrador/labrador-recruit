/**
 * Constraints on the invitation tables.
 *
 * An invitation is the only way anybody is granted authority, so the properties
 * that make it safe are enforced here: a token is single-use and unique, and a
 * requested role cannot be duplicated on one invitation.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { invitation, invitationRole, team, user } from "../src/schema/index.ts";
import { db, expectRejection, resetDb } from "./harness.ts";

beforeEach(resetDb);

const now = new Date();
const later = new Date(now.getTime() + 60 * 60 * 1000);

async function insertInviter() {
  await db.insert(user).values({
    id: "semathew",
    name: "Sam",
    email: "semathew@andrew.cmu.edu",
    createdAt: now,
    updatedAt: now,
  });
  const [row] = await db
    .insert(team)
    .values({ slug: "labrador", name: "Labrador", createdAt: now, updatedAt: now })
    .returning({ id: team.id });
  return row!.id;
}

async function insertInvitation(tokenHash: string, teamId: string | null) {
  const [row] = await db
    .insert(invitation)
    .values({
      email: "newperson@andrew.cmu.edu",
      invitedBy: "semathew",
      teamId,
      tokenHash,
      expiresAt: later,
      createdAt: now,
    })
    .returning({ id: invitation.id });
  return row!.id;
}

describe("invitation", () => {
  it("rejects a duplicate token hash", async () => {
    const teamId = await insertInviter();
    await insertInvitation("hash-a", teamId);

    await expectRejection(() => insertInvitation("hash-a", teamId), "23505");
  });

  it("stores only a hash, never a token", async () => {
    const teamId = await insertInviter();
    await insertInvitation("hash-a", teamId);

    const [row] = await db.select().from(invitation);

    // A database dump must not yield working invitations, so there is no column
    // the raw token could be in.
    expect(Object.keys(row!)).not.toContain("token");
    expect(row!.tokenHash).toBe("hash-a");
  });

  it("rejects an inviter who does not exist", async () => {
    await expectRejection(
      () =>
        db.insert(invitation).values({
          email: "newperson@andrew.cmu.edu",
          invitedBy: "nobody",
          teamId: null,
          tokenHash: "hash-b",
          expiresAt: later,
          createdAt: now,
        }),
      "23503",
    );
  });
});

describe("invitation_role", () => {
  it("rejects the same role twice on one invitation", async () => {
    const teamId = await insertInviter();
    const invitationId = await insertInvitation("hash-a", teamId);
    await db.insert(invitationRole).values({ invitationId, role: "reviewer" });

    await expectRejection(
      () => db.insert(invitationRole).values({ invitationId, role: "reviewer" }),
      "23505",
    );
  });

  it("allows two different roles on one invitation", async () => {
    const teamId = await insertInviter();
    const invitationId = await insertInvitation("hash-a", teamId);

    // A helper may be invited as question editor and reviewer at once.
    await db.insert(invitationRole).values({ invitationId, role: "reviewer" });
    await db.insert(invitationRole).values({ invitationId, role: "question_editor" });

    const rows = await db.select().from(invitationRole);
    expect(rows).toHaveLength(2);
  });

  it("rejects a role pointing at an invitation that does not exist", async () => {
    await expectRejection(
      () =>
        db.insert(invitationRole).values({
          invitationId: "00000000-0000-0000-0000-000000000000",
          role: "reviewer",
        }),
      "23503",
    );
  });
});
