import type { auth } from "@labrador/server/src/lib/auth";
import { customSessionClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { toast } from "react-toastify";

import { env } from "@/env.ts";

// https://www.better-auth.com/docs/installation#create-client-instance
const authClient = createAuthClient({
  baseURL: env.VITE_SERVER_URL,
  // https://www.better-auth.com/docs/concepts/session-management#customizing-session-response
  plugins: [customSessionClient<typeof auth>()],
});

/**
 * Sign-in redirects to Keycloak, so a failure here means the identity provider
 * could not be reached at all - a misconfigured issuer, or Keycloak being down.
 *
 * The failure is reported rather than only logged. Logging to the console left
 * someone clicking a button that appeared to do nothing whatsoever, which reads
 * as a broken page rather than an outage they should report.
 */
export function signIn() {
  void authClient.signIn
    .social({
      provider: "keycloak",
      callbackURL: window.location.href,
    })
    .then((result) => {
      if (result.error) {
        console.error(result.error);
        toast.error(
          "Could not reach the sign-in provider. Check your connection, and tell ScottyLabs if this keeps happening.",
        );
      }
    })
    .catch((error: unknown) => {
      console.error(error);
      toast.error("Could not reach the sign-in provider.");
    });
}

/**
 * Signs in with an Andrew ID and password.
 *
 * Returns an error message rather than throwing, because every failure here is
 * something the person can act on and needs to read: a wrong password, an
 * account that does not exist, or the API being unreachable.
 */
export async function signInWithPassword(
  andrewId: string,
  password: string,
): Promise<string | null> {
  const email = andrewId.includes("@") ? andrewId.trim() : `${andrewId.trim()}@andrew.cmu.edu`;

  try {
    const result = await authClient.signIn.email({ email, password });
    if (result.error) {
      return result.error.message ?? "That Andrew ID and password did not match.";
    }
    return null;
  } catch (error) {
    console.error(error);
    return "Could not reach the server. Check your connection and try again.";
  }
}

/** Replaces a temporary password with one the person chose themselves. */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<string | null> {
  try {
    const result = await authClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: true,
    });
    if (result.error) {
      return result.error.message ?? "Could not change your password.";
    }
    return null;
  } catch (error) {
    console.error(error);
    return "Could not reach the server. Check your connection and try again.";
  }
}

export function signOut() {
  void authClient
    .signOut()
    .then((result) => {
      if (result.error) {
        console.error(result.error);
        toast.error("Could not sign you out. Please try again.");
      }
    })
    .catch((error: unknown) => {
      console.error(error);
      toast.error("Could not sign you out. Please try again.");
    });
}

export const { useSession } = authClient;
export { authClient };
