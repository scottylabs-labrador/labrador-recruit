import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { userSession } from "./fixtures.ts";
import {
  githubRefreshCount,
  resetAdminRecorders,
  setApplications,
  setCommittees,
  setCycles,
  setGithubProfile,
  setSession,
  setStanding,
} from "./msw/handlers.ts";
import {
  application,
  applicationDetail,
  committee,
  COMMITTEE_TECH,
  cycle,
  myStanding,
} from "./recruitmentFixtures.ts";
import { renderApp } from "./render.tsx";

const APPLICANT_PAGE = "/recruitment/cycle-1/applicant/application-1";

function asReviewer() {
  setSession(userSession("user"));
  setCycles([cycle()]);
  setCommittees([committee()]);
  setStanding(myStanding({ memberships: [{ role: "reviewer", committeeId: COMMITTEE_TECH }] }));
  setApplications([application({ detail: applicationDetail() })]);
}

const PROFILE = {
  username: "octocat",
  fetchedAt: "2026-09-01T12:00:00.000Z",
  error: null,
  repos: [
    {
      name: "hello-world",
      description: "A thing I built for 15-122",
      language: "TypeScript",
      stars: 12,
      pushedAt: "2026-08-01T00:00:00.000Z",
      url: "https://github.com/octocat/hello-world",
    },
  ],
};

/**
 * Fetching an applicant's link is a carve-out from product rule 1, drawn around
 * github.com and verbatim facts. The interface's job is to make it obvious that
 * this came from GitHub rather than from the applicant, and to draw nothing
 * from it.
 */
describe("GitHub facts on the review page", () => {
  beforeEach(() => {
    resetAdminRecorders();
  });

  it("shows the repository as GitHub states it", async () => {
    asReviewer();
    setGithubProfile(PROFILE);
    await renderApp(APPLICANT_PAGE);

    expect(await screen.findByRole("link", { name: /hello-world/ })).toBeDefined();
    expect(screen.getByText("A thing I built for 15-122")).toBeDefined();
    expect(screen.getByText("TypeScript")).toBeDefined();
    expect(screen.getByText("12 ★")).toBeDefined();
  });

  /**
   * A reviewer has to be able to tell this apart from what the applicant wrote
   * to us, or it reads as another submitted answer.
   */
  it("says it came from GitHub, and when", async () => {
    asReviewer();
    setGithubProfile(PROFILE);
    await renderApp(APPLICANT_PAGE);

    expect(await screen.findByText(/Fetched from GitHub/)).toBeDefined();
    expect(screen.getByText(/not\s+submitted by the applicant/)).toBeDefined();
  });

  /**
   * The whole design turns on this: the unauthenticated budget is 60 requests
   * an hour for the deployment, so opening an applicant must never spend one.
   * Rendering reads the cache; only the button asks GitHub.
   */
  it("asks GitHub for nothing when the page is opened", async () => {
    asReviewer();
    setGithubProfile(PROFILE);
    await renderApp(APPLICANT_PAGE);

    await screen.findByRole("link", { name: /hello-world/ });
    expect(githubRefreshCount).toBe(0);
  });

  it("asks GitHub only when the reviewer presses refresh", async () => {
    asReviewer();
    setGithubProfile(PROFILE);
    const user = userEvent.setup();
    await renderApp(APPLICANT_PAGE);

    await user.click(await screen.findByRole("button", { name: /Refresh/ }));

    await waitFor(() => {
      expect(githubRefreshCount).toBe(1);
    });
  });

  /**
   * A private account, a deleted one and an exhausted rate limit are ordinary
   * outcomes. They read as context, never as something broken.
   */
  it("gives the reason when there is nothing to show", async () => {
    asReviewer();
    setGithubProfile({
      username: "ghost",
      fetchedAt: "2026-09-01T12:00:00.000Z",
      error: "No public GitHub account with that name",
      repos: [],
    });
    await renderApp(APPLICANT_PAGE);

    expect(await screen.findByText(/No GitHub data: no public github account/i)).toBeDefined();
  });

  it("says so when the account exists but has nothing of their own", async () => {
    asReviewer();
    setGithubProfile({ ...PROFILE, repos: [], error: null });
    await renderApp(APPLICANT_PAGE);

    expect(await screen.findByText(/No public repositories of their own/)).toBeDefined();
  });

  /**
   * Most applicants leave the optional field blank. An empty card for every one
   * of them would be noise on the page that matters most.
   */
  it("shows nothing at all when the applicant gave no GitHub link", async () => {
    asReviewer();
    setGithubProfile(null);
    await renderApp(APPLICANT_PAGE);

    // The application itself still renders; only the GitHub card is absent.
    await screen.findByText("Robin Fixture");
    expect(screen.queryByText(/Fetched from GitHub/)).toBeNull();
  });
});
