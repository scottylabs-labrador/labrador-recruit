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
  COMMITTEE_TECH,
  committee,
  cycle,
  cycleProgress,
  myStanding,
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
});

describe("applicant filters", () => {
  const sophomore = application({
    applicationId: "app-soph",
    applicantName: "Robin Fixture",
    year: "sophomore",
  });
  const firstYear = application({
    applicationId: "app-first",
    applicantName: "Casey Firstyear",
    year: "first_year",
    committees: [{ committeeId: COMMITTEE_TECH, name: "Tech", rank: 1, hasCandidacy: false }],
  });

  it("narrows the list by year", async () => {
    const user = userEvent.setup();
    seed();
    setApplications([sophomore, firstYear]);

    await renderApp("/recruitment/cycle-1/applicants");
    expect(await screen.findByText("Casey Firstyear")).toBeDefined();

    await user.selectOptions(screen.getByLabelText("Year"), "sophomore");

    await waitFor(() => {
      expect(screen.queryByText("Casey Firstyear")).toBeNull();
    });
    expect(screen.getByText("Robin Fixture")).toBeDefined();
  });

  it("separates people with a candidacy from those who only ranked", async () => {
    const user = userEvent.setup();
    seed();
    setApplications([sophomore, firstYear]);

    await renderApp("/recruitment/cycle-1/applicants");
    expect(await screen.findByText("Robin Fixture")).toBeDefined();

    await user.selectOptions(screen.getByLabelText("Candidacy"), "without");

    // Casey ranked Tech but generates no review work there; Robin has a candidacy.
    await waitFor(() => {
      expect(screen.queryByText("Robin Fixture")).toBeNull();
    });
    expect(screen.getByText("Casey Firstyear")).toBeDefined();
  });

  it("keeps the filters in the URL so a view can be shared", async () => {
    seed();
    setApplications([sophomore, firstYear]);

    await renderApp("/recruitment/cycle-1/applicants?year=first_year");

    expect(await screen.findByText("Casey Firstyear")).toBeDefined();
    expect(screen.queryByText("Robin Fixture")).toBeNull();
    expect(screen.getByText("1 of 2 applicants shown")).toBeDefined();
  });

  it("offers a way back to the unfiltered list", async () => {
    const user = userEvent.setup();
    seed();
    setApplications([sophomore, firstYear]);

    await renderApp("/recruitment/cycle-1/applicants?year=first_year");
    expect(await screen.findByText("Casey Firstyear")).toBeDefined();

    await user.click(screen.getByRole("button", { name: /Clear filters/ }));

    await waitFor(() => {
      expect(screen.getByText("Robin Fixture")).toBeDefined();
    });
    expect(screen.getByText("2 of 2 applicants shown")).toBeDefined();
  });

  it("ignores a year the filter does not offer instead of hiding everyone", async () => {
    seed();
    setApplications([sophomore, firstYear]);

    // A hand-edited URL. Filtering to a year nobody has would show an empty
    // table that reads as a bug; an unknown value is treated as "all years".
    await renderApp("/recruitment/cycle-1/applicants?year=nope");

    expect(await screen.findByText("2 of 2 applicants shown")).toBeDefined();
  });
});
