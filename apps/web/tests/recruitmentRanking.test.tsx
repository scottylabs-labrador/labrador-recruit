import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { userSession } from "./fixtures.ts";
import {
  requestsMatching,
  setCommitteeDecisions,
  setCommittees,
  setCycles,
  setDisagreements,
  setRanking,
  setSession,
  setStanding,
} from "./msw/handlers.ts";
import {
  adminStanding,
  aggregate,
  committee,
  committeeDecision,
  cycle,
  leadStanding,
  myStanding,
  rankingRow,
} from "./recruitmentFixtures.ts";
import { renderApp } from "./render.tsx";

const SPREAD_REASON = "Spread of 3.0 exceeds the configured threshold of 2.0";
const EXTREME_REASON = "Reviews include both a Strong Yes and a Strong No";

function seed() {
  setSession(userSession());
  setCycles([cycle()]);
  setCommittees([committee()]);
  setStanding(myStanding());
}

describe("committee ranking", () => {
  it("shows the arithmetic behind each row from the ranking response alone", async () => {
    seed();
    setRanking([rankingRow()]);

    await renderApp("/recruitment/cycle-1/ranking");

    expect(await screen.findByText("Robin Fixture")).toBeDefined();
    // `submittedCount`/`minimumReviews` now come straight off the ranking row.
    expect(screen.getByText("2/3")).toBeDefined();
    expect(screen.getAllByText("3.50").length).toBeGreaterThan(0);
    expect(screen.getByText("1 more needed")).toBeDefined();
    // The recommendation distribution is on the row too, so no aggregates call.
    expect(screen.getByTitle("Strong Yes: 1")).toBeDefined();
    expect(screen.getByTitle("No: 1")).toBeDefined();
    expect(requestsMatching("GET", "/aggregates")).toHaveLength(0);
  });

  it("marks a row complete once it has its minimum reviews", async () => {
    seed();
    setRanking([rankingRow({ submittedCount: 3, minimumReviews: 3 })]);

    await renderApp("/recruitment/cycle-1/ranking");

    expect(await screen.findByText("Complete")).toBeDefined();
    expect(screen.getByText("3/3")).toBeDefined();
  });

  it("renders every stated reason for a flagged row, never a bare flag", async () => {
    seed();
    setRanking([rankingRow({ flagged: true, reasons: [SPREAD_REASON, EXTREME_REASON] })]);

    await renderApp("/recruitment/cycle-1/ranking");

    expect(await screen.findByText("Flagged")).toBeDefined();
    expect(screen.getByText(SPREAD_REASON)).toBeDefined();
    expect(screen.getByText(EXTREME_REASON)).toBeDefined();
  });

  it("shows an empty state when there is nothing to rank", async () => {
    seed();
    setRanking([]);

    await renderApp("/recruitment/cycle-1/ranking");

    expect(await screen.findByText("Nothing to rank yet")).toBeDefined();
  });
});

describe("disagreement queue", () => {
  it("states the reason for every flagged candidacy", async () => {
    seed();
    setDisagreements([aggregate({ disagreement: { flagged: true, reasons: [SPREAD_REASON] } })]);

    await renderApp("/recruitment/cycle-1/disagreements");

    expect(await screen.findByText("Why this is flagged")).toBeDefined();
    expect(screen.getByText(SPREAD_REASON)).toBeDefined();
    expect(screen.getByText("Robin Fixture")).toBeDefined();
  });

  it("shows an empty state when nothing is flagged", async () => {
    seed();
    setDisagreements([]);

    await renderApp("/recruitment/cycle-1/disagreements");

    expect(await screen.findByText("No disagreements flagged")).toBeDefined();
  });
});

describe("committee decisions on the ranking page", () => {
  it("shows a reviewer the decision as a read-only badge, with no controls", async () => {
    seed();
    setRanking([rankingRow()]);
    setCommitteeDecisions({ decisions: [committeeDecision({ status: "accept" })] });

    await renderApp("/recruitment/cycle-1/ranking");

    expect(await screen.findByText("Robin Fixture")).toBeDefined();
    expect(screen.getByText("Admit")).toBeDefined();
    // A reviewer is shown the outcome, never a door they cannot open.
    expect(screen.queryByLabelText("Decision for Robin Fixture")).toBeNull();
    expect(screen.queryByLabelText("Select Robin Fixture")).toBeNull();
  });

  it("lets a lead change one decision and sends it to the server", async () => {
    seed();
    setStanding(leadStanding());
    setRanking([rankingRow()]);
    setCommitteeDecisions({ decisions: [committeeDecision()] });
    const user = userEvent.setup();

    await renderApp("/recruitment/cycle-1/ranking");

    const control = await screen.findByLabelText("Decision for Robin Fixture");
    await user.selectOptions(control, "waitlist");

    await waitFor(() => {
      expect(requestsMatching("PUT", "/candidacies/candidacy-1/decision")).toHaveLength(1);
    });
    expect(requestsMatching("PUT", "/candidacies/candidacy-1/decision")[0]?.body).toEqual({
      status: "waitlist",
    });
  });

  it("never applies a bulk decision without naming who it would change", async () => {
    seed();
    setStanding(adminStanding());
    setRanking([rankingRow()]);
    setCommitteeDecisions({ decisions: [committeeDecision()] });
    const user = userEvent.setup();

    await renderApp("/recruitment/cycle-1/ranking");

    await user.click(await screen.findByLabelText("Select Robin Fixture"));
    expect(screen.getByText("1 applicant selected")).toBeDefined();

    // Selecting alone must not write anything: product rule 1 forbids an
    // accept that no human confirmed.
    expect(requestsMatching("PUT", "/decision")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: /Review 1 change/ }));

    // The confirmation names the applicant and the transition, not just a count.
    expect(screen.getByRole("heading", { name: /Set 1 applicant to Admit/ })).toBeDefined();
    expect(requestsMatching("PUT", "/decision")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: /Confirm 1 decision/ }));

    await waitFor(() => {
      expect(requestsMatching("PUT", "/candidacies/candidacy-1/decision")).toHaveLength(1);
    });
    expect(requestsMatching("PUT", "/candidacies/candidacy-1/decision")[0]?.body).toEqual({
      status: "accept",
    });
  });

  it("states capacity without refusing to go over it", async () => {
    seed();
    setStanding(adminStanding());
    setRanking([rankingRow()]);
    setCommitteeDecisions({
      capacity: 1,
      acceptedCount: 2,
      overCapacity: true,
      decisions: [committeeDecision({ status: "accept" })],
    });

    await renderApp("/recruitment/cycle-1/ranking");

    expect(await screen.findByText(/over this committee's capacity/)).toBeDefined();
    // Over capacity is a warning, not a lock: the controls stay usable, because
    // a cap that blocked an admission would be the numeric cutoff rule 1 bans.
    expect(screen.getByLabelText("Decision for Robin Fixture")).toBeDefined();
  });
});
