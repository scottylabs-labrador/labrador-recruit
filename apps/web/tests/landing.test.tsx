/**
 * The root path.
 *
 * Its content moved to `/recruit`, which `docs/ui.md` names as the canonical
 * landing path, and the assertions about that content moved with it to
 * `recruit.test.tsx` and `signin.test.tsx`. What is left here is the one thing
 * this route still does: send people there. A second copy of the page would be
 * a second place for it to drift, and the stale one is always the one people
 * have linked to.
 */
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderApp } from "./render.tsx";

describe("an unknown path", () => {
  it("explains the link is wrong rather than rendering a bare Not Found", async () => {
    await renderApp("/application-form-2024");

    // The likeliest person here is an applicant following a stale link from an
    // old announcement. They need a way to the committees and a reassurance
    // that nothing happened to their application, not a diagnosis.
    expect(await screen.findByRole("heading", { name: /does not exist/i })).toBeDefined();
    expect(await screen.findByRole("link", { name: /go to the committees/i })).toBeDefined();
  });
});

describe("the root path", () => {
  it("sends a visitor to the recruitment page", async () => {
    const { router } = await renderApp("/");

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/recruit");
    });
  });
});
