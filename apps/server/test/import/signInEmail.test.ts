import { describe, expect, it } from "vitest";

import { signInEmail } from "../../src/lib/authConfig.ts";

/**
 * CMU lets people set an alias, and Keycloak's `email` claim is that alias
 * whenever one exists. Goldador maps a second claim, `full_email`, straight
 * from LDAP, and that one is always the Andrew address.
 *
 * Which address we keep is not cosmetic: the Andrew ID is the primary key,
 * derived from the local part of whatever we store, and every membership,
 * assignment and review hangs off it.
 */
describe("choosing the address to identify somebody by", () => {
  it("prefers the Andrew address over the alias", () => {
    expect(signInEmail("yh4@andrew.cmu.edu", "yh4@cmu.edu")).toBe("yh4@andrew.cmu.edu");
  });

  /**
   * The failure this was written for. Yuxiang Huang's alias is `yh4@cmu.edu`
   * and his Andrew address is `yh4@andrew.cmu.edu`. Both have the local part
   * `yh4`, so both derive the same user id - but only one matches the row that
   * id already belongs to. Identifying him by the alias found no user by
   * email, took the create path, and collided with the existing primary key,
   * so he could not sign in at all.
   */
  it("resolves the alias that collided with an existing Andrew ID", () => {
    const chosen = signInEmail("yh4@andrew.cmu.edu", "yh4@cmu.edu");

    expect(chosen).toBe("yh4@andrew.cmu.edu");
    expect(chosen.split("@")[0]).toBe("yh4");
  });

  /**
   * The quieter half of the same bug: an alias whose local part differs from
   * the Andrew ID does not collide, it provisions a second account under the
   * wrong id - which signs in perfectly and shows an empty application.
   */
  it("keeps the Andrew ID when the alias local part differs", () => {
    expect(signInEmail("jsmith@andrew.cmu.edu", "john.smith@cmu.edu").split("@")[0]).toBe("jsmith");
  });

  /**
   * A deployment without Goldador's mapper has no claim to read. That is the
   * behaviour we had before, so it degrades rather than locking everybody out.
   */
  it("falls back to the provider's own address when the claim is absent", () => {
    expect(signInEmail(undefined, "someone@cmu.edu")).toBe("someone@cmu.edu");
    expect(signInEmail(null, "someone@cmu.edu")).toBe("someone@cmu.edu");
  });

  /** A claim that is not an address is not an address. */
  it("ignores a claim that is not usable", () => {
    expect(signInEmail("", "someone@cmu.edu")).toBe("someone@cmu.edu");
    expect(signInEmail("not-an-address", "someone@cmu.edu")).toBe("someone@cmu.edu");
    expect(signInEmail(42, "someone@cmu.edu")).toBe("someone@cmu.edu");
    expect(signInEmail(["yh4@andrew.cmu.edu"], "someone@cmu.edu")).toBe("someone@cmu.edu");
  });
});
