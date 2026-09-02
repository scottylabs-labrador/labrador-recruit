import type { Role } from "@labrador/access-control";
import * as schema from "@labrador/db/schema";
import type { Session, User } from "better-auth";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { customSession, genericOAuth } from "better-auth/plugins";

import { env } from "../env.ts";
import { getRoleFromJwt } from "./accessControl.ts";
import { getJwtPayloadFromHeaders } from "./authUtils.ts";
import { db } from "./db.ts";

/**
 * Custom session type.
 *
 * Used by the web client via the `useSession` hook.
 * Used by the server via
 */
interface Auth {
  session: Session;
  user: User & { role: Role };
}

/**
 * Whether the browser will treat the session cookie as cross-site.
 *
 * The cookie belongs to the API's origin, and the interface is served from a
 * different one. On Railway those are sibling subdomains of `up.railway.app`,
 * which is a public suffix, so they are cross-site rather than same-site and no
 * shared cookie domain is possible.
 *
 * Better Auth defaults to SameSite=Lax, which a browser will not send on a
 * cross-site request. The failure is quiet and confusing: sign-in completes,
 * Keycloak redirects back, and the app behaves as though nobody signed in.
 * SameSite=None fixes it, and requires Secure, so it is only correct over
 * HTTPS - applying it on local HTTP would stop the cookie being sent at all.
 */
const isCrossSite =
  env.SERVER_URL.startsWith("https://") &&
  env.BETTER_AUTH_URL.startsWith("https://") &&
  new URL(env.SERVER_URL).host !== new URL(env.BETTER_AUTH_URL).host;

// https://www.better-auth.com/docs/installation#create-a-better-auth-instance
export const auth = betterAuth({
  baseURL: env.SERVER_URL,
  trustedOrigins: [env.BETTER_AUTH_URL],
  database: drizzleAdapter(db, { schema, provider: "pg" }),
  ...(isCrossSite && {
    advanced: {
      defaultCookieAttributes: { sameSite: "none", secure: true },
    },
  }),

  // Override the user id to Andrew ID when creating a new user.
  // Note that we have to use the `full_email` field since the `email` field
  // in the JWT payload defaults to CMU alias emails if the user sets one.
  // References: https://www.cmu.edu/computing/services/comm-collab/email-calendar/how-to/emailalias.html
  //
  // Here is a scenario where using the `email` field is problematic: a user
  // without a CMU alias email created an account. Then they create an alias email
  // that is not their Andrew ID. We will fail to find the user in the database
  // when they try to login again and create a new account with the alias email.
  databaseHooks: {
    user: {
      create: {
        before: async (user) => ({
          data: {
            ...user,
            // @ts-expect-error The user here actually has all the JWT fields
            id: user["full_email"].split("@")[0],
          },
        }),
      },
    },
  },

  // https://better-auth.com/docs/plugins/generic-oauth#add-the-plugin-to-your-auth-config
  plugins: [
    genericOAuth({
      config: [
        {
          providerId: "keycloak",
          clientId: env.AUTH_CLIENT_ID,
          clientSecret: env.AUTH_CLIENT_SECRET,
          discoveryUrl: `${env.AUTH_ISSUER}/.well-known/openid-configuration`,
          redirectURI: `${env.SERVER_URL}/api/auth/oauth2/callback/keycloak`,
          scopes: ["openid", "email", "profile", "offline_access"],
        },
      ],
    }),

    // Reference: https://better-auth.com/docs/concepts/session-management#customizing-session-response
    customSession(async ({ user, session }, ctx): Promise<Auth> => {
      const jwtPayload = await getJwtPayloadFromHeaders(ctx.headers);
      return {
        session,
        user: { ...user, role: getRoleFromJwt(jwtPayload) },
      };
    }),
  ],
});
