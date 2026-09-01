import path from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { account, user } from "@labrador/db/schema";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import jwt from "jsonwebtoken";

import { privateKeyPem } from "./keys.ts";

const migrationsFolder = path.resolve(
  fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)),
);

const pglite = new PGlite();
export const testDb = drizzle({ client: pglite });

await migrate(testDb, { migrationsFolder });

export async function resetDb() {
  await testDb.execute(sql`TRUNCATE TABLE "session", "account", "verification", "user" CASCADE`);
}

export async function seedUser(opts: {
  id: string;
  name: string;
  email: string;
  accountId: string;
}) {
  const now = new Date();
  await testDb.insert(user).values({
    id: opts.id,
    name: opts.name,
    email: opts.email,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  await testDb.insert(account).values({
    id: `${opts.id}-account`,
    accountId: opts.accountId,
    providerId: "keycloak",
    userId: opts.id,
    createdAt: now,
    updatedAt: now,
  });
}

export function bearerToken(opts: { sub: string; groups?: string[] }) {
  return jwt.sign({ sub: opts.sub, groups: opts.groups }, privateKeyPem, {
    algorithm: "RS256",
    issuer: process.env["AUTH_ISSUER"],
    audience: process.env["AUTH_CLIENT_ID"],
    keyid: "test-kid",
    expiresIn: "1h",
  });
}

export function authHeader(opts: { sub: string; groups?: string[] }) {
  return { Authorization: `Bearer ${bearerToken(opts)}` };
}
