import type { Role } from "@labrador/access-control";
import * as schema from "@labrador/db/schema";
import { user as userTable } from "@labrador/db/schema";
import type { Session, User } from "better-auth";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { customSession, genericOAuth } from "better-auth/plugins";
import { eq } from "drizzle-orm";

import { env } from "../env.ts";
import {
  isClientIdRegistered,
  isInAllowedGroup,
  isPasswordSignInEnabled,
  parseAllowedGroups,
} from "./authConfig.ts";
import { getJwtPayloadFromHeaders } from "./authUtils.ts";
import { db } from "./db.ts";
import { getRoleFromJwt, toRole } from "./role.ts";

/**
 * Custom session type.
 *
 * Used by the web client via the `useSession` hook.
 * Used by the server via
 */
interface Auth {
  session: Session;
  user: User & { role: Role; mustChangePassword: boolean };
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

/**
 * Whether a real OIDC client is configured, which is the cutover switch.
 *
 * Everything about how people sign in follows from this one variable, so the
 * move to CMU single sign-on is a deployment change rather than a code change -
 * and, just as importantly, reverting it restores password sign-in immediately
 * if the identity provider turns out to be misconfigured.
 */
const identityProviderConfigured = isClientIdRegistered(env.AUTH_CLIENT_ID);

/**
 * The Goldador groups permitted to sign in.
 *
 * `ADMIN_GROUP` is appended unconditionally: it is the group Goldador puts the
 * project's admins in, and including it means a mistyped allow-list degrades to
 * "only admins can sign in" rather than "nobody can".
 */
const allowedGroups = [...parseAllowedGroups(env.AUTH_ALLOWED_GROUPS), env.ADMIN_GROUP];

/** Resolved once, because Better Auth is configured at module load. */
const passwordSignIn = isPasswordSignInEnabled(env.PASSWORD_SIGN_IN, identityProviderConfigured);

// https://www.better-auth.com/docs/installation#create-a-better-auth-instance
export const auth = betterAuth({
  baseURL: env.SERVER_URL,
  trustedOrigins: [env.BETTER_AUTH_URL],
  database: drizzleAdapter(db, { schema, provider: "pg" }),

  /**
   * Local accounts, for running a cycle before an identity provider exists.
   *
   * Sign-up is closed: an administrator creates the account and issues a
   * temporary password. Letting anyone register would put a stranger one form
   * submission away from an account on a system holding applicant essays, and
   * the Andrew ID - which every membership, assignment and review points at -
   * would then be self-asserted rather than granted.
   */
  emailAndPassword: {
    // Password sign-in is the fallback for a deployment with no identity
    // provider, not a second door alongside one. Once Goldador has issued a
    // client, CMU single sign-on is the only way in and a password that was
    // issued earlier stops working - which is the point, since those were
    // shared temporary credentials.
    //
    // The hasher is unaffected: Better Auth builds `ctx.password` regardless,
    // so `accountService` can still write an account for a deployment that
    // needs one.
    enabled: passwordSignIn,
    disableSignUp: true,
    minPasswordLength: 12,
  },

  hooks: {
    /**
     * Clears the temporary-password flag once someone has actually replaced it.
     *
     * The flag is what the interface gates every screen on, and Better Auth
     * owns the change-password endpoint, so nothing else is in a position to
     * notice it succeeded. Without this the person changes their password and
     * stays locked on the same screen forever - which is exactly what happened
     * the first time this was deployed.
     */
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/change-password") {
        return;
      }
      // The hook runs whether the endpoint succeeded or refused, and clearing
      // the flag on a rejected attempt would let anyone past the gate by
      // submitting the wrong current password.
      if (ctx.context.returned instanceof APIError) {
        return;
      }
      const userId = ctx.context.session?.user.id ?? ctx.context.newSession?.user.id;
      if (typeof userId !== "string") {
        return;
      }
      await db
        .update(userTable)
        .set({ mustChangePassword: false, updatedAt: new Date() })
        .where(eq(userTable.id, userId));
    }),
  },

  user: {
    additionalFields: {
      role: { type: "string", input: false, defaultValue: "user" },
      mustChangePassword: { type: "boolean", input: false, defaultValue: false },
    },
  },
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
        before: async (user) => {
          // `full_email` is the identity provider's claim; a locally created
          // account has only `email`. Either way the Andrew ID is the local
          // part, and it becomes the primary key every membership, assignment
          // and review is keyed by.
          const source = (user as unknown as { full_email?: string })["full_email"] ?? user.email;
          return { data: { ...user, id: source.split("@")[0] } };
        },
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

          /**
           * Refuses anyone Goldador has not put on this project.
           *
           * Without this, implicit sign-up is on - Better Auth computes the
           * gate purely from this provider config - and the realm brokers
           * straight to CMU SAML with no local login form. So every Andrew ID
           * at the university could authenticate and get a row created. They
           * would see nothing, because every screen is gated on cycle
           * membership, but an account on a system holding applicant essays
           * should not be one CMU login away.
           *
           * Rejecting here rather than with `disableImplicitSignUp` is what
           * keeps Goldador authoritative: a reviewer added to the team group
           * signs in and is provisioned on first login, with no separate step
           * here to remember. Turning implicit sign-up off outright would
           * refuse them until somebody created a row by hand.
           */
          mapProfileToUser: (profile) => {
            if (!isInAllowedGroup(profile["groups"], allowedGroups)) {
              throw new APIError("FORBIDDEN", {
                code: "NOT_IN_PROJECT_GROUP",
                message:
                  "Your CMU account is not on this project in Goldador, so it cannot sign in. " +
                  "Ask a ScottyLabs administrator to add your Andrew ID to the team.",
              });
            }
            // Every field is left to the provider's own claims; this hook is
            // only here for the check above.
            return {};
          },
        },
      ],
    }),

    // Reference: https://better-auth.com/docs/concepts/session-management#customizing-session-response
    customSession(async ({ user, session }, ctx): Promise<Auth> => {
      // An identity provider's groups win when there is a token to read them
      // from; otherwise the role stored on the user row is authoritative. That
      // ordering is what lets a deployment move to Keycloak later without
      // rewriting anyone's access.
      const jwtPayload = await getJwtPayloadFromHeaders(ctx.headers);
      const stored = user as unknown as { role?: string; mustChangePassword?: boolean };
      const role = jwtPayload === null ? toRole(stored.role) : getRoleFromJwt(jwtPayload);

      return {
        session,
        user: { ...user, role, mustChangePassword: stored.mustChangePassword ?? false },
      };
    }),
  ],
});
