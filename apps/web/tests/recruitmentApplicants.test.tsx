import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { userSession } from "./fixtures.ts";
import {
  requestsMatching,
  setAggregates,
  setApplications,
  setCommittees,
  setCycles,
  setPeerReviews,
  setProgress,
  setQueue,
  setSession,
  setStanding,
} from "./msw/handlers.ts";
import {
  adminStanding,
  aggregate,
  application,
  applicationDetail,
  committee,
  cycle,
  cycleProgress,
  myStanding,
  peerReview,
  queueEntry,
} from "./recruitmentFixtures.ts";
import { renderApp } from "./render.tsx";

function seed() {
  setSession(userSession());
  setCycles([cycle()]);
  setCommittees([committee()]);
  setStanding(myStanding());
}

describe("applicants", () => {
  it("filters the list by search term", async () => {
    const user = userEvent.setup();
    seed();
    setApplications([
      application(),
      application({
        applicationId: "application-2",
        applicantName: "Sam Fixture",
        major: "Statistics",
        detail: applicationDetail({ applicationId: "application-2", applicantName: "Sam Fixture" }),
      }),
    ]);

    await renderApp("/recruitment/cycle-1/applicants");

    expect(await screen.findByText("Robin Fixture")).toBeDefined();
    await user.type(screen.getByLabelText("Search"), "Statistics");

    await waitFor(() => {
      expect(screen.queryByText("Robin Fixture")).toBeNull();
    });
    expect(screen.getByText("Sam Fixture")).toBeDefined();
  });

  it("opens an applicant detail view with the submitted answers", async () => {
    const user = userEvent.setup();
    seed();
    setApplications([application()]);

    const { router } = await renderApp("/recruitment/cycle-1/applicants");

    await user.click(await screen.findByRole("link", { name: "Robin Fixture" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/recruitment/cycle-1/applicant/application-1");
    });
    expect(await screen.findByText("Why do you want to join ScottyLabs?")).toBeDefined();
    expect(screen.getByText("I want to ship things students actually use.")).toBeDefined();
  });
});

describe("cycle overview", () => {
  it("takes its counts from the progress endpoint, not from every application row", async () => {
    seed();
    setProgress(cycleProgress({ applicationCount: 42, candidacyCount: 71 }));
    setQueue([queueEntry(), queueEntry({ assignmentId: "assignment-2", submitted: true })]);
    setAggregates([aggregate({ disagreement: { flagged: true, reasons: ["Wide spread"] } })]);

    await renderApp("/recruitment/cycle-1");

    expect(await screen.findByText("Reviews assigned to you")).toBeDefined();
    expect(screen.getByText("42")).toBeDefined();
    expect(screen.getByText("71 candidacies across committees")).toBeDefined();
    expect(screen.getByText("Completed by you")).toBeDefined();
    expect(screen.getByText("1 outstanding")).toBeDefined();
    expect(await screen.findByText(/2 of 2 required reviews submitted/)).toBeDefined();
    expect(requestsMatching("GET", "/applications")).toHaveLength(0);
  });
});

describe("leadership-only context", () => {
  const FRIEND_REQUEST = "I would love to be on a team with Jamie.";

  function seedDetail() {
    setSession(userSession());
    setCycles([cycle()]);
    setCommittees([committee()]);
    setApplications([
      application({ detail: applicationDetail({ friendRequest: FRIEND_REQUEST }) }),
    ]);
  }

  it("withholds the friend request from an ordinary reviewer", async () => {
    seedDetail();
    setStanding(myStanding());

    await renderApp("/recruitment/cycle-1/applicant/application-1");

    expect(await screen.findByText("Why do you want to join ScottyLabs?")).toBeDefined();
    expect(screen.queryByText(FRIEND_REQUEST)).toBeNull();
  });

  it("shows it to a recruitment admin, labelled as never contributing to a score", async () => {
    seedDetail();
    setStanding(adminStanding());

    await renderApp("/recruitment/cycle-1/applicant/application-1");

    expect(await screen.findByText(FRIEND_REQUEST)).toBeDefined();
    expect(screen.getByText(/never contributes to a score/)).toBeDefined();
  });

  /**
   * Opening an applicant should answer "what did we make of them", not just
   * "what did they say". Both the verdict and the reviews behind it are keyed
   * by candidacy, so this also checks the candidacy the ranking produced is
   * threaded through the application detail.
   */
  it("shows the committee's verdict and every review under the application", async () => {
    seedDetail();
    setStanding(adminStanding());
    setAggregates([
      aggregate({
        disagreement: { flagged: true, reasons: ["Reviews include both a Strong Yes and a No"] },
      }),
    ]);
    setPeerReviews([
      peerReview({
        reviewId: "review-a",
        reviewerUserId: "bob",
        computedScore: 5,
        rationale: "Built and shipped a scheduling tool unprompted.",
      }),
      peerReview({
        reviewId: "review-b",
        reviewerUserId: "carol",
        computedScore: 2,
        rationale: "Reads to me as coursework rather than initiative.",
      }),
    ]);

    await renderApp("/recruitment/cycle-1/applicant/application-1");

    // The verdict, and why.
    expect(await screen.findByText("Disagreement")).toBeDefined();
    expect(screen.getByText("Reviews include both a Strong Yes and a No")).toBeDefined();

    // The reasoning behind it, in each reviewer's own words.
    expect(screen.getByText("Built and shipped a scheduling tool unprompted.")).toBeDefined();
    expect(screen.getByText("Reads to me as coursework rather than initiative.")).toBeDefined();
    expect(screen.getByText(/Score 5/)).toBeDefined();
    expect(screen.getByText(/Score 2/)).toBeDefined();

    // Only for the committee that actually has a candidacy. Design was ranked
    // second but never put forward, so there is nothing to show for it.
    expect(screen.getByText("Tech review")).toBeDefined();
    expect(screen.queryByText("Design review")).toBeNull();
  });
});
