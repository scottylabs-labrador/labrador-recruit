import { recruitmentCycle, recruitmentOpening } from "@recruit/db/schema";
import type { SQL } from "drizzle-orm";
import { and, inArray, isNull, lte, or, sql } from "drizzle-orm";

/**
 * Which cycle an applicant may see, in one place.
 *
 * Extracted because the rule was about to live in two services, and two copies
 * of a visibility rule are two places for it to drift — on the question of
 * which recruitment season somebody is applying to, and therefore which
 * applications and answers are theirs.
 *
 * TODO(track-b): #14 owns the cycle lifecycle. If that workstream wants this
 * rule, it moves — it is here because the applicant surface needed it first,
 * not because it belongs to Track A by right.
 */

/**
 * Cycle statuses an applicant may know about at all.
 *
 * `draft` and `scheduled` are excluded. A draft is not announced, so its very
 * existence — let alone its name and dates — is not an applicant's to know.
 * `scheduled` is announced internally but has not opened.
 *
 * Everything from `open` onwards is included: a closed or archived cycle stays
 * visible so a submitted application remains legible beside the questions it
 * was answering.
 */
export const APPLICANT_VISIBLE_CYCLE_STATUSES = [
  "open",
  "closed",
  "reviewing",
  "decisions_released",
  "archived",
] as const;

/** Opening statuses an applicant may know about. */
export const APPLICANT_VISIBLE_OPENING_STATUSES = ["open", "closed"] as const;

/**
 * Whether a window has started.
 *
 * An unset `opensAt` means "no gate beyond the status", which is the common
 * case. A set one is authoritative: a director who marks something open and
 * dates it next week means next week, and trusting the status alone would
 * publish early.
 *
 * `closesAt` deliberately has no equivalent here. A passed deadline stops
 * submissions, not reading — somebody who applied needs the questions to stay
 * legible beside their answers.
 *
 * The comparison is direct because these columns are `timestamptz`. A cycle's
 * `time_zone` is for displaying a deadline and for interpreting one a director
 * typed, not for deciding whether it has passed.
 */
export function hasOpened(opensAt: Date | null, now: Date): boolean {
  return opensAt === null || opensAt <= now;
}

/** Predicate selecting cycles an applicant may see, for use in a query. */
export function visibleCycleWhere(now: Date): SQL | undefined {
  return and(
    inArray(recruitmentCycle.status, [...APPLICANT_VISIBLE_CYCLE_STATUSES]),
    or(isNull(recruitmentCycle.opensAt), lte(recruitmentCycle.opensAt, now)),
  );
}

/**
 * Predicate selecting openings that belong in the public catalogue.
 *
 * Deliberately **not** the same as `visibleOpeningWhere`, and the difference
 * matters. Reading a committee's *form* before it opens would disclose its
 * questions early, so that is gated on the window. Appearing in the catalogue
 * is the opposite: a committee opening next week should be listed with its
 * date, because omitting it makes somebody think it is not recruiting at all,
 * and showing an Apply button that leads to a closed form is worse than showing
 * neither.
 *
 * So this gates on status only, and the caller reports whether applications are
 * actually open as a separate flag.
 */
export function catalogueOpeningWhere(): SQL | undefined {
  return inArray(recruitmentOpening.status, [...APPLICANT_VISIBLE_OPENING_STATUSES]);
}

/** Predicate selecting openings whose form an applicant may read. */
export function visibleOpeningWhere(now: Date): SQL | undefined {
  return and(
    inArray(recruitmentOpening.status, [...APPLICANT_VISIBLE_OPENING_STATUSES]),
    or(isNull(recruitmentOpening.opensAt), lte(recruitmentOpening.opensAt, now)),
  );
}

/**
 * Ordering for "the current cycle": most recently opened first.
 *
 * `NULLS LAST` is the point. Postgres puts NULLs **first** under `DESC`, so the
 * default ordering made a cycle with no opening date win over every real one —
 * and a freshly created draft cycle is exactly that. An organization admin
 * setting up next season would have silently moved every current applicant onto
 * it.
 *
 * The status filter in `visibleCycleWhere` already excludes drafts, so this is
 * belt and braces; it stays because the failure it prevents is silent and the
 * cost is a clause.
 */
export const currentCycleOrder = sql`${recruitmentCycle.opensAt} DESC NULLS LAST`;
