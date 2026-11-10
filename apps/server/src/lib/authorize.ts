import type { Action, AppAbility, Subject, SubjectAttributes } from "@recruit/access-control";
import { defineAbilityFor, forSubject } from "@recruit/access-control";
import type { Request as ExpressRequest } from "express";

import { NotFoundError } from "../middlewares/errorHandler.ts";
import { getAcUserFromRequest } from "./accessControl.ts";
import { resolveScopedUser } from "./scopedUser.ts";

/**
 * The caller's ability, for the cycle they are acting in.
 *
 * Three steps every staff route takes, in one place so none of them can take
 * two: identify the caller, resolve their **live** grants for that cycle, and
 * compile the rules. Nothing is cached between requests — see
 * `scopedUser.ts` for why that is a requirement rather than an oversight.
 */
export async function getAbilityFor(
  req: ExpressRequest,
  cycleId: string | null,
): Promise<AppAbility> {
  const user = await getAcUserFromRequest(req);
  const scoped = await resolveScopedUser(user, cycleId);
  return defineAbilityFor(scoped);
}

/**
 * Refuses unless the caller may take this action on this row — with **404**.
 *
 * Never 403. A Design director probing a Labrador form id must learn nothing
 * about whether it exists, so "you may not" and "there is no such thing" are
 * the same answer. `docs/authorization.md` section 3 states this as a
 * consequence of the design rather than a nicety, and the one place it is easy
 * to lose is a hand-written check at a call site — which is why this helper
 * exists and why no route should be writing `if (!ability.can(...)) throw` of
 * its own.
 *
 * The attributes passed in are the row's own columns. They are what the rule
 * compiles against, so a row reached any other way is a row whose authority
 * nobody checked.
 */
export function assertCan(
  ability: AppAbility,
  action: Action,
  subjectName: Subject,
  attributes: SubjectAttributes,
): void {
  if (!ability.can(action, forSubject(subjectName, attributes) as never)) {
    throw new NotFoundError();
  }
}
