/**
 * Resolving the caller's grants, assignments and unblinded set.
 *
 * The ability builder is pure and tested in `packages/access-control`. This
 * tests the part that talks to the database, and the three things it has to get
 * right are the three that cannot be expressed as a rule:
 *
 * 1. **Liveness.** A revoked or expired grant conveys nothing, evaluated per
 *    request against the server clock. There is no cache, so revocation takes
 *    effect on the next request — a stated requirement, not an optimisation we
 *    skipped.
 * 2. **Assignment.** A reviewer's standing is not content.
 * 3. **Unblinding.** Only the caller's own *submitted* review unblinds, and
 *    only for the application it is about.
 */
import {
  application,
  candidateProfile,
  permissionGrant,
  recruitmentCycle,
  recruitmentOpening,
  review,
  reviewAssignment,
  rubric,
  team,
  user,
} from "@recruit/db/schema";
import { beforeEach, describe, expect, it } from "vitest";

import { resolveScopedUser } from "../src/lib/scopedUser.ts";
import { testDb } from "./harness.ts";

const now = new Date();
const past = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

let cycleId: string;
let labradorId: string;
let labradorOpening: string;
let applicationId: string;

beforeEach(async () => {
  await testDb.insert(user).values([
    {
      id: "dchen",
      name: "Dana Chen",
      email: "dchen@andrew.cmu.edu",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "lhaddad",
      name: "Layla Haddad",
      email: "lhaddad@andrew.cmu.edu",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "osorensen",
      name: "Ola Sorensen",
      email: "osorensen@andrew.cmu.edu",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "aquinn",
      name: "Avery Quinn",
      email: "aquinn@andrew.cmu.edu",
      createdAt: now,
      updatedAt: now,
    },
  ]);

  const [cycle] = await testDb
    .insert(recruitmentCycle)
    .values({
      slug: "spring-2027",
      name: "Spring 2027",
      status: "open",
      opensAt: past,
      closesAt: future,
      createdBy: "dchen",
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: recruitmentCycle.id });
  cycleId = cycle!.id;

  const teams = await testDb
    .insert(team)
    .values([
      { slug: "labrador", name: "Labrador", createdAt: now, updatedAt: now },
      { slug: "design", name: "Design", createdAt: now, updatedAt: now },
    ])
    .returning({ id: team.id, slug: team.slug });
  labradorId = teams.find((row) => row.slug === "labrador")!.id;

  const [opening] = await testDb
    .insert(recruitmentOpening)
    .values({
      cycleId,
      teamId: labradorId,
      status: "open",
      opensAt: past,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: recruitmentOpening.id });
  labradorOpening = opening!.id;

  const [profile] = await testDb
    .insert(candidateProfile)
    .values({ userId: "aquinn", cycleId, createdAt: now, updatedAt: now })
    .returning({ id: candidateProfile.id });
  const [app] = await testDb
    .insert(application)
    .values({
      candidateProfileId: profile!.id,
      openingId: labradorOpening,
      teamId: labradorId,
      status: "under_review",
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: application.id });
  applicationId = app!.id;
});

/** Inserts a grant and returns nothing; the shape is the interesting part. */
async function grantTo(userId: string, over: Partial<typeof permissionGrant.$inferInsert> = {}) {
  await testDb.insert(permissionGrant).values({
    userId,
    role: "reviewer",
    scope: "team",
    teamId: labradorId,
    cycleId,
    grantedBy: "dchen",
    createdAt: now,
    ...over,
  });
}

describe("liveness", () => {
  it("includes a live grant", async () => {
    await grantTo("lhaddad");

    const scoped = await resolveScopedUser({ id: "lhaddad", role: "user" }, cycleId);

    expect(scoped.grants).toHaveLength(1);
    expect(scoped.grants[0]).toMatchObject({ role: "reviewer", teamId: labradorId });
  });

  it("excludes a revoked grant", async () => {
    await grantTo("lhaddad", { revokedAt: yesterday });

    const scoped = await resolveScopedUser({ id: "lhaddad", role: "user" }, cycleId);

    // Revocation takes effect on the next request, because nothing is cached
    // and no role list is embedded in a session.
    expect(scoped.grants).toHaveLength(0);
  });

  it("excludes an expired grant", async () => {
    await grantTo("lhaddad", { expiresAt: yesterday });

    const scoped = await resolveScopedUser({ id: "lhaddad", role: "user" }, cycleId);

    expect(scoped.grants).toHaveLength(0);
  });

  it("includes a grant whose expiry is still in the future", async () => {
    await grantTo("lhaddad", { expiresAt: future });

    const scoped = await resolveScopedUser({ id: "lhaddad", role: "user" }, cycleId);

    expect(scoped.grants).toHaveLength(1);
  });

  it("includes a grant with no expiry at all", async () => {
    await grantTo("lhaddad", { expiresAt: null });

    const scoped = await resolveScopedUser({ id: "lhaddad", role: "user" }, cycleId);

    expect(scoped.grants).toHaveLength(1);
  });

  it("never returns somebody else's grants", async () => {
    await grantTo("osorensen");

    const scoped = await resolveScopedUser({ id: "lhaddad", role: "user" }, cycleId);

    expect(scoped.grants).toHaveLength(0);
  });
});

describe("cycle scoping", () => {
  it("excludes a grant naming a different cycle", async () => {
    const [other] = await testDb
      .insert(recruitmentCycle)
      .values({
        slug: "fall-2026",
        name: "Fall 2026",
        status: "archived",
        createdBy: "dchen",
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: recruitmentCycle.id });
    await grantTo("lhaddad", { cycleId: other!.id });

    const scoped = await resolveScopedUser({ id: "lhaddad", role: "user" }, cycleId);

    // Last season's reviewer is not this season's reviewer.
    expect(scoped.grants).toHaveLength(0);
  });

  it("includes a cycle-independent grant", async () => {
    await grantTo("lhaddad", { cycleId: null });

    const scoped = await resolveScopedUser({ id: "lhaddad", role: "user" }, cycleId);

    // `permission_grant.cycle_id` is nullable for exactly this: a standing
    // grant that is not tied to one season.
    expect(scoped.grants).toHaveLength(1);
  });

  it("returns only organization-scoped and cycle-independent grants outside any cycle", async () => {
    await grantTo("dchen", {
      role: "org_admin",
      scope: "organization",
      teamId: null,
      cycleId: null,
    });
    await grantTo("dchen", { role: "reviewer", cycleId });

    const scoped = await resolveScopedUser({ id: "dchen", role: "user" }, null);

    // Asking "what can this person do" with no cycle in hand is what the
    // bootstrap and org-admin surfaces do. A grant tied to a cycle is not
    // applicable there.
    expect(scoped.grants).toHaveLength(1);
    expect(scoped.grants[0]!.role).toBe("org_admin");
  });
});

describe("assignments", () => {
  it("is empty for a reviewer with no assignment", async () => {
    await grantTo("lhaddad");

    const scoped = await resolveScopedUser({ id: "lhaddad", role: "user" }, cycleId);

    // Standing without content. The grant is live and the set is empty, which
    // is exactly the case `docs/authorization.md` section 2 warns about.
    expect(scoped.assignedApplicationIds).toEqual([]);
  });

  it("includes an assigned application", async () => {
    await grantTo("lhaddad");
    await testDb.insert(reviewAssignment).values({
      applicationId,
      reviewerId: "lhaddad",
      assignedBy: "dchen",
      status: "assigned",
      assignedAt: now,
    });

    const scoped = await resolveScopedUser({ id: "lhaddad", role: "user" }, cycleId);

    expect(scoped.assignedApplicationIds).toEqual([applicationId]);
  });

  it("excludes a cancelled assignment", async () => {
    await grantTo("lhaddad");
    await testDb.insert(reviewAssignment).values({
      applicationId,
      reviewerId: "lhaddad",
      assignedBy: "dchen",
      status: "cancelled",
      assignedAt: now,
    });

    const scoped = await resolveScopedUser({ id: "lhaddad", role: "user" }, cycleId);

    // A director who takes an assignment back has taken the access with it.
    expect(scoped.assignedApplicationIds).toEqual([]);
  });

  it("never includes another reviewer's assignment", async () => {
    await grantTo("lhaddad");
    await testDb.insert(reviewAssignment).values({
      applicationId,
      reviewerId: "osorensen",
      assignedBy: "dchen",
      status: "assigned",
      assignedAt: now,
    });

    const scoped = await resolveScopedUser({ id: "lhaddad", role: "user" }, cycleId);

    expect(scoped.assignedApplicationIds).toEqual([]);
  });
});

describe("unblinding", () => {
  async function assignAndReview(reviewerId: string, status: "draft" | "submitted") {
    const [assignment] = await testDb
      .insert(reviewAssignment)
      .values({
        applicationId,
        reviewerId,
        assignedBy: "dchen",
        status: "assigned",
        assignedAt: now,
      })
      .returning({ id: reviewAssignment.id });

    const [rubricRow] = await testDb
      .insert(rubric)
      .values({
        openingId: labradorOpening,
        version: 1,
        status: "active",
        createdBy: "dchen",
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: rubric.id });

    await testDb.insert(review).values({
      assignmentId: assignment!.id,
      rubricId: rubricRow!.id,
      status,
      // `review_submitted_at_ck` requires the timestamp and the status to
      // agree, in both directions.
      submittedAt: status === "submitted" ? now : null,
      createdAt: now,
      updatedAt: now,
    });
  }

  it("is empty when the caller's own review is still a draft", async () => {
    await grantTo("lhaddad");
    await assignAndReview("lhaddad", "draft");

    const scoped = await resolveScopedUser({ id: "lhaddad", role: "user" }, cycleId);

    /*
     * **Only a submitted review unblinds.**
     *
     * A draft does not, and this is the line that makes independent review
     * mean anything: otherwise opening the form and typing one character would
     * reveal every peer's scores, which is precisely the influence the rule
     * exists to prevent.
     */
    expect(scoped.unblindedApplicationIds).toEqual([]);
  });

  it("includes the application once the caller submits their own review", async () => {
    await grantTo("lhaddad");
    await assignAndReview("lhaddad", "submitted");

    const scoped = await resolveScopedUser({ id: "lhaddad", role: "user" }, cycleId);

    expect(scoped.unblindedApplicationIds).toEqual([applicationId]);
  });

  it("is not unblinded by somebody else's submitted review", async () => {
    await grantTo("lhaddad");
    await assignAndReview("osorensen", "submitted");

    const scoped = await resolveScopedUser({ id: "lhaddad", role: "user" }, cycleId);

    // A peer finishing first must not open the application for everybody
    // else. The set is per caller, built from their own reviews only.
    expect(scoped.unblindedApplicationIds).toEqual([]);
  });
});

describe("the resolved identity", () => {
  it("carries the caller and the cycle through unchanged", async () => {
    const scoped = await resolveScopedUser({ id: "lhaddad", role: "admin" }, cycleId);

    expect(scoped).toMatchObject({ id: "lhaddad", role: "admin", cycleId });
  });

  it("returns an empty context for a guest without querying anything", async () => {
    await grantTo("lhaddad");

    const scoped = await resolveScopedUser({ id: "", role: "guest" }, cycleId);

    // An unknown token subject resolves to a guest with an empty id. Looking
    // up grants for `""` would be meaningless at best; at worst a future row
    // with an empty user id would hand it authority.
    expect(scoped.grants).toEqual([]);
    expect(scoped.assignedApplicationIds).toEqual([]);
    expect(scoped.unblindedApplicationIds).toEqual([]);
  });
});
