import type { MongoAbility } from "@casl/ability";
import { AbilityBuilder, createMongoAbility } from "@casl/ability";

import type { Action, Grant, GrantRole, ScopedUser, Subject } from "./types.ts";

/**
 * The columns rules are written about, across every subject.
 *
 * CASL needs the field shape to type a condition: with a bare string union for
 * subjects it has nothing to merge, so `$in: string[]` narrows to `never[]` and
 * every conditional rule fails to compile. Declaring the attributes once gives
 * the builder real checking — a typo in `teamId` is now a type error rather
 * than a rule that silently matches nothing, which is the worst possible
 * failure here because it fails *open* on a deny-by-default list only when the
 * rule was meant to be the restriction.
 *
 * Every field is a column on some scoped table, and each is in
 * `docs/adr/0006-team-scope-compiles-from-a-denormalized-column.md`'s sense:
 * carried on the row so the rule compiles against it.
 */
export interface SubjectAttributes {
  id?: string;
  /** Null is meaningful: a `Form` with no team is the common form. */
  teamId?: string | null;
  applicationId?: string;
  reviewerId?: string;
  role?: GrantRole;
}

export type AppAbility = MongoAbility<[Action, Subject | SubjectAttributes]>;

/**
 * Whether a grant applies in the cycle being acted in.
 *
 * A grant naming a different cycle conveys nothing: last season's director is
 * not this season's director. `cycle_id` is nullable for grants deliberately
 * independent of any one cycle, and those apply in whichever cycle the caller
 * is acting in.
 */
function appliesToCycle(grant: Grant, cycleId: string | null): boolean {
  return grant.cycleId === null || grant.cycleId === cycleId;
}

/** The teams a caller holds a given role over, in this cycle. */
function teamsFor(user: ScopedUser, role: GrantRole): string[] {
  return user.grants
    .filter(
      (grant) =>
        grant.role === role &&
        grant.scope === "team" &&
        grant.teamId !== null &&
        appliesToCycle(grant, user.cycleId),
    )
    .map((grant) => grant.teamId as string);
}

function hasOrgRole(user: ScopedUser, role: GrantRole): boolean {
  return user.grants.some(
    (grant) =>
      grant.role === role && grant.scope === "organization" && appliesToCycle(grant, user.cycleId),
  );
}

/**
 * The rules for one caller, compiled from their live grants.
 *
 * Pure: no database, no clock, no request. Everything variable — which grants
 * are live, which applications are assigned, which are unblinded — is resolved
 * before this is called and arrives in `ScopedUser`. That is what lets the same
 * rules run in the browser to hide a button and on the server to refuse the
 * request, which is the only reliable way to keep those two agreeing.
 *
 * **Deny by default.** Nothing is allowed that is not written here, and there
 * is no `allow("manage", "all")` for any role — not even an organization admin.
 * Authority over applicant data comes from a grant that says so, and bootstrap
 * authority deliberately is not one. See `docs/authorization.md` sections 5
 * and 7.
 *
 * Team scope is expressed as a condition on `teamId`, which every scoped table
 * carries as a denormalized column guaranteed by a composite foreign key. That
 * decision and its reasoning are [ADR
 * 0006](../../../docs/adr/0006-team-scope-compiles-from-a-denormalized-column.md);
 * the short version is that a rule which only half-compiles moves team scope
 * back into call-site discipline, and the call site that forgets it returns
 * every committee's applications while looking correct.
 */
export function defineAbilityFor(user: ScopedUser): AppAbility {
  const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);

  if (user.role === "guest") {
    // Nothing. An unknown token subject resolves to a guest rather than
    // throwing, so this is a reachable state.
    return build();
  }

  /*
   * Bootstrap, from the identity provider's `groups` claim.
   *
   * Somebody has to create the first cycle and the first grant before any
   * grant exists. This conveys **no authority over applicant data** — see the
   * tests, which assert that explicitly, and section 7.
   */
  if (user.role === "admin") {
    can(["read", "create", "update"], "RecruitmentCycle");
    can(["read", "create", "update"], "Team");
    can(["read", "create", "update"], "RecruitmentOpening");
    can(["read", "grant"], "PermissionGrant");
    can(["read", "create"], "Invitation");
  }

  if (hasOrgRole(user, "org_admin")) {
    can(["read", "create", "update", "delete"], "RecruitmentCycle");
    can(["read", "create", "update", "delete"], "Team");
    can(["read", "create", "update", "delete"], "RecruitmentOpening");

    /*
     * The common form is the organization's, and only the common form.
     *
     * `teamId: null` is what makes a form common — the database enforces it
     * with a check constraint — so this condition is the same statement the
     * schema makes.
     */
    can(["read", "create", "update"], "Form", { teamId: null });
    can(["read", "create", "update", "publish"], "FormVersion");

    // Releasing decisions is the organization's act and nobody else's: it is
    // what turns a recorded outcome into something an applicant can see.
    can("release", "Decision");
    can(["read", "grant"], "PermissionGrant");
    can(["read", "create", "delete"], "Invitation");
    can("export", "RecruitmentCycle");
  }

  const directs = teamsFor(user, "committee_director");
  if (directs.length > 0) {
    can(["read", "create", "update", "publish"], "Form", { teamId: { $in: directs } });
    can(["read", "create", "update", "publish"], "FormVersion", { teamId: { $in: directs } });
    can(["read", "update"], "Application", { teamId: { $in: directs } });
    can("read", "CandidateProfile", { teamId: { $in: directs } });
    can(["read", "create", "update"], "Rubric", { teamId: { $in: directs } });
    can(["read", "create", "update", "assign", "delete"], "ReviewAssignment", {
      teamId: { $in: directs },
    });

    /*
     * Directors are never blinded.
     *
     * They hold aggregate visibility over their committee, which is what the
     * job is — comparing applicants is the task. Section 4 says so, and the
     * absence of any `unblindedApplicationIds` condition here is the
     * implementation of it.
     */
    can(["read", "readPeerReview"], "Review", { teamId: { $in: directs } });
    can(["read", "update"], "Decision", { teamId: { $in: directs } });
    can("export", "Application", { teamId: { $in: directs } });
    can("read", "File", { teamId: { $in: directs } });

    /*
     * Helpers only, and never a director.
     *
     * A director appointing a director — including a successor — would make
     * the organization admin's authority unenforceable, so the role is in the
     * condition. Section 5 states this as an explicit prohibition.
     */
    can("grant", "PermissionGrant", {
      teamId: { $in: directs },
      role: { $in: ["question_editor", "reviewer"] },
    });
    can("create", "Invitation", {
      teamId: { $in: directs },
      role: { $in: ["question_editor", "reviewer"] },
    });
  }

  const edits = teamsFor(user, "question_editor");
  if (edits.length > 0) {
    /*
     * The narrowest grant in the model: the questions, and nothing else.
     *
     * No `publish` — a published version is what applicants answer against and
     * cannot be withdrawn, so it is a director's act. And no `Application`,
     * no `CandidateProfile`, no `Review`: somebody who writes the questions
     * has no business reading the answers, and nothing in the role requires
     * it. This is the grant most likely to be widened by accident.
     */
    can(["read", "create", "update"], "Form", { teamId: { $in: edits } });
    can(["read", "create", "update"], "FormVersion", { teamId: { $in: edits } });
    can("read", "Rubric", { teamId: { $in: edits } });
  }

  const reviews = teamsFor(user, "reviewer");
  if (reviews.length > 0) {
    can("read", "Rubric", { teamId: { $in: reviews } });

    /*
     * **Standing is not content.** Both conditions, not either.
     *
     * A team-scoped reviewer grant says this person reviews for this
     * committee. It does not say which applications, and without an
     * assignment the answer is none — not a filtered list, not an anonymized
     * one. This is the row of section 2's table that gets implemented wrongly.
     *
     * The team condition is kept alongside the assignment condition on
     * purpose: assignment ids are per caller rather than per team, so a stale
     * or mistaken assignment row would otherwise reach across committees.
     */
    can("read", "Application", {
      teamId: { $in: reviews },
      id: { $in: [...user.assignedApplicationIds] },
    });
    can("read", "CandidateProfile", {
      teamId: { $in: reviews },
      applicationId: { $in: [...user.assignedApplicationIds] },
    });
    can("read", "File", {
      teamId: { $in: reviews },
      applicationId: { $in: [...user.assignedApplicationIds] },
    });

    // Their own review, which they may always read and write — a draft is
    // theirs before it is anybody's.
    can(["read", "create", "update"], "Review", {
      teamId: { $in: reviews },
      reviewerId: user.id,
    });

    /*
     * A peer's review, only on an application this caller has submitted on.
     *
     * The cross-row rule, as an ordinary `$in`. Whether somebody may read a
     * peer's scores depends on the state of a *different* row — their own
     * review of the same application — which no column comparison can express.
     * One extra query per request turns it into a condition that compiles
     * alongside everything else. Only a **submitted** review unblinds; the
     * resolver that builds this set is where that is enforced.
     */
    can("readPeerReview", "Review", {
      teamId: { $in: reviews },
      applicationId: { $in: [...user.unblindedApplicationIds] },
    });
  }

  return build();
}
