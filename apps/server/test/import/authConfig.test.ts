import { describe, expect, it } from "vitest";

import { isClientIdRegistered, UNREGISTERED_CLIENT_ID } from "../../src/lib/authConfig.ts";

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
