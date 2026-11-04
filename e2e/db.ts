import {
  account,
  form,
  formVersion,
  question,
  recruitmentCycle,
  recruitmentOpening,
  session,
  team,
  user,
} from "@recruit/db/schema";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";

import { ADMIN_GROUP, BETTER_AUTH_SECRET, DATABASE_URL } from "./config.ts";

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

/**
 * Signs a value the way Better Auth signs its session cookie.
 *
 * HMAC-SHA256 over the raw secret, standard base64 - the same four lines as
 * `makeSignature` in `better-auth/crypto`, through the same WebCrypto API,
 * because that package is not resolvable from this workspace root. Copied
 * rather than reimplemented: if the server ever changes how it signs, this
 * helper fails loudly on the next run rather than silently authenticating
 * nobody.
 */
async function makeSignature(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Buffer.from(signature).toString("base64");
}

/**
 * The signed session cookie for a seeded user.
 *
 * Without it the end-to-end suite could only exercise the public pages, and
 * the applicant surface - most of the product - was covered only in jsdom
 * against a mocked API, which cannot catch a cookie that is not sent or a CORS
 * rule that drops credentials.
 */
export async function sessionCookie(sessionToken: string) {
  const signature = await makeSignature(sessionToken, BETTER_AUTH_SECRET);
  return {
    name: "better-auth.session_token",
    value: `${sessionToken}.${signature}`,
    domain: "localhost",
    path: "/",
    httpOnly: true,
    // http on localhost, so the cookie cannot be `Secure` or the browser will
    // decline to send it at all.
    secure: false,
    sameSite: "Lax" as const,
  };
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

  const [opening] = await db
    .insert(recruitmentOpening)
    .values({
      cycleId: cycle!.id,
      teamId: committee!.id,
      status: "open",
      opensAt: past,
      closesAt: future,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: recruitmentOpening.id });

  /*
   * Both forms, published.
   *
   * `createApplication` refuses an opening with no committee form - opening a
   * committee and publishing its questions are separate acts, and a director
   * can do the first without the second. The suite found that by failing, which
   * is the seed being incomplete rather than the product being wrong.
   */
  const commonFormId = await publishForm({
    cycleId: cycle!.id,
    kind: "common",
    title: "Shared questions",
    questionKey: "major",
    label: "Your major",
    type: "short_text",
  });
  const committeeFormId = await publishForm({
    cycleId: cycle!.id,
    teamId: committee!.id,
    openingId: opening!.id,
    kind: "committee",
    title: "Labrador application",
    questionKey: "why",
    label: "Why Labrador?",
    type: "long_text",
  });

  return {
    cycleId: cycle!.id,
    teamId: committee!.id,
    openingId: opening!.id,
    commonFormId,
    committeeFormId,
  };
}

/** A published form with one required question, which is all any test needs. */
async function publishForm(opts: {
  cycleId: string;
  teamId?: string;
  openingId?: string;
  kind: "common" | "committee";
  title: string;
  questionKey: string;
  label: string;
  type: "short_text" | "long_text";
}) {
  const now = new Date();
  const [row] = await db
    .insert(form)
    .values({
      cycleId: opts.cycleId,
      teamId: opts.teamId ?? null,
      openingId: opts.openingId ?? null,
      kind: opts.kind,
      title: opts.title,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: form.id });
  const [version] = await db
    .insert(formVersion)
    .values({
      formId: row!.id,
      version: 1,
      status: "published",
      publishedAt: now,
      createdBy: "director",
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: formVersion.id });
  await db.insert(question).values({
    formVersionId: version!.id,
    questionKey: opts.questionKey,
    type: opts.type,
    label: opts.label,
    required: true,
    position: 1,
  });
  return row!.id;
}

/**
 * Moves a cycle's deadline into the past.
 *
 * Lets a test put the stack in the state where the browser still believes the
 * cycle is open - which is precisely when a client-side deadline check would
 * wave a late submission through.
 */
export async function closeCycleDeadline(cycleId: string) {
  await db
    .update(recruitmentCycle)
    .set({
      opensAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
      closesAt: new Date(Date.now() - 60 * 1000),
    })
    .where(eq(recruitmentCycle.id, cycleId));
}
