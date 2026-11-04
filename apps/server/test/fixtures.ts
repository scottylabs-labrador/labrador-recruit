import jwt from "jsonwebtoken";

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
