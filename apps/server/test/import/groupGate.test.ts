import { describe, expect, it } from "vitest";

import { isInAllowedGroup, parseAllowedGroups } from "../../src/lib/authConfig.ts";

/**
 * Goldador is the register of who works on this project. `infra/keycloak/teams.tf`
 * puts every `teams[slug].members.andrew_ids` into a Keycloak group named after
 * the slug and every admin into `<slug>-admins`, and emits both in a `groups`
 * claim. Gating sign-in on that claim is what makes the Goldador entry the
 * thing that grants access.
 *
 * This matters because the realm brokers straight to CMU SAML with no local
 * login form: without a gate, every Andrew ID at the university can
 * authenticate and have an account created.
 */
describe("parseAllowedGroups", () => {
  it("reads a comma-separated list", () => {
    expect(parseAllowedGroups("labrador-recruit,labrador-recruit-admins")).toEqual([
      "labrador-recruit",
      "labrador-recruit-admins",
    ]);
  });

  it("ignores surrounding whitespace and trailing commas", () => {
    expect(parseAllowedGroups(" labrador-recruit , ,")).toEqual(["labrador-recruit"]);
  });

  it("reads an unset variable as no groups", () => {
    expect(parseAllowedGroups("")).toEqual([]);
  });
});

describe("isInAllowedGroup", () => {
  const allowed = ["labrador-recruit", "labrador-recruit-admins"];

  it("admits a member of the project's team group", () => {
    expect(isInAllowedGroup(["labrador-recruit"], allowed)).toBe(true);
  });

  it("admits an admin, who is in the nested admins group", () => {
    expect(isInAllowedGroup(["labrador-recruit", "labrador-recruit-admins"], allowed)).toBe(true);
  });

  /**
   * The realm is shared across every ScottyLabs project, so someone on another
   * team authenticates perfectly well against CMU and must still be refused.
   */
  it("refuses somebody on a different ScottyLabs team", () => {
    expect(isInAllowedGroup(["collegecart", "cmumaps"], allowed)).toBe(false);
  });

  it("refuses a CMU account on no team at all", () => {
    expect(isInAllowedGroup([], allowed)).toBe(false);
  });

  /**
   * An absent claim means the group mapper is not reaching this token, not
   * that the person is unrestricted. Reading it as "no restriction" would turn
   * a Keycloak misconfiguration into an open door without anything failing.
   */
  it("refuses when the claim is missing entirely", () => {
    expect(isInAllowedGroup(undefined, allowed)).toBe(false);
    expect(isInAllowedGroup(null, allowed)).toBe(false);
  });

  it("refuses a claim that is not a list of groups", () => {
    expect(isInAllowedGroup("labrador-recruit", allowed)).toBe(false);
    expect(isInAllowedGroup({ groups: allowed }, allowed)).toBe(false);
    expect(isInAllowedGroup([42, null], allowed)).toBe(false);
  });

  /**
   * An empty allow-list is a misconfiguration. The caller always appends
   * `ADMIN_GROUP`, so in practice it cannot be empty - but if it ever is,
   * refusing everyone is the safe reading.
   */
  it("refuses everyone when no groups are allowed", () => {
    expect(isInAllowedGroup(["labrador-recruit"], [])).toBe(false);
  });

  /**
   * Goldador sets `full_path = false`, so names arrive bare. Tolerating the
   * path form means flipping that flag does not lock the whole team out.
   */
  it("accepts the full-path form of the same group", () => {
    expect(isInAllowedGroup(["/labrador-recruit"], allowed)).toBe(true);
  });
});
