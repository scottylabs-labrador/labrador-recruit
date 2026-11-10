import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * The root path is the recruitment landing page.
 *
 * A redirect rather than a second copy of it. `docs/ui.md` names `/recruit` as
 * the canonical path, and two routes rendering the same page is two places for
 * it to drift - which is how one of them ends up stale while still being the
 * one people link to.
 */
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/recruit" });
  },
});
