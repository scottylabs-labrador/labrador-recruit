import type { Grant, ScopedUser, User } from "@recruit/access-control";
import { permissionGrant, review, reviewAssignment } from "@recruit/db/schema";
import { and, eq, gt, isNull, ne, or } from "drizzle-orm";

import { db } from "./db.ts";

/**
 * The caller's live grants and the two sets no rule can express.
 *
 * Three queries, run per request and **never cached**. That is a stated
 * requirement rather than an optimisation nobody got round to: revocation has
 * to take effect on the next request, so there is no cached permission state
 * and no role list embedded in a session. Do not add a cache here without an
 * ADR — `docs/authorization.md` section 5 says so, and the immediate-effect
 * property is the reason a director can remove somebody's access and have it
 * mean something.
 */
export async function resolveScopedUser(user: User, cycleId: string | null): Promise<ScopedUser> {
  /*
   * A guest is resolved without touching the database.
   *
   * `getAcUserFromRequest` returns `{ id: "", role: "guest" }` for a valid
   * token belonging to somebody we have never seen — a first sign-in before
   * the callback has written the account row, or a token from another realm.
   * Looking up grants for an empty id would be meaningless at best, and at
   * worst a future row with an empty `user_id` would hand it authority.
   */
  if (user.role === "guest" || user.id === "") {
    return {
      ...user,
      cycleId,
      grants: [],
      assignedApplicationIds: [],
      unblindedApplicationIds: [],
    };
  }

  const now = new Date();

  /*
   * Live means not revoked and not expired, against the server clock.
   *
   * The clock is the server's deliberately: a client-supplied time would make
   * expiry something the caller controls.
   */
  const live = and(
    eq(permissionGrant.userId, user.id),
    isNull(permissionGrant.revokedAt),
    or(isNull(permissionGrant.expiresAt), gt(permissionGrant.expiresAt, now)),
  );

  /*
   * Applicable to the cycle being acted in.
   *
   * A grant naming a different cycle conveys nothing — last season's director
   * is not this season's. A grant with a null `cycle_id` is deliberately
   * cycle-independent and applies in whichever cycle is being acted in; with
   * no cycle in hand, only those apply, which is the bootstrap and
   * organization-admin case.
   */
  const applicable =
    cycleId === null
      ? isNull(permissionGrant.cycleId)
      : or(isNull(permissionGrant.cycleId), eq(permissionGrant.cycleId, cycleId));

  const grantRows = await db
    .select({
      role: permissionGrant.role,
      scope: permissionGrant.scope,
      teamId: permissionGrant.teamId,
      cycleId: permissionGrant.cycleId,
    })
    .from(permissionGrant)
    .where(and(live, applicable));

  const grants: Grant[] = grantRows.map((row) => ({
    role: row.role,
    scope: row.scope,
    teamId: row.teamId,
    cycleId: row.cycleId,
  }));

  /*
   * The applications assigned to this caller.
   *
   * A team-scoped reviewer grant conveys standing, not content, so this set is
   * the difference between "reviews for Labrador" and "may read these twelve
   * applications". A cancelled assignment is excluded: a director who takes an
   * assignment back has taken the access with it.
   */
  const assignments = await db
    .select({ applicationId: reviewAssignment.applicationId })
    .from(reviewAssignment)
    .where(and(eq(reviewAssignment.reviewerId, user.id), ne(reviewAssignment.status, "cancelled")));

  /*
   * The applications where this caller's **own** review is submitted.
   *
   * The cross-row rule, resolved into an ordinary id set. Two conditions, and
   * both matter:
   *
   * - `reviewerId = caller` — a peer finishing first must not unblind the
   *   application for everybody else. Independent review would mean nothing if
   *   one fast reviewer opened the floodgates.
   * - `status = 'submitted'` — a draft does not unblind. Otherwise opening the
   *   form and typing a single character would reveal every peer's scores,
   *   which is exactly the influence the rule exists to prevent.
   */
  const unblinded = await db
    .select({ applicationId: reviewAssignment.applicationId })
    .from(review)
    /*
     * Joined, because `review` carries neither the application nor the
     * reviewer: it reaches both through its assignment.
     *
     * That is also why the `Review` **rules** cannot compile yet — ADR 0006
     * requires a scoped table to carry the columns its rules are about, and
     * `review` and `review_assignment` do not have theirs. Resolving the set
     * here needs no migration, so this is correct today; the rules it feeds
     * are unit-tested as pure logic and land against SQL with #26 and #28.
     */
    .innerJoin(reviewAssignment, eq(review.assignmentId, reviewAssignment.id))
    .where(and(eq(reviewAssignment.reviewerId, user.id), eq(review.status, "submitted")));

  return {
    ...user,
    cycleId,
    grants,
    assignedApplicationIds: [...new Set(assignments.map((row) => row.applicationId))],
    unblindedApplicationIds: [...new Set(unblinded.map((row) => row.applicationId))],
  };
}
