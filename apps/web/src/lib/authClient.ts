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
