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
