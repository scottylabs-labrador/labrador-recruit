import { recruitmentCycle } from "@labrador/db/schema";
import { ne } from "drizzle-orm";

import { env } from "../../env.ts";
import { githubService } from "../../services/githubService.ts";
import { db } from "../db.ts";

/**
 * How many applicants to refresh per run.
 *
 * Unauthenticated GitHub allows 60 requests an hour for the whole deployment,
 * and the run is hourly, so this leaves room for the per-applicant refresh
 * button a reviewer might press in the same hour. With 53 Labrador applicants
 * who supplied a link, a first pass takes two runs; after that only stale ones
 * come round again and the budget is barely touched.
 */
const PER_RUN = 40;

const HOUR_MS = 60 * 60 * 1000;

/**
 * Keeps cached GitHub facts fresh without ever fetching during a page render.
 *
 * The budget is the whole design. Fetch-on-view would let a reviewer opening
 * ten applicants spend a sixth of the hour's allowance in one sitting, and the
 * eleventh would see "rate limited" through no fault of their own.
 *
 * Enabled by `GITHUB_ENRICHMENT=on`. Off by default, because fetching an
 * applicant's links at all is an exception to `docs/product-rules.md` §1 and
 * should be switched on deliberately rather than inherited by a deployment
 * that never asked for it.
 *
 * Single replica, like the sheet sync: two would halve each other's budget.
 */
export function startGithubRefreshSchedule(): { stop: () => void } | null {
  if (env.GITHUB_ENRICHMENT !== "on") {
    return null;
  }

  const run = async () => {
    let cycles: Array<{ id: string }>;
    try {
      cycles = await db
        .select({ id: recruitmentCycle.id })
        .from(recruitmentCycle)
        .where(ne(recruitmentCycle.status, "archived"));
    } catch (error) {
      console.error("[github] could not list cycles", error);
      return;
    }

    let budget = PER_RUN;
    for (const cycle of cycles) {
      if (budget <= 0) {
        return;
      }
      try {
        const result = await githubService.refreshDue(cycle.id, budget);
        budget -= result.stored;
        if (result.rateLimited) {
          // Carrying on would collect the same refusal for everybody left and
          // write it over profiles that already hold good data.
          console.log(`[github] hourly limit reached; ${String(result.stored)} refreshed`);
          return;
        }
        if (result.stored > 0) {
          console.log(`[github] cycle ${cycle.id}: refreshed ${String(result.stored)}`);
        }
      } catch (error) {
        console.error(`[github] cycle ${cycle.id} failed`, error);
      }
    }
  };

  const timer = setInterval(() => void run(), HOUR_MS);
  timer.unref?.();

  console.log("[github] refreshing up to 40 applicants an hour");
  return { stop: () => clearInterval(timer) };
}
