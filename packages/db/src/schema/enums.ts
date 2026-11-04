import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Every enum the schema uses, in one place.
 *
 * **Shared file: append-only and alphabetical within a group.** Both tracks add
 * to it, and a conflict in a file ordered any other way is one somebody has to
 * think about rather than resolve mechanically.
 */

/* -------------------------------------------------------------------------- */
/* Organization                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A role a `permission_grant` confers.
 *
 * Layered on top of the global `admin | user | guest` role rather than
 * replacing it. Holding the ScottyLabs admin group lets somebody create a cycle
 * and issue grants; it does not let them read applicant data.
 */
export const grantRole = pgEnum("grant_role", [
  "org_admin",
  "committee_director",
  "question_editor",
  "reviewer",
]);

/**
 * What a grant applies to.
 *
 * `organization` grants carry no team; `team` grants must name one. The database
 * enforces that pairing with a CHECK, because a grant with the wrong shape is
 * either authority nobody intended or authority that silently applies nowhere.
 */
export const grantScope = pgEnum("grant_scope", ["organization", "team"]);

/* -------------------------------------------------------------------------- */
/* Cycles                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Where a cycle sits in its lifecycle.
 *
 * Unlike v1, where status was cosmetic apart from `archived`, these are
 * enforced: submission checks the cycle status server-side and every transition
 * is explicit and audited.
 */
export const cycleStatus = pgEnum("cycle_status", [
  "draft",
  "scheduled",
  "open",
  "closed",
  "reviewing",
  "decisions_released",
  "archived",
]);

/**
 * Whether one committee is accepting applications in one cycle.
 *
 * Deliberately independent of the cycle's own status. A cycle can be `open`
 * while a committee's form is still unpublished, and that committee simply does
 * not accept applications yet.
 */
export const openingStatus = pgEnum("opening_status", ["draft", "open", "closed"]);
