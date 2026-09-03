import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { setIdentityProviderConfigured, setSession } from "./msw/handlers.ts";
import { renderApp } from "./render.tsx";

/**
 * How somebody signs in follows entirely from whether the deployment has an
 * OIDC client. Password accounts were the fallback for running a cycle before
 * one existed; once Goldador has issued one, CMU single sign-on is the only
 * way in and the form is withheld rather than left on screen to be refused.
 */
describe("which sign-in method is offered", () => {
  beforeEach(() => {
    setSession(null);
  });

  it("withholds the password form once a client is registered", async () => {
    setIdentityProviderConfigured(true);
    await renderApp("/");

    // The single sign-on control itself is covered by identityProvider.test.tsx;
    // what matters here is that the password form is gone rather than sitting
    // beside it as a way around the group gate.
    await screen.findByRole("button", { name: "Sign in with your Andrew ID" });
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(screen.queryByLabelText("Andrew ID")).toBeNull();
  });

  /**
   * The refusal happens at CMU's identity provider having already succeeded,
   * which reads as this site being broken unless the page says where access
   * comes from.
   */
  it("says access comes from the team register, so a refusal is not a mystery", async () => {
    setIdentityProviderConfigured(true);
    await renderApp("/");

    expect(await screen.findByText(/ScottyLabs team register/)).toBeDefined();
  });

  it("falls back to the password form when no client is registered", async () => {
    setIdentityProviderConfigured(false);
    await renderApp("/");

    expect(await screen.findByLabelText("Andrew ID")).toBeDefined();
    expect(screen.getByLabelText("Password")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Sign in with your Andrew ID" })).toBeNull();
  });
});
