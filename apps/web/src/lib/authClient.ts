import type { auth } from "@labrador/server/src/lib/auth";
import { customSessionClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { env } from "@/env.ts";

// https://www.better-auth.com/docs/installation#create-client-instance
const authClient = createAuthClient({
  baseURL: env.VITE_SERVER_URL,
  // https://www.better-auth.com/docs/concepts/session-management#customizing-session-response
  plugins: [customSessionClient<typeof auth>()],
});

export function signIn() {
  void authClient.signIn
    .social({
      provider: "keycloak",
      callbackURL: window.location.href,
    })
    .then((result) => {
      if (result.error) {
        console.error(result.error);
      }
    });
}

export function signOut() {
  void authClient.signOut().then((result) => {
    if (result.error) {
      console.error(result.error);
    }
  });
}

export const { useSession } = authClient;
export { authClient };
