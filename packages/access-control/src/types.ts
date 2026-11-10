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

/**
 * A role somebody holds over some scope, from a live `permission_grant` row.
 *
 * "Live" is decided when the row is read — `revoked_at IS NULL` and
 * (`expires_at IS NULL` or `expires_at > now()`), against the server clock.
 * Nothing here is cached and nothing is embedded in a session, so revocation
 * takes effect on the next request. See `docs/authorization.md` section 5.
 */
export type GrantRole = "org_admin" | "committee_director" | "question_editor" | "reviewer";

export interface Grant {
  role: GrantRole;
  scope: "organization" | "team";
  /** Null for organization scope, required for team scope. The DB enforces it. */
  teamId: string | null;
  /** Null for a grant that is not tied to one recruitment cycle. */
  cycleId: string | null;
}

/**
 * The caller, their live grants, and the two sets no column comparison can
 * express.
 *
 * Resolved per request. The two id sets are the technique that turns cross-row
 * rules into ordinary conditions the compiler can handle:
 *
 * - `assignedApplicationIds` — a team-scoped reviewer grant conveys **standing,
 *   not content**. Assignment is a separate and necessary condition, and it is
 *   the row of `docs/authorization.md` section 2's table that people get wrong.
 * - `unblindedApplicationIds` — applications where *this* caller's own review is
 *   `submitted`. A draft does not unblind. Whether somebody may read a peer's
 *   scores depends on the state of a different row, which is why it cannot be a
 *   column comparison.
 */
export interface ScopedUser extends User {
  /** The cycle these grants were resolved for. Null outside any cycle. */
  cycleId: string | null;
  grants: readonly Grant[];
  assignedApplicationIds: readonly string[];
  unblindedApplicationIds: readonly string[];
}

/**
 * Everything authorization is asked about, enumerated.
 *
 * Closed on purpose. A subject absent from this union is a subject with no
 * rules, and `drizzleWhere` throws `NotPermittedError` rather than returning
 * "no filter" — so a typo in a subject name fails loudly instead of quietly
 * authorizing everything.
 */
export const SUBJECTS = [
  "RecruitmentCycle",
  "Team",
  "RecruitmentOpening",
  "Form",
  "FormVersion",
  "CandidateProfile",
  "Application",
  "Rubric",
  "ReviewAssignment",
  "Review",
  "Decision",
  "PermissionGrant",
  "Invitation",
  "File",
] as const;

export type Subject = (typeof SUBJECTS)[number];

/**
 * The actions, enumerated.
 *
 * `publish`, `assign`, `release` and `readPeerReview` are separate from the four
 * CRUD verbs because each is a distinct authority somebody can hold without the
 * others. A `question_editor` may `update` a form and must never `publish` one;
 * a reviewer may `read` a `Review` of their own and must not `readPeerReview`
 * until they have submitted. Collapsing either pair into "write" or "read" is
 * how those distinctions get lost.
 */
export const ACTIONS = [
  "read",
  "create",
  "update",
  "delete",
  "publish",
  "assign",
  "release",
  "readPeerReview",
  "export",
  "grant",
] as const;

export type Action = (typeof ACTIONS)[number];
