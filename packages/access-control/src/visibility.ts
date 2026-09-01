import { and, type SQL } from "drizzle-orm";
import type { PgTableWithColumns, TableConfig } from "drizzle-orm/pg-core";

import { getRecruitmentAbility } from "./abac.ts";
import { drizzleWhere } from "./drizzle.ts";
import type { RecruitmentUser } from "./types.ts";

/**
 * Composed row-visibility predicates.
 *
 * A review's visibility depends on two tables at once: `review_assignment`
 * decides whose review it is, and `committee_candidacy` decides which committee
 * it belongs to. Compiling only one of those is a privilege escalation — a
 * committee lead's rule carries no assignment condition, so on its own it
 * yields no filter at all.
 *
 * These helpers exist so a service cannot express half the rule by accident.
 * Always prefer them over calling `drizzleWhere` directly for these subjects.
 */

/** Restricts candidacies to the committees the caller may see. */
export function candidacyVisibilityWhere<T extends TableConfig>(
  user: RecruitmentUser,
  candidacyTable: PgTableWithColumns<T>,
): SQL | undefined {
  return drizzleWhere(getRecruitmentAbility(user), "read", "Candidacy", candidacyTable);
}

/**
 * Restricts assignments to those the caller may see, scoped both by reviewer
 * and by committee. Pass the joined `review_assignment` and
 * `committee_candidacy` tables.
 */
export function assignmentVisibilityWhere<A extends TableConfig, C extends TableConfig>(
  user: RecruitmentUser,
  assignmentTable: PgTableWithColumns<A>,
  candidacyTable: PgTableWithColumns<C>,
): SQL | undefined {
  const ability = getRecruitmentAbility(user);
  return and(
    drizzleWhere(ability, "read", "Assignment", assignmentTable),
    drizzleWhere(ability, "read", "Candidacy", candidacyTable),
  );
}

/**
 * Restricts reviews to those the caller may see.
 *
 * For an ordinary reviewer this resolves to "my own review, plus every review
 * of a candidacy where I have already submitted mine" — which is precisely the
 * independent-review rule, enforced in SQL rather than by hiding rows later.
 */
export function reviewVisibilityWhere<A extends TableConfig, C extends TableConfig>(
  user: RecruitmentUser,
  assignmentTable: PgTableWithColumns<A>,
  candidacyTable: PgTableWithColumns<C>,
): SQL | undefined {
  const ability = getRecruitmentAbility(user);
  return and(
    drizzleWhere(ability, "read", "Review", assignmentTable),
    drizzleWhere(ability, "read", "Candidacy", candidacyTable),
  );
}
