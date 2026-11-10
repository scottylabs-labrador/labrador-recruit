import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { authClient } from "@/lib/authClient";

/**
 * The staff surface, and the guard in front of it.
 *
 * **The guard is a navigation courtesy, not the security boundary.** Every
 * endpoint behind these pages resolves the caller's live grants per request and
 * refuses on its own — and refuses with 404, so a page reached by guessing a
 * URL tells somebody nothing. What this achieves is that a staff member
 * following a link while signed out gets a sign-in page that returns them to
 * where they were going, rather than a screen full of failed requests.
 *
 * There is deliberately no role check here. Authority is per cycle and per
 * team, so "is this person staff" is not a question with an answer at this
 * level - the only honest check is the one each endpoint already makes.
 */
export const Route = createFileRoute("/admin")({
  beforeLoad: async ({ location }) => {
    const { data } = await authClient.getSession();
    if (!data) {
      throw redirect({ to: "/signin", search: { redirect: location.href } });
    }
  },
  component: () => <Outlet />,
});
