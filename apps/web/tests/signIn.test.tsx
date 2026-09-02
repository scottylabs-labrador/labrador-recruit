import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { setSession, setSignInFails } from "./msw/handlers.ts";
import { renderApp } from "./render.tsx";

/**
 * Sign-in redirects to Keycloak, so the only failure the browser can observe is
 * "the identity provider could not be reached". Reporting that mattered enough
 * to pin: it previously only reached the console, so a reviewer clicking the
 * button saw nothing happen at all and had no reason to report an outage.
 */
describe("sign in", () => {
  it("tells the user when the identity provider cannot be reached", async () => {
    setSession(null);
    setSignInFails(true);
    const user = userEvent.setup();

    await renderApp("/");

    await user.click(await screen.findByRole("button", { name: "Sign In" }));

    expect(await screen.findByText(/Could not reach the sign-in provider/)).toBeDefined();
  });

  it("says nothing when sign-in succeeds", async () => {
    setSession(null);
    setSignInFails(false);
    const user = userEvent.setup();

    await renderApp("/");

    await user.click(await screen.findByRole("button", { name: "Sign In" }));

    expect(screen.queryByText(/Could not reach the sign-in provider/)).toBeNull();
  });
});
