/**
 * The sign-in page and the route guard that sends people to it.
 *
 * The guard is a navigation courtesy, never the security boundary — every
 * endpoint behind these pages refuses an unauthenticated request on its own.
 * See `docs/ui.md` section 1. What these tests protect is that somebody
 * following a deep link is returned to it rather than dumped on the dashboard,
 * because losing the destination is how a shared link to a specific committee
 * stops working.
 */
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { setSession } from "./msw/handlers.ts";
import { renderApp } from "./render.tsx";

describe("the sign-in page", () => {
  it("offers single sign-on", async () => {
    await renderApp("/signin");

    expect(
      await screen.findByRole("button", { name: /sign in with your andrew id/i }),
    ).toBeDefined();
  });

  it("says what happens to the data an applicant is about to enter", async () => {
    await renderApp("/signin");

    // Asked for before the essays, not buried afterwards.
    expect(await screen.findByRole("heading", { name: /your data/i })).toBeDefined();
    expect(await screen.findByText(/not evaluated by any model/i)).toBeDefined();
  });

  it("says who to contact when sign-in does not work", async () => {
    await renderApp("/signin");

    // Every CMU Andrew ID authenticates here, so somebody refused access was
    // refused by *authorization*, and the page they are stuck on has to tell
    // them that a human can fix it.
    expect(await screen.findByText(/a scottylabs administrator can fix it/i)).toBeDefined();
    expect(await screen.findByRole("link", { name: /contact/i })).toBeDefined();
  });

  it("tells the person where they will be sent back to", async () => {
    await renderApp("/signin?redirect=%2Fapp%2Fapply%2Flabrador");

    expect(await screen.findByText(/you will be returned to/i)).toBeDefined();
  });
});

describe("the guard on the applicant surface", () => {
  it("sends an unauthenticated visitor to sign in, keeping their destination", async () => {
    setSession(null);

    const { router } = await renderApp("/app/dashboard");

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/signin");
    });
    // The destination survives the round trip. Dropping it would break every
    // shared link into the applicant surface, silently.
    expect(router.state.location.search).toMatchObject({ redirect: "/app/dashboard" });
  });

  it("lets a signed-in applicant through", async () => {
    setSession({
      user: { id: "aquinn", name: "Avery Quinn", email: "aquinn@andrew.cmu.edu", role: "user" },
    });

    const { router } = await renderApp("/app/dashboard");

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/app/dashboard");
    });
  });
});
