import { recruitmentCycle, recruitmentOpening, team } from "@recruit/db/schema";
import { and, asc, eq } from "drizzle-orm";

import {
  catalogueOpeningWhere,
  currentCycleOrder,
  hasOpened,
  visibleCycleWhere,
} from "../lib/cycleVisibility.ts";
import { db } from "../lib/db.ts";
import { NotFoundError } from "../middlewares/errorHandler.ts";

/**
 * What the landing page says about the current cycle.
 *
 * Deliberately thin. This is served to anybody, so it carries only what a
 * poster on a wall could say — no counts, no applicant data, nothing about a
 * cycle that has not been announced.
 */
export interface CurrentCycle {
  slug: string;
  name: string;
  description: string | null;
  timeZone: string;
  opensAt: string | null;
  closesAt: string | null;
  maxCommitteesPerApplicant: number | null;
  requirePreferenceRanking: boolean;
}

export interface PublicOpening {
  openingId: string;
  teamSlug: string;
  teamName: string;
  description: string | null;
  /**
   * Whether somebody can apply right now.
   *
   * A committee that has not opened is still listed, with its date. A button
   * leading to a closed form is worse than no button, and omitting the
   * committee entirely would make somebody think it is not recruiting at all.
   */
  accepting: boolean;
  opensAt: string | null;
  closesAt: string | null;
}

export const catalogueService = {
  /**
   * The cycle an applicant is being invited to apply to.
   *
   * 404 when there is none, saying nothing about a draft that exists. A draft
   * cycle is not announced, and its name and dates are not public.
   */
  getCurrentCycle: async (): Promise<CurrentCycle> => {
    const now = new Date();
    const [cycle] = await db
      .select()
      .from(recruitmentCycle)
      .where(visibleCycleWhere(now))
      .orderBy(currentCycleOrder)
      .limit(1);

    if (!cycle) {
      throw new NotFoundError("There is no recruitment cycle at the moment.");
    }

    return {
      slug: cycle.slug,
      name: cycle.name,
      description: cycle.description,
      timeZone: cycle.timeZone,
      opensAt: cycle.opensAt?.toISOString() ?? null,
      closesAt: cycle.closesAt?.toISOString() ?? null,
      maxCommitteesPerApplicant: cycle.maxCommitteesPerApplicant,
      requirePreferenceRanking: cycle.requirePreferenceRanking,
    };
  },

  /**
   * The committees recruiting in the current cycle.
   *
   * An **empty list** when no cycle is open, not a 404. The landing page
   * renders "nothing is recruiting" from this, and a 404 would make it render
   * an error for an entirely ordinary state.
   */
  listOpenings: async (): Promise<PublicOpening[]> => {
    const now = new Date();
    const [cycle] = await db
      .select({ id: recruitmentCycle.id })
      .from(recruitmentCycle)
      .where(visibleCycleWhere(now))
      .orderBy(currentCycleOrder)
      .limit(1);

    if (!cycle) {
      return [];
    }

    const rows = await db
      .select({
        openingId: recruitmentOpening.id,
        teamSlug: team.slug,
        teamName: team.name,
        description: team.description,
        status: recruitmentOpening.status,
        opensAt: recruitmentOpening.opensAt,
        closesAt: recruitmentOpening.closesAt,
      })
      .from(recruitmentOpening)
      .innerJoin(team, eq(recruitmentOpening.teamId, team.id))
      .where(
        and(
          eq(recruitmentOpening.cycleId, cycle.id),
          /*
           * Excludes drafts only.
           *
           * A draft opening is a director still deciding, and publishing it
           * would announce a committee's intentions before they have. But a
           * committee that opens next week *is* listed, with its date — see
           * `catalogueOpeningWhere` for why that differs from form visibility.
           */
          catalogueOpeningWhere(),
          eq(team.active, true),
        ),
      )
      .orderBy(asc(team.displayOrder), asc(team.name));

    return rows.map((row) => ({
      openingId: row.openingId,
      teamSlug: row.teamSlug,
      teamName: row.teamName,
      description: row.description,
      accepting:
        row.status === "open" &&
        hasOpened(row.opensAt, now) &&
        (row.closesAt === null || row.closesAt > now),
      opensAt: row.opensAt?.toISOString() ?? null,
      closesAt: row.closesAt?.toISOString() ?? null,
    }));
  },
};
