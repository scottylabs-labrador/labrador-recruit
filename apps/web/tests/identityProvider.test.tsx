import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { setIdentityProviderConfigured } from "./msw/handlers.ts";
import { renderApp } from "./render.tsx";

/**
 * A deployment whose OIDC client has not been registered still produces a
 * perfectly well-formed redirect, because Better Auth builds the authorize URL
 * from the issuer's discovery document without checking that the client
 * exists. Following it lands the user on Keycloak's own "Client not found"
 * page, off-site, with nothing to say what is wrong or who can fix it.
 */
describe("identity provider availability", () => {
  it("offers single sign-on when a client is registered", async () => {
    setIdentityProviderConfigured(true);
    await renderApp("/");

    expect(
      await screen.findByRole("button", { name: "Or sign in with your Andrew ID" }),
    ).toBeDefined();
    expect(screen.queryByText("Single sign-on is not available yet")).toBeNull();
  });

  it("withholds single sign-on and explains when no client is registered", async () => {
    setIdentityProviderConfigured(false);
    await renderApp("/");

    expect(await screen.findByText("Single sign-on is not available yet")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Or sign in with your Andrew ID" })).toBeNull();
  });

  it("names who can fix it rather than only saying it is broken", async () => {
    setIdentityProviderConfigured(false);
    await renderApp("/");

    expect(await screen.findByText(/ScottyLabs administrator/)).toBeDefined();
  });

  it("keeps the header control honest too", async () => {
    setIdentityProviderConfigured(false);
    await renderApp("/");

    expect(await screen.findByText("Sign-in unavailable")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Sign In" })).toBeNull();
  });
});
