import { account, user } from "@recruit/db/schema";
import jwt from "jsonwebtoken";

import { testDb } from "./harness.ts";
import { privateKeyPem } from "./keys.ts";

/**
 * A bearer token for an authenticated caller.
 *
 * Signed with the suite's own key, which `setup.ts` serves in place of the
 * identity provider's JWKS endpoint. The signature is real and really verified;
 * only the key delivery is local.
 *
 * `groups` decides the global role, exactly as it does in production. An empty
 * list is the common case: somebody who signed in with a CMU account and holds
 * no authority at all.
 */
export function authHeader(opts: { sub: string; groups?: string[] }) {
  const token = jwt.sign({ sub: opts.sub, groups: opts.groups ?? [] }, privateKeyPem, {
    algorithm: "RS256",
    issuer: process.env["AUTH_ISSUER"],
    audience: process.env["AUTH_CLIENT_ID"],
    keyid: "test-kid",
    expiresIn: "1h",
  });
  return { Authorization: `Bearer ${token}` };
}

/**
 * A signed-in CMU account holding no authority at all.
 *
 * The `account` row is what links the identity provider's subject to our
 * `user.id`, and `user.id` is the Andrew ID. Without it a perfectly valid token
 * resolves to nobody — which is the shape of a real first sign-in, and worth
 * being able to construct deliberately.
 */
export async function seedApplicant(
  andrewId: string,
): Promise<{ andrewId: string; headers: Record<string, string> }> {
  const now = new Date();
  await testDb.insert(user).values({
    id: andrewId,
    name: andrewId,
    email: `${andrewId}@andrew.cmu.edu`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  await testDb.insert(account).values({
    id: `${andrewId}-account`,
    accountId: `${andrewId}-sub`,
    providerId: "keycloak",
    userId: andrewId,
    createdAt: now,
    updatedAt: now,
  });
  return { andrewId, headers: authHeader({ sub: `${andrewId}-sub` }) };
}
