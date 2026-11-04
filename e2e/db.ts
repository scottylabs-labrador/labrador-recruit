import {
  account,
  recruitmentCycle,
  recruitmentOpening,
  session,
  team,
  user,
} from "@recruit/db/schema";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";

import { ADMIN_GROUP, DATABASE_URL } from "./config.ts";

export const db = drizzle(DATABASE_URL);

export const alice = {
  id: "alice",
  name: "Alice",
  email: "alice@andrew.cmu.edu",
  accountId: "alice-sub",
  sessionToken: "alice-session",
};

export const adminUser = {
  id: "admin",
  name: "Admin",
  email: "admin@andrew.cmu.edu",
  accountId: "admin-sub",
  sessionToken: "admin-session",
};

/**
 * Empties every table between tests.
 *
 * Discovered from the catalogue rather than listed by hand. A hand-maintained
 * list is the thing somebody forgets when they add a table, and the symptom is
 * order-dependent failures in a suite nobody changed.
 */
export async function resetDb() {
  const result = await db.execute<{ tablename: string }>(sql`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '__drizzle_migrations'
  `);
  const names = result.rows.map((row) => `"${row.tablename}"`).join(", ");
  if (names.length > 0) {
    await db.execute(sql.raw(`TRUNCATE TABLE ${names} CASCADE`));
  }
}

/**
 * A signed-in identity-provider account.
 *
 * The access token is a structurally valid but unsigned JWT: nothing in the
 * end-to-end stack verifies it, because `AUTH_JWKS_URI` points at a host that
 * does not resolve. What the suite needs from it is the `groups` claim, which
 * is what decides the caller's global role.
 */
function accessToken(sub: string, groups: string[] = []) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ sub, groups, iss: "https://auth.example.com", aud: "e2e-client" }),
  ).toString("base64url");
  return `${header}.${payload}.sig`;
}

export async function seedUser(opts: {
  id: string;
  name: string;
  email: string;
  accountId: string;
  sessionToken: string;
  groups?: string[];
}) {
  const now = new Date();
  await db.insert(user).values({
    id: opts.id,
    name: opts.name,
    email: opts.email,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(account).values({
    id: `${opts.id}-account`,
    accountId: opts.accountId,
    providerId: "keycloak",
    userId: opts.id,
    accessToken: accessToken(opts.accountId, opts.groups),
    accessTokenExpiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(session).values({
    id: `${opts.id}-session`,
    token: opts.sessionToken,
    userId: opts.id,
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    createdAt: now,
    updatedAt: now,
  });
}

export async function seedAlice() {
  await seedUser(alice);
}

export async function seedAdmin() {
  await seedUser({ ...adminUser, groups: [ADMIN_GROUP] });
}

/**
 * An open cycle with one committee recruiting.
 *
 * The suite truncates every table between tests, so without this the public
 * pages render their between-seasons state — which is worth asserting once,
 * but is not the flow an applicant walks.
 */
export async function seedOpenCycle() {
  const now = new Date();
  const past = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const future = new Date(now.getTime() + 21 * 24 * 60 * 60 * 1000);

  await db.insert(user).values({
    id: "director",
    name: "Director",
    email: "director@andrew.cmu.edu",
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });

  const [cycle] = await db
    .insert(recruitmentCycle)
    .values({
      slug: "e2e-cycle",
      name: "End To End Recruitment",
      description: "Apply to ScottyLabs committees.",
      status: "open",
      timeZone: "America/New_York",
      opensAt: past,
      closesAt: future,
      maxCommitteesPerApplicant: 2,
      createdBy: "director",
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: recruitmentCycle.id });

  const [committee] = await db
    .insert(team)
    .values({
      slug: "labrador",
      name: "Labrador",
      description: "Product teams building for the CMU community.",
      displayOrder: 1,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: team.id });

  await db.insert(recruitmentOpening).values({
    cycleId: cycle!.id,
    teamId: committee!.id,
    status: "open",
    opensAt: past,
    closesAt: future,
    createdAt: now,
    updatedAt: now,
  });

  return { cycleId: cycle!.id, teamId: committee!.id };
}
