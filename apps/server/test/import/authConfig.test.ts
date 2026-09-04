import { describe, expect, it } from "vitest";

import {
  isClientIdRegistered,
  isPasswordSignInEnabled,
  UNREGISTERED_CLIENT_ID,
} from "../../src/lib/authConfig.ts";

/**
 * Sign-in leaves the application for the identity provider, and Better Auth
 * builds that redirect from the issuer's discovery document without checking
 * that the client exists. A deployment with no registered client therefore
 * produces a perfectly well-formed redirect that lands the user on Keycloak's
 * own "Client not found" page, off-site, with nothing to say what is wrong.
 */
describe("isClientIdRegistered", () => {
  it("treats the placeholder a deployment is seeded with as unregistered", () => {
    expect(isClientIdRegistered(UNREGISTERED_CLIENT_ID)).toBe(false);
  });

  it("treats blank and whitespace-only ids as unregistered", () => {
    expect(isClientIdRegistered("")).toBe(false);
    expect(isClientIdRegistered("   ")).toBe(false);
  });

  it("ignores surrounding whitespace on the placeholder", () => {
    expect(isClientIdRegistered(`  ${UNREGISTERED_CLIENT_ID}  `)).toBe(false);
  });

  it("accepts a real client id", () => {
    expect(isClientIdRegistered("labrador-recruit")).toBe(true);
  });
});

/**
 * Password accounts exist so a cycle can run before an identity provider does.
 * Leaving them enabled alongside one would be a way around the Goldador group
 * gate, and the passwords issued in that window were short-lived shared
 * credentials - exactly what should stop working at the cutover.
 */
describe("isPasswordSignInEnabled", () => {
  it("switches passwords off once an identity provider is configured", () => {
    expect(isPasswordSignInEnabled("auto", true)).toBe(false);
  });

  it("keeps passwords available while there is no identity provider", () => {
    expect(isPasswordSignInEnabled("auto", false)).toBe(true);
  });

  it("can be forced on, which is how both doors are tested at once", () => {
    expect(isPasswordSignInEnabled("on", true)).toBe(true);
  });

  /**
   * Forcing it off with no identity provider locks everyone out. That is a
   * deliberate choice an operator can make - taking a deployment out of use is
   * a legitimate thing to want - so it is honoured rather than second-guessed.
   */
  it("can be forced off even with no identity provider", () => {
    expect(isPasswordSignInEnabled("off", false)).toBe(false);
  });
});
