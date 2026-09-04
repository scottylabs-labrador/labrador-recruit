import type { RecruitmentUser } from "@labrador/access-control";
import { applicantGithubProfile } from "@labrador/db/schema";
import { afterEach, describe, expect, it, vi } from "vitest";

import { githubService } from "../src/services/githubService.ts";
import { adminUser, seedAdmin } from "./fixtures.ts";
import { testDb } from "./harness.ts";
import {
  linkCommitteeToCycle,
  seedApplicant,
  seedApplication,
  seedCandidacy,
  seedCommittees,
  seedCycle,
  seedMembership,
} from "./recruitmentFixtures.ts";

function adminFor(cycleId: string): RecruitmentUser {
  return {
    id: adminUser.id,
    role: "user",
    recruitment: {
      cycleId,
      memberships: [{ role: "recruitment_admin", committeeId: null }],
      unblindedCandidacyIds: [],
      blindReviewEnabled: false,
    },
  };
}

async function setup() {
  await seedAdmin();

  const cycle = await seedCycle();
  const committees = await seedCommittees();
  const tech = committees["tech"];
  if (!tech) throw new Error("missing tech");
  await linkCommitteeToCycle(cycle.id, tech.id, 10);
  await seedMembership({
    cycleId: cycle.id,
    userId: adminUser.id,
    role: "recruitment_admin",
    committeeId: null,
  });

  const person = await seedApplicant({ email: "octo@andrew.cmu.edu", fullName: "Octo" });
  const application = await seedApplication({ cycleId: cycle.id, applicantId: person.id });
  await seedCandidacy({ applicationId: application.id, committeeId: tech.id });

  return { cycle, application };
}

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Unauthenticated GitHub allows 60 requests an hour for the whole deployment.
 * Reading an applicant's page must therefore cost nothing: the page reads a
 * cache, and only the schedule and the explicit refresh button spend budget.
 * A regression here would be invisible until a reviewer hit a rate limit
 * through no fault of their own, so it is asserted directly.
 */
describe("reading a cached GitHub profile", () => {
  it("contacts GitHub not at all", async () => {
    const { cycle, application } = await setup();
    const now = new Date();

    await testDb.insert(applicantGithubProfile).values({
      applicationId: application.id,
      username: "octocat",
      repos: [
        {
          name: "hello-world",
          description: null,
          language: "TypeScript",
          stars: 3,
          pushedAt: "2026-08-01T00:00:00.000Z",
          url: "https://github.com/octocat/hello-world",
        },
      ],
      error: null,
      httpStatus: null,
      fetchedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const profile = await githubService.getProfile(adminFor(cycle.id), application.id);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(profile?.username).toBe("octocat");
    expect(profile?.repos[0]?.name).toBe("hello-world");
  });

  it("reads an applicant with no cached profile as nothing, not an error", async () => {
    const { cycle, application } = await setup();

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const profile = await githubService.getProfile(adminFor(cycle.id), application.id);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(profile).toBeNull();
  });

  /**
   * The same visibility rule the application detail uses, imported rather than
   * restated. Somebody who cannot open the application must not be able to read
   * what its owner has built.
   *
   * Somebody with no standing in the cycle is refused by the ability before the
   * query is even built, which is why this asserts a refusal rather than a
   * particular message.
   */
  it("hides it from someone with no standing in the cycle", async () => {
    const { cycle, application } = await setup();

    const stranger: RecruitmentUser = {
      id: "stranger",
      role: "user",
      recruitment: {
        cycleId: cycle.id,
        memberships: [],
        unblindedCandidacyIds: [],
        blindReviewEnabled: false,
      },
    };

    await expect(githubService.getProfile(stranger, application.id)).rejects.toThrow();
  });

  /**
   * A reviewer enrolled in the cycle but never assigned this applicant reaches
   * the visibility query and is told the application does not exist - naming it
   * would confirm that it does.
   */
  it("reports not found for a reviewer with no assignment to it", async () => {
    const { cycle, application } = await setup();

    const unassigned: RecruitmentUser = {
      id: "unassigned",
      role: "user",
      recruitment: {
        cycleId: cycle.id,
        memberships: [{ role: "reviewer", committeeId: null }],
        unblindedCandidacyIds: [],
        blindReviewEnabled: false,
      },
    };

    await expect(githubService.getProfile(unassigned, application.id)).rejects.toThrow(
      /not found/iu,
    );
  });
});

/**
 * `GITHUB_ENRICHMENT` is what makes the carve-out in `docs/product-rules.md` §1
 * an opt-in. A deployment that has not opted in must not fetch an applicant's
 * link at all - not on a schedule, and not because somebody pressed a button.
 *
 * The tests run with it unset, which is the default and means off, so this
 * exercises the shipped default rather than a value the test invented.
 */
describe("the enrichment switch", () => {
  it("refuses an on-demand refresh, and fetches nothing, while it is off", async () => {
    const { cycle, application } = await setup();

    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(githubService.refreshOne(adminFor(cycle.id), application.id)).rejects.toThrow(
      /switched off/iu,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
