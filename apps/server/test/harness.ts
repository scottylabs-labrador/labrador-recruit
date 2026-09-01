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

/**
 * Every table must be listed here, or state leaks between tests. CASCADE makes
 * the order irrelevant, but a missing table is silent, so keep this in sync
 * with `packages/db/src/schema` (and with `e2e/db.ts`) whenever one is added.
 */
export async function resetDb() {
  await testDb.execute(sql`
    TRUNCATE TABLE
      "audit_event",
      "import_row",
      "import_batch",
      "final_placement",
      "committee_decision",
      "review_score",
      "review",
      "review_assignment",
      "rubric_criterion",
      "rubric",
      "committee_candidacy",
      "committee_preference",
      "application_answer",
      "question_definition",
      "application",
      "applicant",
      "recruitment_membership",
      "cycle_committee",
      "committee",
      "recruitment_cycle",
      "session",
      "account",
      "verification",
      "user"
    CASCADE
  `);
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
