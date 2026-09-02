import jwt from "jsonwebtoken";

import { auth } from "./auth.ts";

const PROVIDER_ID = "keycloak";

/**
 * The identity provider's access token for this request, or null.
 *
 * Null is an ordinary answer, not a failure: an account created with a local
 * password has no provider token at all. This used to reject in that case, and
 * because the caller treated a rejection as "not authenticated", every
 * password-authenticated request resolved to a guest.
 */
export async function getJwtPayloadFromHeaders(headers?: Headers): Promise<jwt.JwtPayload | null> {
  try {
    const accessToken = await auth.api.getAccessToken({
      body: { providerId: PROVIDER_ID },
      headers: headers,
    });
    return jwt.decode(accessToken.accessToken, { json: true });
  } catch {
    return null;
  }
}
