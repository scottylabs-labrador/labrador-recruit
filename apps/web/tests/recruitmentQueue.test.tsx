import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { userSession } from "./fixtures.ts";
import { setCommittees, setCycles, setQueue, setSession, setStanding } from "./msw/handlers.ts";
import {
  committee,
  COMMITTEE_DESIGN,
  cycle,
  myStanding,
  queueEntry,
} from "./recruitmentFixtures.ts";
import { renderApp } from "./render.tsx";

function seed() {
  setSession(userSession());
  setCycles([cycle()]);
  setCommittees([
    committee(),
    committee({ id: COMMITTEE_DESIGN, slug: "design", name: "Design", displayOrder: 2 }),
  ]);
  setStanding(myStanding());
}

describe("my review queue", () => {
  it("renders one row per assignment with committee, applicant, rank, and state", async () => {
    seed();
    setQueue([
      queueEntry(),
      queueEntry({
        assignmentId: "assignment-2",
        candidacyId: "candidacy-2",
        committeeId: COMMITTEE_DESIGN,
        committeeName: "Design",
        applicantName: "Sam Fixture",
        applicantRank: 2,
        status: "submitted",
        submitted: true,
      }),
    ]);

    await renderApp("/recruitment/cycle-1/queue");

    expect(await screen.findByText("Robin Fixture")).toBeDefined();
    const table = screen.getByRole("table");
    expect(within(table).getByText("Sam Fixture")).toBeDefined();
    expect(within(table).getByText("Tech")).toBeDefined();
    expect(within(table).getByText("Design")).toBeDefined();
    expect(within(table).getByText("Not started")).toBeDefined();
    expect(within(table).getByText("Submitted")).toBeDefined();
    expect(within(table).getByText("#1")).toBeDefined();
    expect(within(table).getAllByText("Information Systems")).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: /Open review of/ })).toHaveLength(2);
  });

  it("filters by committee", async () => {
    const user = userEvent.setup();
    seed();
    setQueue([
      queueEntry(),
      queueEntry({
        assignmentId: "assignment-2",
        candidacyId: "candidacy-2",
        committeeId: COMMITTEE_DESIGN,
        committeeName: "Design",
        applicantName: "Sam Fixture",
      }),
    ]);

    await renderApp("/recruitment/cycle-1/queue");
    expect(await screen.findByText("Robin Fixture")).toBeDefined();

    await user.selectOptions(screen.getByLabelText("Committee"), COMMITTEE_DESIGN);

    await waitFor(() => {
      expect(screen.queryByText("Robin Fixture")).toBeNull();
    });
    expect(screen.getByText("Sam Fixture")).toBeDefined();
  });

  it("filters by status", async () => {
    const user = userEvent.setup();
    seed();
    setQueue([
      queueEntry(),
      queueEntry({
        assignmentId: "assignment-2",
        candidacyId: "candidacy-2",
        applicantName: "Sam Fixture",
        status: "submitted",
        submitted: true,
      }),
    ]);

    await renderApp("/recruitment/cycle-1/queue");
    expect(await screen.findByText("Robin Fixture")).toBeDefined();

    await user.selectOptions(screen.getByLabelText("Status"), "submitted");

    await waitFor(() => {
      expect(screen.queryByText("Robin Fixture")).toBeNull();
    });
    expect(screen.getByText("Sam Fixture")).toBeDefined();
  });

  it("hides the applicant name when blind review withholds it", async () => {
    seed();
    setCycles([cycle({ blindReviewEnabled: true })]);
    setQueue([queueEntry({ applicantName: null })]);

    await renderApp("/recruitment/cycle-1/queue");

    expect(await screen.findByText("Hidden")).toBeDefined();
    expect(screen.queryByText("Robin Fixture")).toBeNull();
  });

  it("shows an empty state when nothing is assigned", async () => {
    seed();
    setQueue([]);

    await renderApp("/recruitment/cycle-1/queue");

    expect(await screen.findByText("Nothing in your queue")).toBeDefined();
  });
});
