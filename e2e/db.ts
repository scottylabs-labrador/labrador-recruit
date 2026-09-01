import { account, reviewAssignment, session, user } from "@labrador/db/schema";
import { seedRecruitmentData } from "@labrador/db/seed";
import { eq, sql } from "drizzle-orm";
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

/** Keep in sync with `apps/server/test/harness.ts` whenever a table is added. */
export async function resetDb() {
  await db.execute(sql`
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
 * The staff the development seed creates. Reusing `seedRecruitmentData` rather
 * than rebuilding a scenario here means the end-to-end tests exercise the exact
 * data a new contributor gets from `bun run db:seed`, so a seed that drifts
 * from the schema fails here too.
 */
export const seededStaff = {
  admin: { id: "radmin", name: "Robin Admin", sessionToken: "radmin-session" },
  techLead: { id: "techlead", name: "Tessa Lead", sessionToken: "techlead-session" },
  reviewer: { id: "rev1", name: "Rae Reviewer", sessionToken: "rev1-session" },
  reviewer2: { id: "rev2", name: "Ravi Reviewer", sessionToken: "rev2-session" },
} as const;

/**
 * Populates a full recruitment cycle and gives the seeded staff the account and
 * session rows Better Auth would have written, so a test can sign in as any of
 * them without touching Keycloak.
 */
export async function seedRecruitmentCycle(): Promise<{ cycleId: string }> {
  const summary = await seedRecruitmentData(db);

  const now = new Date();
  for (const person of Object.values(seededStaff)) {
    await db.insert(account).values({
      id: `${person.id}-account`,
      accountId: `${person.id}-sub`,
      providerId: "keycloak",
      userId: person.id,
      accessToken: accessToken(`${person.id}-sub`),
      accessTokenExpiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(session).values({
      id: `${person.id}-session-row`,
      token: person.sessionToken,
      userId: person.id,
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      createdAt: now,
      updatedAt: now,
    });
  }

  return { cycleId: summary.cycleId };
}

/** The first assignment belonging to a given reviewer, for deep-linking. */
export async function firstAssignmentFor(reviewerUserId: string) {
  const rows = await db
    .select({
      assignmentId: reviewAssignment.id,
      candidacyId: reviewAssignment.candidacyId,
    })
    .from(reviewAssignment)
    .where(eq(reviewAssignment.reviewerUserId, reviewerUserId))
    .limit(1);

  return rows[0] ?? null;
}
