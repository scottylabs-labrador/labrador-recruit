import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { userSession } from "./fixtures.ts";
import {
  requestsMatching,
  setCommittees,
  setCycles,
  setDisagreements,
  setRanking,
  setSession,
  setStanding,
} from "./msw/handlers.ts";
import { aggregate, committee, cycle, myStanding, rankingRow } from "./recruitmentFixtures.ts";
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
