import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { userSession } from "./fixtures.ts";
import {
  setAggregates,
  setCommittees,
  setCycles,
  setDisagreements,
  setRanking,
  setSession,
} from "./msw/handlers.ts";
import { aggregate, committee, cycle, rankingRow } from "./recruitmentFixtures.ts";
import { renderApp } from "./render.tsx";

const SPREAD_REASON = "Spread of 3.0 exceeds the configured threshold of 2.0";
const EXTREME_REASON = "Reviews include both a Strong Yes and a Strong No";

function seed() {
  setSession(userSession());
  setCycles([cycle()]);
  setCommittees([committee()]);
}

describe("committee ranking", () => {
  it("shows the arithmetic behind each row", async () => {
    seed();
    setRanking([rankingRow()]);
    setAggregates([aggregate()]);

    await renderApp("/recruitment/cycle-1/ranking");

    expect(await screen.findByText("Robin Fixture")).toBeDefined();
    expect(screen.getByText("2/2")).toBeDefined();
    expect(screen.getAllByText("3.50").length).toBeGreaterThan(0);
    expect(screen.getByText("Complete")).toBeDefined();
  });

  it("renders every stated reason for a flagged row, never a bare flag", async () => {
    seed();
    setRanking([rankingRow({ flagged: true, reasons: [SPREAD_REASON, EXTREME_REASON] })]);
    setAggregates([
      aggregate({ disagreement: { flagged: true, reasons: [SPREAD_REASON, EXTREME_REASON] } }),
    ]);

    await renderApp("/recruitment/cycle-1/ranking");

    expect(await screen.findByText("Flagged")).toBeDefined();
    expect(screen.getByText(SPREAD_REASON)).toBeDefined();
    expect(screen.getByText(EXTREME_REASON)).toBeDefined();
  });

  it("shows an empty state when there is nothing to rank", async () => {
    seed();
    setRanking([]);
    setAggregates([]);

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
