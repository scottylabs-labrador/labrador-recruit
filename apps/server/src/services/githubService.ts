import type { RecruitmentUser } from "@labrador/access-control";
import {
  applicantGithubProfile,
  application,
  applicationAnswer,
  questionDefinition,
} from "@labrador/db/schema";
import { and, eq, isNull, or, sql } from "drizzle-orm";

import { env } from "../env.ts";
import { db } from "../lib/db.ts";
import {
  fetchRepos,
  type GithubFetchResult,
  type GithubRepo,
  githubUsername,
} from "../lib/github/githubProfile.ts";
import { HttpError } from "../middlewares/errorHandler.ts";
import { visibleApplicationWhere } from "./applicantService.ts";

/** The imported question holding the applicant's own GitHub link. */
const LINK_KEY = "labrador_github_link";

/** How old a cached profile may be before it is worth asking again. */
const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export interface GithubProfileView {
  username: string;
  repos: GithubRepo[];
  error: string | null;
  fetchedAt: Date | null;
}

/**
 * Refuses an application the caller cannot already read.
 *
 * The same predicate the application detail uses, imported rather than
 * restated: a second copy of a visibility rule is a second place for it to
 * drift, and this one decides who sees an applicant's work.
 *
 * A caller with standing but no path to this application gets "not found"
 * rather than "forbidden", matching the detail endpoint: naming an application
 * they cannot open would tell them it exists. A caller with no recruitment
 * standing at all is refused earlier still, by the ability itself.
 */
async function assertVisible(acUser: RecruitmentUser, applicationId: string): Promise<void> {
  const [row] = await db
    .select({ cycleId: application.cycleId })
    .from(application)
    .where(eq(application.id, applicationId));

  if (!row) {
    throw new HttpError(404, "Application not found");
  }

  const [visible] = await db
    .select({ id: application.id })
    .from(application)
    .where(and(eq(application.id, applicationId), visibleApplicationWhere(acUser, row.cycleId)));

  if (!visible) {
    throw new HttpError(404, "Application not found");
  }
}

export const githubService = {
  /**
   * The cached profile for one application, or null when there is nothing.
   *
   * A read, always. Nothing here contacts GitHub, because this runs while a
   * reviewer's page is being assembled and the unauthenticated budget is 60
   * requests an hour for the whole deployment.
   */
  getProfile: async (
    acUser: RecruitmentUser,
    applicationId: string,
  ): Promise<GithubProfileView | null> => {
    await assertVisible(acUser, applicationId);

    const [row] = await db
      .select()
      .from(applicantGithubProfile)
      .where(eq(applicantGithubProfile.applicationId, applicationId));

    if (!row) {
      return null;
    }

    return {
      username: row.username,
      repos: (row.repos ?? []) as GithubRepo[],
      error: row.error,
      fetchedAt: row.fetchedAt,
    };
  },

  /**
   * Applications with a usable GitHub link that are worth fetching.
   *
   * Never fetched, or fetched long enough ago to be stale. Ordered oldest
   * first so a bounded run works through everybody rather than repeatedly
   * refreshing whoever happens to sort first.
   */
  listDue: async (
    cycleId: string,
    limit: number,
    now: Date = new Date(),
  ): Promise<Array<{ applicationId: string; username: string }>> => {
    const staleBefore = new Date(now.getTime() - STALE_AFTER_MS);

    const rows = await db
      .select({
        applicationId: application.id,
        link: applicationAnswer.answerText,
        fetchedAt: applicantGithubProfile.fetchedAt,
      })
      .from(applicationAnswer)
      .innerJoin(
        questionDefinition,
        eq(applicationAnswer.questionDefinitionId, questionDefinition.id),
      )
      .innerJoin(application, eq(applicationAnswer.applicationId, application.id))
      .leftJoin(applicantGithubProfile, eq(applicantGithubProfile.applicationId, application.id))
      .where(
        and(
          eq(application.cycleId, cycleId),
          eq(questionDefinition.key, LINK_KEY),
          or(
            isNull(applicantGithubProfile.fetchedAt),
            sql`${applicantGithubProfile.fetchedAt} < ${staleBefore}`,
          ),
        ),
      )
      .orderBy(sql`${applicantGithubProfile.fetchedAt} asc nulls first`)
      .limit(limit);

    return rows.flatMap((row) => {
      const username = githubUsername(row.link);
      // Somebody who wrote "n/a", or linked a portfolio instead, simply has no
      // GitHub data. That is not a failure and is not worth a stored row.
      return username === null ? [] : [{ applicationId: row.applicationId, username }];
    });
  },

  /** Stores whatever the fetch produced, success or reason. */
  record: async (
    applicationId: string,
    username: string,
    result: GithubFetchResult,
    now: Date = new Date(),
  ): Promise<void> => {
    const values = result.ok
      ? { repos: result.repos, error: null, httpStatus: null }
      : { repos: null, error: result.error, httpStatus: result.httpStatus };

    await db
      .insert(applicantGithubProfile)
      .values({
        applicationId,
        username,
        ...values,
        fetchedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: applicantGithubProfile.applicationId,
        set: { username, ...values, fetchedAt: now, updatedAt: now },
      });
  },

  /**
   * Refreshes up to `limit` applications, stopping the moment GitHub says the
   * hourly budget is gone.
   *
   * Stopping matters more than finishing: continuing would spend the next hour
   * collecting the same refusal for every remaining applicant, and would write
   * "rate limited" over profiles that already hold good data.
   */
  refreshDue: async (
    cycleId: string,
    limit: number,
  ): Promise<{ attempted: number; stored: number; rateLimited: boolean }> => {
    const due = await githubService.listDue(cycleId, limit);

    let stored = 0;
    for (const [index, entry] of due.entries()) {
      const result = await fetchRepos(entry.username);

      if (!result.ok && result.rateLimited) {
        return { attempted: index, stored, rateLimited: true };
      }

      await githubService.record(entry.applicationId, entry.username, result);
      stored += 1;
    }

    return { attempted: due.length, stored, rateLimited: false };
  },

  /**
   * Refreshes one application now, for the button beside a reviewer's page.
   *
   * Refuses when enrichment is off. The switch means "this deployment does not
   * fetch applicant links", and an endpoint that fetched anyway would leave
   * that promise true only for the scheduled pass - which is not the promise
   * `docs/product-rules.md` §1 makes.
   */
  refreshOne: async (
    acUser: RecruitmentUser,
    applicationId: string,
  ): Promise<GithubProfileView | null> => {
    if (env.GITHUB_ENRICHMENT !== "on") {
      throw new HttpError(409, "GitHub enrichment is switched off for this deployment");
    }

    await assertVisible(acUser, applicationId);

    const [row] = await db
      .select({ link: applicationAnswer.answerText })
      .from(applicationAnswer)
      .innerJoin(
        questionDefinition,
        eq(applicationAnswer.questionDefinitionId, questionDefinition.id),
      )
      .where(
        and(
          eq(applicationAnswer.applicationId, applicationId),
          eq(questionDefinition.key, LINK_KEY),
        ),
      );

    const username = githubUsername(row?.link);
    if (username === null) {
      return null;
    }

    await githubService.record(applicationId, username, await fetchRepos(username));
    return githubService.getProfile(acUser, applicationId);
  },
};
