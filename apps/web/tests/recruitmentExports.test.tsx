import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { userSession } from "./fixtures.ts";
import {
  requestsMatching,
  setCommittees,
  setCycles,
  setDecisionExport,
  setRankingExport,
  setReviewerLoadExport,
  setSession,
  setStanding,
} from "./msw/handlers.ts";
import {
  adminStanding,
  committee,
  cycle,
  decisionExportRow,
  leadStanding,
  myStanding,
  rankingExportRow,
  reviewerLoadExportRow,
} from "./recruitmentFixtures.ts";
import { renderApp } from "./render.tsx";

function seedAdmin() {
  setSession(userSession());
  setCycles([cycle()]);
  setCommittees([committee()]);
  setStanding(adminStanding());
}

describe("exports", () => {
  it("previews the committee ranking rows on screen before any download", async () => {
    seedAdmin();
    setRankingExport([
      rankingExportRow(),
      rankingExportRow({ rank: 2, applicantName: "Sam Fixture", email: "sam@example.edu" }),
    ]);

    await renderApp("/recruitment/cycle-1/exports");

    expect(await screen.findByText("Robin Fixture")).toBeDefined();
    expect(screen.getByText("Sam Fixture")).toBeDefined();
    expect(screen.getByText("robin@example.edu")).toBeDefined();
    expect(
      screen.getByText("Committee ranking export — spring-2026-tech-ranking.csv"),
    ).toBeDefined();
    expect(screen.getByText("2 rows.")).toBeDefined();
  });

  it("previews the decisions and reviewer-load exports too", async () => {
    seedAdmin();
    setDecisionExport([decisionExportRow()]);
    setReviewerLoadExport([reviewerLoadExportRow()]);

    await renderApp("/recruitment/cycle-1/exports");

    expect(await screen.findByText("Decisions export — spring-2026-decisions.csv")).toBeDefined();
    expect(screen.getByText("Strong, thoughtful application.")).toBeDefined();

    expect(screen.getByText("Reviewer load export — spring-2026-reviewer-load.csv")).toBeDefined();
    expect(screen.getByText("Alice")).toBeDefined();
    expect(screen.getByText("Outstanding")).toBeDefined();
  });

  it("offers a download button per non-empty export", async () => {
    seedAdmin();
    setRankingExport([rankingExportRow()]);
    setReviewerLoadExport([reviewerLoadExportRow()]);

    await renderApp("/recruitment/cycle-1/exports");

    // Wait for the later of the two tables before counting, so a slower query
    // cannot make this pass or fail on timing.
    await screen.findByText("Reviewer load export — spring-2026-reviewer-load.csv");
    await screen.findByText("Committee ranking export — spring-2026-tech-ranking.csv");

    expect(screen.getAllByRole("button", { name: /Download CSV/ })).toHaveLength(2);
  });

  it("says which export carries PII and which is safe to circulate", async () => {
    seedAdmin();

    await renderApp("/recruitment/cycle-1/exports");

    expect(await screen.findByText("Which of these is safe to circulate")).toBeDefined();
    expect(screen.getByText(/contain applicant PII/)).toBeDefined();
    expect(screen.getByText(/contains no applicant data at all/)).toBeDefined();
  });

  it("offers a committee lead the ranking export but not the cycle-wide files", async () => {
    setSession(userSession());
    setCycles([cycle()]);
    setCommittees([committee()]);
    setStanding(leadStanding());
    setRankingExport([rankingExportRow()]);

    await renderApp("/recruitment/cycle-1/exports");

    expect(await screen.findByText("Robin Fixture")).toBeDefined();
    expect(screen.getByText(/Only a recruitment admin can export decisions/)).toBeDefined();
    expect(screen.getByText(/Only a recruitment admin can export reviewer load/)).toBeDefined();
    expect(requestsMatching("GET", "/exports/decisions")).toHaveLength(0);
    expect(requestsMatching("GET", "/exports/reviewer-load")).toHaveLength(0);
  });

  it("refuses the screen to an ordinary reviewer", async () => {
    setSession(userSession());
    setCycles([cycle()]);
    setStanding(myStanding());

    await renderApp("/recruitment/cycle-1/exports");

    expect(
      await screen.findByText("Exports are for committee leads and recruitment admins"),
    ).toBeDefined();
    expect(requestsMatching("GET", "/exports/")).toHaveLength(0);
  });
});
