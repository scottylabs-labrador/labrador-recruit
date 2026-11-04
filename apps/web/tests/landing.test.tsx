/**
 * Regression tests on the landing page that survived the v1 demolition.
 *
 * Not test-first — the page already existed. These pin down what the public
 * surface says now that the product is an applicant portal rather than an
 * internal review tool, so #23 inherits a harness and a baseline instead of a
 * blank directory.
 */
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { setIdentityProviderConfigured } from "./msw/handlers.ts";
import { renderApp } from "./render.tsx";

describe("the landing page", () => {
  it("says what the platform is for an applicant", async () => {
    await renderApp("/");

    // By role, because the nav link carries the same words as the heading.
    expect(await screen.findByRole("heading", { name: "ScottyLabs Recruit" })).toBeDefined();
    expect(await screen.findByText(/apply to scottylabs committees in one place/i)).toBeDefined();
  });

  it("states that no model evaluates an applicant", async () => {
    await renderApp("/");

    // Product rule 1 is a promise made to applicants, so it is on the page they
    // see before they decide to apply, not only in the repository.
    expect(await screen.findByText(/not evaluated by any model/i)).toBeDefined();
  });

  it("offers single sign-on when an identity provider is configured", async () => {
    setIdentityProviderConfigured(true);

    await renderApp("/");

    expect(
      await screen.findByRole("button", { name: /sign in with your andrew id/i }),
    ).toBeDefined();
  });

  it("withholds single sign-on when no identity provider is configured", async () => {
    // Better Auth builds a well-formed authorize URL whether or not the client
    // exists, so an unconfigured deployment would send somebody to the identity
    // provider's own "client not found" page, having left the application
    // entirely. Withholding the button is the difference between a dead end and
    // an explanation.
    setIdentityProviderConfigured(false);

    await renderApp("/");

    await screen.findByRole("heading", { name: "ScottyLabs Recruit" });

    // The hook treats sign-in as available *while loading*, deliberately: a
    // configured deployment is the common case by far, and briefly disabling the
    // button on every page load would be worse than the rare wrong guess. So
    // this waits for the answer rather than asserting on the first paint.
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /sign in with your andrew id/i })).toBeNull();
    });
  });
});
