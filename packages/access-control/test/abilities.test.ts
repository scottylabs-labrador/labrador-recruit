/**
 * The ability builder.
 *
 * Authorization is the entire security boundary here: the Keycloak realm has no
 * login form, so every Andrew ID at CMU authenticates and a valid session
 * proves only that the caller is some CMU person. These tests are therefore
 * mostly **negative**, and they are organised around the worked-example table
 * in `docs/authorization.md` section 2 — the cases that table exists because
 * people get wrong.
 *
 * The one to read first is "a reviewer with a grant and no assignments sees
 * nothing". A team-scoped reviewer grant conveys standing, not content.
 */
import { subject } from "@casl/ability";
import { describe, expect, it } from "vitest";

import { defineAbilityFor } from "../src/abilities.ts";
import type { Grant, ScopedUser, Subject } from "../src/types.ts";

const CYCLE = "cycle-1";
const LABRADOR = "team-labrador";
const DESIGN = "team-design";

function scoped(over: Partial<ScopedUser> = {}): ScopedUser {
  return {
    id: "someone",
    role: "user",
    cycleId: CYCLE,
    grants: [],
    assignedApplicationIds: [],
    unblindedApplicationIds: [],
    ...over,
  };
}

/**
 * Tags a plain object with its subject type.
 *
 * CASL's third `can` argument is a *field name*, not a subject - passing an
 * object there throws rather than evaluating the condition, so every
 * conditional assertion needs a tagged instance. Worth a helper: the mistake
 * is easy to make and it fails loudly rather than silently passing.
 */
function on(type: Subject, attributes: Record<string, unknown>) {
  return subject(type, attributes as never);
}

function grant(role: Grant["role"], teamId: string | null = LABRADOR): Grant {
  return {
    role,
    scope: teamId === null ? "organization" : "team",
    teamId,
    cycleId: role === "org_admin" ? null : CYCLE,
  };
}

describe("a CMU person with no grants", () => {
  const ability = defineAbilityFor(scoped());

  it("may not read an application", () => {
    // Gate 1 passes and gate 2 does not. This is every CMU student, which is
    // the default state of the entire university.
    expect(ability.can("read", "Application")).toBe(false);
  });

  it("may not read a form version, a review, or a grant", () => {
    expect(ability.can("read", "FormVersion")).toBe(false);
    expect(ability.can("read", "Review")).toBe(false);
    expect(ability.can("read", "PermissionGrant")).toBe(false);
  });

  it("may not create anything", () => {
    for (const subject of ["RecruitmentCycle", "Team", "Form", "Application"] as const) {
      expect(ability.can("create", subject)).toBe(false);
    }
  });
});

describe("the Keycloak admin group, with no grant", () => {
  /*
   * The row of the table most likely to be implemented wrongly.
   *
   * `role: "admin"` comes from the identity provider's `groups` claim and
   * exists to bootstrap: somebody has to create the first cycle and the first
   * grants before any grant exists. It conveys **no authority over applicant
   * data**, which is the whole reason authority lives in `permission_grant`.
   */
  const ability = defineAbilityFor(scoped({ role: "admin" }));

  it("may create a cycle and a team, so the platform can be set up at all", () => {
    expect(ability.can("create", "RecruitmentCycle")).toBe(true);
    expect(ability.can("create", "Team")).toBe(true);
    expect(ability.can("grant", "PermissionGrant")).toBe(true);
  });

  it("may not read an application", () => {
    // `docs/authorization.md` section 7: bootstrap authority is not applicant
    // access. An administrator who wants to read essays grants themselves a
    // role that says so, and that grant is audited.
    expect(ability.can("read", "Application")).toBe(false);
  });

  it("may not read a review or a candidate profile", () => {
    expect(ability.can("read", "Review")).toBe(false);
    expect(ability.can("read", "CandidateProfile")).toBe(false);
  });
});

describe("an organization admin", () => {
  const ability = defineAbilityFor(scoped({ grants: [grant("org_admin", null)] }));

  it("runs the cycle: cycles, teams, openings", () => {
    expect(ability.can("create", "RecruitmentCycle")).toBe(true);
    expect(ability.can("update", "RecruitmentCycle")).toBe(true);
    expect(ability.can("create", "RecruitmentOpening")).toBe(true);
  });

  it("owns the common form", () => {
    expect(ability.can("update", on("Form", { teamId: null }))).toBe(true);
    expect(ability.can("publish", "FormVersion")).toBe(true);
  });

  it("releases decisions, which nobody else may do", () => {
    expect(ability.can("release", "Decision")).toBe(true);
  });

  it("appoints directors", () => {
    expect(ability.can("grant", "PermissionGrant")).toBe(true);
  });

  it("still may not read applicant data", () => {
    /*
     * The same rule as the admin group, and for the same reason. Running a
     * recruitment cycle is not reading the applications in it, and
     * `docs/authorization.md` section 5 says so explicitly: an org admin needs
     * a grant that says so.
     */
    expect(ability.can("read", "Application")).toBe(false);
    expect(ability.can("read", "Review")).toBe(false);
  });
});

describe("a committee director", () => {
  const ability = defineAbilityFor(scoped({ grants: [grant("committee_director")] }));

  it("reads their own committee's applications", () => {
    expect(ability.can("read", on("Application", { teamId: LABRADOR }))).toBe(true);
  });

  it("cannot read another committee's applications", () => {
    // The 404 row of the table. A Design director probing a Labrador id learns
    // nothing, because the predicate never matches the row.
    expect(ability.can("read", on("Application", { teamId: DESIGN }))).toBe(false);
  });

  it("publishes their own committee's form and not another's", () => {
    expect(ability.can("publish", on("FormVersion", { teamId: LABRADOR }))).toBe(true);
    expect(ability.can("publish", on("FormVersion", { teamId: DESIGN }))).toBe(false);
  });

  it("assigns reviewers within their own committee", () => {
    expect(ability.can("assign", on("ReviewAssignment", { teamId: LABRADOR }))).toBe(true);
    expect(ability.can("assign", on("ReviewAssignment", { teamId: DESIGN }))).toBe(false);
  });

  it("reads every review on their own committee, never blinded", () => {
    /*
     * Directors hold aggregate visibility, so independent review does not
     * blind them — `docs/authorization.md` section 4. Note there is no
     * `unblindedApplicationIds` in this caller's context at all: being a
     * director is sufficient.
     */
    expect(ability.can("read", on("Review", { teamId: LABRADOR }))).toBe(true);
    expect(ability.can("readPeerReview", on("Review", { teamId: LABRADOR }))).toBe(true);
  });

  it("may not appoint a director, including their own successor", () => {
    // Stated as an explicit prohibition in section 5. Letting a director
    // appoint a director makes the org admin's authority unenforceable.
    expect(ability.can("grant", on("PermissionGrant", { role: "committee_director" }))).toBe(false);
  });

  it("may appoint their own helpers", () => {
    expect(
      ability.can("grant", on("PermissionGrant", { role: "reviewer", teamId: LABRADOR })),
    ).toBe(true);
    expect(
      ability.can("grant", on("PermissionGrant", { role: "question_editor", teamId: LABRADOR })),
    ).toBe(true);
  });

  it("may not appoint a helper on another committee", () => {
    expect(ability.can("grant", on("PermissionGrant", { role: "reviewer", teamId: DESIGN }))).toBe(
      false,
    );
  });

  it("may not touch a cycle or release decisions", () => {
    expect(ability.can("update", "RecruitmentCycle")).toBe(false);
    expect(ability.can("release", "Decision")).toBe(false);
  });
});

describe("a question editor", () => {
  const ability = defineAbilityFor(scoped({ grants: [grant("question_editor")] }));

  it("reads and edits their committee's form", () => {
    expect(ability.can("read", on("Form", { teamId: LABRADOR }))).toBe(true);
    expect(ability.can("update", on("FormVersion", { teamId: LABRADOR }))).toBe(true);
  });

  it("may not publish a version", () => {
    /*
     * The narrowest grant in the model, and the one most likely to be widened
     * by accident. Publishing is irreversible — a published version is what
     * applicants answer against — so it is a director's act.
     */
    expect(ability.can("publish", on("FormVersion", { teamId: LABRADOR }))).toBe(false);
  });

  it("may never read an application or a review", () => {
    // Somebody who writes the questions has no business reading the answers,
    // and nothing in this role's purpose requires it.
    expect(ability.can("read", on("Application", { teamId: LABRADOR }))).toBe(false);
    expect(ability.can("read", on("Review", { teamId: LABRADOR }))).toBe(false);
    expect(ability.can("read", "CandidateProfile")).toBe(false);
  });

  it("may not edit another committee's form", () => {
    expect(ability.can("update", on("FormVersion", { teamId: DESIGN }))).toBe(false);
  });
});

describe("a reviewer with a grant and no assignments", () => {
  /*
   * **The row people get wrong.**
   *
   * A team-scoped reviewer grant conveys standing, not content. Without an
   * assignment this caller sees no applications whatsoever — not a filtered
   * list, not an anonymized one. Nothing.
   */
  const ability = defineAbilityFor(scoped({ grants: [grant("reviewer")] }));

  it("sees no applications at all", () => {
    expect(ability.can("read", on("Application", { teamId: LABRADOR, id: "app-1" }))).toBe(false);
  });

  it("sees no reviews", () => {
    expect(ability.can("read", on("Review", { teamId: LABRADOR, applicationId: "app-1" }))).toBe(
      false,
    );
  });
});

describe("a reviewer with assignments", () => {
  const ability = defineAbilityFor(
    scoped({
      id: "lhaddad",
      grants: [grant("reviewer")],
      assignedApplicationIds: ["app-1", "app-2"],
    }),
  );

  it("reads the applications assigned to them", () => {
    expect(ability.can("read", on("Application", { teamId: LABRADOR, id: "app-1" }))).toBe(true);
  });

  it("does not read an application on their own committee that is not assigned", () => {
    // Being on the committee is not enough, which is the entire point of the
    // assignment gate.
    expect(ability.can("read", on("Application", { teamId: LABRADOR, id: "app-99" }))).toBe(false);
  });

  it("does not read an assigned application if it belongs to another committee", () => {
    /*
     * Both conditions, not either. An assignment id set is per caller and not
     * per team, so without the team condition a stale or mistaken assignment
     * row would reach across committees.
     */
    expect(ability.can("read", on("Application", { teamId: DESIGN, id: "app-1" }))).toBe(false);
  });

  it("writes its own review and no one else's", () => {
    expect(ability.can("update", on("Review", { teamId: LABRADOR, reviewerId: "lhaddad" }))).toBe(
      true,
    );
    expect(ability.can("update", on("Review", { teamId: LABRADOR, reviewerId: "osorensen" }))).toBe(
      false,
    );
  });

  it("reads its own review even before submitting", () => {
    expect(ability.can("read", on("Review", { teamId: LABRADOR, reviewerId: "lhaddad" }))).toBe(
      true,
    );
  });
});

describe("independent review, the cross-row rule", () => {
  const blinded = defineAbilityFor(
    scoped({
      id: "lhaddad",
      grants: [grant("reviewer")],
      assignedApplicationIds: ["app-1"],
      unblindedApplicationIds: [],
    }),
  );

  const unblinded = defineAbilityFor(
    scoped({
      id: "lhaddad",
      grants: [grant("reviewer")],
      assignedApplicationIds: ["app-1"],
      unblindedApplicationIds: ["app-1"],
    }),
  );

  it("hides a peer's review until the caller has submitted their own", () => {
    /*
     * The rule this platform's credibility rests on: a reviewer must not see
     * another reviewer's scores, recommendation or comments before submitting
     * their own. Only a **submitted** review unblinds — a draft does not, and
     * the context that builds `unblindedApplicationIds` is where that is
     * enforced.
     */
    expect(
      blinded.can(
        "readPeerReview",
        on("Review", {
          teamId: LABRADOR,
          applicationId: "app-1",
          reviewerId: "osorensen",
        }),
      ),
    ).toBe(false);
  });

  it("shows a peer's review once the caller has submitted", () => {
    expect(
      unblinded.can(
        "readPeerReview",
        on("Review", {
          teamId: LABRADOR,
          applicationId: "app-1",
          reviewerId: "osorensen",
        }),
      ),
    ).toBe(true);
  });

  it("unblinds only the application the caller submitted on", () => {
    // Submitting one review does not open the rest of the committee's.
    expect(
      unblinded.can(
        "readPeerReview",
        on("Review", {
          teamId: LABRADOR,
          applicationId: "app-2",
          reviewerId: "osorensen",
        }),
      ),
    ).toBe(false);
  });
});

describe("two grants on one caller", () => {
  const ability = defineAbilityFor(
    scoped({
      grants: [grant("committee_director", LABRADOR), grant("reviewer", DESIGN)],
      assignedApplicationIds: ["app-design-1"],
    }),
  );

  it("gives each team exactly the authority its own grant conveys", () => {
    // Director on Labrador: every application. Reviewer on Design: only the
    // assigned one. Holding both must not let either widen the other.
    expect(ability.can("read", on("Application", { teamId: LABRADOR, id: "app-lab-9" }))).toBe(
      true,
    );
    expect(ability.can("read", on("Application", { teamId: DESIGN, id: "app-design-1" }))).toBe(
      true,
    );
    expect(ability.can("read", on("Application", { teamId: DESIGN, id: "app-design-2" }))).toBe(
      false,
    );
  });

  it("does not let the reviewer grant publish Design's form", () => {
    expect(ability.can("publish", on("FormVersion", { teamId: DESIGN }))).toBe(false);
    expect(ability.can("publish", on("FormVersion", { teamId: LABRADOR }))).toBe(true);
  });
});

describe("a grant from another cycle", () => {
  it("conveys nothing in this one", () => {
    /*
     * Last season's director is not this season's director. The context
     * resolves grants for the cycle being acted in, and a grant naming a
     * different cycle is not in that set — asserted here so that a future
     * change to the resolver cannot quietly widen it.
     */
    const ability = defineAbilityFor(
      scoped({
        cycleId: CYCLE,
        grants: [{ role: "committee_director", scope: "team", teamId: LABRADOR, cycleId: "old" }],
      }),
    );

    expect(ability.can("read", on("Application", { teamId: LABRADOR }))).toBe(false);
    expect(ability.can("publish", on("FormVersion", { teamId: LABRADOR }))).toBe(false);
  });

  it("still conveys authority when the grant names no cycle at all", () => {
    // A cycle-independent grant is deliberate — `permission_grant.cycle_id` is
    // nullable for exactly this — and applies in whichever cycle is being
    // acted in.
    const ability = defineAbilityFor(
      scoped({
        cycleId: CYCLE,
        grants: [{ role: "committee_director", scope: "team", teamId: LABRADOR, cycleId: null }],
      }),
    );

    expect(ability.can("read", on("Application", { teamId: LABRADOR }))).toBe(true);
  });
});

describe("a guest", () => {
  it("can do nothing at all", () => {
    const ability = defineAbilityFor(scoped({ role: "guest" }));

    // An unknown token subject resolves to a guest rather than throwing, so
    // this is a reachable state and not a theoretical one.
    for (const subject of ["Application", "Form", "Review", "RecruitmentCycle"] as const) {
      expect(ability.can("read", subject)).toBe(false);
      expect(ability.can("update", subject)).toBe(false);
    }
  });
});
