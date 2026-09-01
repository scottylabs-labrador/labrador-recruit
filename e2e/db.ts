import { account, session, user } from "@labrador/db/schema";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";

import { ADMIN_GROUP, DATABASE_URL } from "./config.ts";

export const db = drizzle(DATABASE_URL);

export const alice = {
  id: "alice",
  name: "Alice",
  email: "alice@cmu.edu",
  accountId: "alice-sub",
  sessionToken: "alice-session",
};

export const adminUser = {
  id: "admin",
  name: "Admin",
  email: "admin@cmu.edu",
  accountId: "admin-sub",
  sessionToken: "admin-session",
};

export async function resetDb() {
  await db.execute(sql`TRUNCATE TABLE "session", "account", "verification", "user" CASCADE`);
}

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
