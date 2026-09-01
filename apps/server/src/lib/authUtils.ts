import jwt from "jsonwebtoken";

import { auth } from "./auth.ts";

const PROVIDER_ID = "keycloak";

export async function getJwtPayloadFromHeaders(headers?: Headers): Promise<jwt.JwtPayload | null> {
  return await auth.api
    .getAccessToken({
      body: { providerId: PROVIDER_ID },
      headers: headers,
    })
    .then((accessToken) => jwt.decode(accessToken.accessToken, { json: true }));
}
