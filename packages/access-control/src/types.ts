/**
 * Access-control value types.
 *
 * This package imports types from `@recruit/db/schema` but **never the database
 * client**, so the identical predicates run in the browser and on the server.
 * That is what stops one rule becoming two implementations that drift.
 */

/**
 * The global role, derived from the identity provider's `groups` claim.
 *
 * Deliberately coarse. It decides whether somebody can bootstrap — create the
 * first cycle, the first teams, the first grants — and nothing else. Authority
 * over applicant data comes from `permission_grant` rows, not from here.
 */
export type Role = "admin" | "user" | "guest";

/** The authenticated caller, before any cycle-scoped grants are resolved. */
export type User = { id: string; role: Role };

/*
 * TODO(track-b): the recruitment subject and action vocabulary, and the
 * grant-based `ScopedUser`, land with #10. The compiler in `drizzle.ts` is
 * already here and is the mechanism those rules compile through — see
 * `docs/authorization.md`.
 */
