import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { userSession } from "./fixtures.ts";
import {
  setAggregates,
  setApplications,
  setCommittees,
  setCycles,
  setQueue,
  setSession,
} from "./msw/handlers.ts";
import {
  aggregate,
  application,
  applicationDetail,
  committee,
  cycle,
  queueEntry,
} from "./recruitmentFixtures.ts";
import { renderApp } from "./render.tsx";

function seed() {
  setSession(userSession());
  setCycles([cycle()]);
  setCommittees([committee()]);
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
  it("summarises applicants, candidacies, the reviewer's own load, and flags", async () => {
    seed();
    setApplications([application()]);
    setQueue([queueEntry(), queueEntry({ assignmentId: "assignment-2", submitted: true })]);
    setAggregates([aggregate({ disagreement: { flagged: true, reasons: ["Wide spread"] } })]);

    await renderApp("/recruitment/cycle-1");

    expect(await screen.findByText("Reviews assigned to you")).toBeDefined();
    expect(screen.getByText("Completed by you")).toBeDefined();
    expect(screen.getByText("1 outstanding")).toBeDefined();
    expect(screen.getByText("1 candidacy across committees")).toBeDefined();
    expect(await screen.findByText(/2 of 2 required reviews submitted/)).toBeDefined();
  });
});
