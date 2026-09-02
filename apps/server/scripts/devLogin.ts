//
// Creates a local development session and prints the cookie for it.
//
// Signing in for real requires Keycloak, which requires a Goldador-registered
// OIDC client and ScottyLabs organisation access. This script exists so the
// platform can be run and evaluated without either: it writes the same rows
// Better Auth would have written after a successful login, then prints the
// signed cookie to paste into the browser.
//
// There is deliberately NO HTTP endpoint for this. A dev-login route would be
// one misconfigured environment variable away from letting anyone authenticate
// as an administrator in production. A script an operator runs against a
// database they already control adds no attack surface to the server at all.
//
// Usage:
//   bun run dev:login <andrewId> [--admin] [--name "Full Name"]
//

import { createDb } from "@labrador/db";
import { account, session, user } from "@labrador/db/schema";
import { eq } from "drizzle-orm";

const SESSION_COOKIE = "better-auth.session_token";
const SESSION_DAYS = 7;

async function signCookieValue(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return `${value}.${b64}`;
}

/**
 * Better Auth expects an `account` row carrying the identity-provider subject.
 * The access token is an unsigned JWT: nothing verifies it locally, but the
 * `groups` claim is what `getRoleFromJwt` reads to decide the global role.
 */
function unsignedAccessToken(sub: string, groups: string[]): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      sub,
      groups,
      full_email: `${sub}@andrew.cmu.edu`,
      iss: process.env["AUTH_ISSUER"] ?? "https://auth.example.com",
      aud: process.env["AUTH_CLIENT_ID"] ?? "local-client",
    }),
  ).toString("base64url");
  return `${header}.${payload}.local`;
}

async function main() {
  if (process.env["NODE_ENV"] === "production") {
    throw new Error("dev:login must never be run against a production database");
  }

  const args = process.argv.slice(2);
  const andrewId = args.find((arg) => !arg.startsWith("--"));
  if (!andrewId) {
    throw new Error('Usage: bun run dev:login <andrewId> [--admin] [--name "Full Name"]');
  }

  const isAdmin = args.includes("--admin");
  const nameIndex = args.indexOf("--name");
  const name = nameIndex >= 0 ? (args[nameIndex + 1] ?? andrewId) : andrewId;

  const databaseUrl = process.env["DATABASE_URL"];
  const secret = process.env["BETTER_AUTH_SECRET"];
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  if (!secret) throw new Error("BETTER_AUTH_SECRET is required");

  const adminGroup = process.env["ADMIN_GROUP"] ?? "labrador-recruit";
  const db = createDb(databaseUrl);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  await db
    .insert(user)
    .values({
      id: andrewId,
      name,
      email: `${andrewId}@andrew.cmu.edu`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({ target: user.id, set: { name, updatedAt: now } });

  await db
    .insert(account)
    .values({
      id: `${andrewId}-local`,
      accountId: `${andrewId}-sub`,
      providerId: "keycloak",
      userId: andrewId,
      accessToken: unsignedAccessToken(`${andrewId}-sub`, isAdmin ? [adminGroup] : []),
      accessTokenExpiresAt: expiresAt,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: account.id,
      set: {
        accessToken: unsignedAccessToken(`${andrewId}-sub`, isAdmin ? [adminGroup] : []),
        accessTokenExpiresAt: expiresAt,
        updatedAt: now,
      },
    });

  const sessionToken = `local-${andrewId}-${now.getTime()}`;
  await db.delete(session).where(eq(session.userId, andrewId));
  await db.insert(session).values({
    id: `${andrewId}-local-session`,
    token: sessionToken,
    userId: andrewId,
    expiresAt,
    createdAt: now,
    updatedAt: now,
  });

  const cookieValue = await signCookieValue(sessionToken, secret);

  // Better Auth prefixes the cookie with `__Secure-` over HTTPS, and a browser
  // refuses to store that name without the Secure attribute. Printing the
  // local name against a deployed server produces a cookie the API silently
  // ignores, which reads as "the session did not work".
  const serverUrl = process.env["SERVER_URL"] ?? "http://localhost";
  const isHttps = serverUrl.startsWith("https://");
  const cookieName = isHttps ? `__Secure-${SESSION_COOKIE}` : SESSION_COOKIE;
  const attributes = isHttps ? "; path=/; Secure; SameSite=None" : "; path=/";
  const webOrigin = process.env["BETTER_AUTH_URL"] ?? "http://localhost:3000";

  console.log(`
Signed in as ${andrewId}${isAdmin ? " (global admin group)" : ""}.

The cookie belongs to the API's origin, so set it there - ${serverUrl} - and
then open ${webOrigin}:

  document.cookie = "${cookieName}=${encodeURIComponent(cookieValue)}${attributes}";

The session expires ${expiresAt.toISOString()}.

A global admin can create a cycle, but still needs a recruitment membership
before any applicant data is visible. That separation is deliberate.
`);

  await db.$client.end();
}

main().catch((error: unknown) => {
  console.error("dev:login failed:", error);
  process.exit(1);
});
