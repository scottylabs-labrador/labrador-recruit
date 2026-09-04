/**
 * What `AUTH_CLIENT_ID` is set to before the OIDC client exists.
 *
 * A deployment needs a value for the variable to satisfy validation at boot,
 * but registering the client requires access to the identity provider that a
 * development or preview deployment may not have yet. This sentinel is what
 * gets written in the meantime, and it is the only local signal that sign-in
 * cannot possibly succeed.
 */
export const UNREGISTERED_CLIENT_ID = "not-yet-registered";

/**
 * Whether a client id names a client that could actually exist.
 *
 * Deliberately takes the id rather than reading the environment, so it stays a
 * pure function that the fast unit tests can exercise without booting config.
 *
 * Better Auth builds the authorize URL from the issuer's discovery document
 * without checking that the client exists, so an unregistered deployment still
 * returns a perfectly well-formed redirect. The user then lands on the identity
 * provider's own "Client not found" page, having left the application
 * entirely, with nothing on screen to say what is wrong or who can fix it.
 * Reporting this before the redirect is the difference between a dead end and
 * an explanation.
 */
export function isClientIdRegistered(clientId: string): boolean {
  const trimmed = clientId.trim();
  return trimmed !== "" && trimmed !== UNREGISTERED_CLIENT_ID;
}

/**
 * Splits the configured allow-list into group names.
 *
 * Comma-separated because it is carried in one environment variable, and blank
 * entries are dropped so a trailing comma is not a group nobody is in.
 */
export function parseAllowedGroups(raw: string): string[] {
  return raw
    .split(",")
    .map((group) => group.trim())
    .filter((group) => group !== "");
}

/**
 * Whether an identity provider's `groups` claim permits signing in.
 *
 * Goldador is the register of who works on this project: `infra/keycloak/teams.tf`
 * puts every `teams[slug].members.andrew_ids` in a Keycloak group named after
 * the slug, and every admin in `<slug>-admins`. Gating on that claim is what
 * makes the Goldador entry the thing that grants access, rather than a second
 * list maintained here that would immediately drift from it.
 *
 * Denying when the claim is missing is deliberate. Keycloak's group-membership
 * mapper emits an empty array for somebody in no groups, so an absent claim
 * means the mapper is not reaching this token at all - and treating that as
 * "no restriction" would turn a misconfiguration into an open door silently.
 * Failing closed is recoverable: returning `AUTH_CLIENT_ID` to the sentinel
 * restores password sign-in immediately.
 *
 * An empty allow-list denies for the same reason. `ADMIN_GROUP` is always
 * appended by the caller, so the list is never empty in practice and an
 * administrator can always get in to fix the configuration.
 */
export function isInAllowedGroup(claim: unknown, allowed: readonly string[]): boolean {
  if (allowed.length === 0 || !Array.isArray(claim)) {
    return false;
  }

  return claim.some((group) => {
    if (typeof group !== "string") {
      return false;
    }
    // Goldador sets `full_path = false`, so names arrive bare. Tolerating a
    // leading slash costs nothing and means flipping that flag on does not
    // lock everybody out.
    return allowed.includes(group.startsWith("/") ? group.slice(1) : group);
  });
}

/**
 * Whether password sign-in should be available.
 *
 * Password accounts exist so a cycle can run before an identity provider does.
 * Leaving them enabled alongside one would be a way around the Goldador group
 * gate - and the passwords issued in that window were deliberately short-lived
 * shared credentials, so they are exactly what should stop working.
 */
export function isPasswordSignInEnabled(
  setting: "auto" | "on" | "off",
  identityProviderConfigured: boolean,
): boolean {
  if (setting === "auto") {
    return !identityProviderConfigured;
  }
  return setting === "on";
}
