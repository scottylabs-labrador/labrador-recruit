import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { userSession } from "./fixtures.ts";
import {
  setAggregates,
  setCommittees,
  setCycles,
  setRanking,
  setSession,
  setStanding,
} from "./msw/handlers.ts";
import {
  adminStanding,
  committee,
  COMMITTEE_DESIGN,
  COMMITTEE_TECH,
  cycle,
  CYCLE_ID,
} from "./recruitmentFixtures.ts";
import { renderApp } from "./render.tsx";

function twoCommittees() {
  setCommittees([
    committee({ id: COMMITTEE_TECH, slug: "tech", name: "Tech" }),
    committee({ id: COMMITTEE_DESIGN, slug: "design", name: "Design" }),
  ]);
}

/**
 * A deployment can be stood up for one committee — Labrador reviewing only its
 * own applicants — without deleting the other committees' candidacies or
 * anyone's submitted preferences.
 */
describe("single-committee scope", () => {
  it("offers a picker when the cycle runs every committee", async () => {
    setSession(userSession("admin"));
    setStanding(adminStanding());
    setCycles([cycle({ reviewCommitteeId: null })]);
    twoCommittees();
    setRanking([]);
    setAggregates([]);

    await renderApp(`/recruitment/${CYCLE_ID}/ranking`);

    // Wait for an option to exist rather than for the select: the select
    // renders immediately in its empty state, so asserting on it races the
    // query that fills it.
    await screen.findByRole("option", { name: "Design" });
    const picker = screen.getByLabelText("Committee");
    expect(within(picker).getAllByRole("option")).toHaveLength(2);
  });

  /**
   * A select with one option reads as a choice the reader does not have, and
   * hides which committee they are actually looking at.
   */
  it("names the committee instead of offering a choice when the cycle is pinned", async () => {
    setSession(userSession("admin"));
    setStanding(adminStanding());
    setCycles([cycle({ reviewCommitteeId: COMMITTEE_DESIGN })]);
    twoCommittees();
    setRanking([]);
    setAggregates([]);

    await renderApp(`/recruitment/${CYCLE_ID}/ranking`);

    expect(await screen.findByText("Design")).toBeDefined();
    expect(screen.queryByRole("combobox", { name: "Committee" })).toBeNull();
    expect(screen.queryByRole("option", { name: "Tech" })).toBeNull();
  });

  /**
   * A pin naming a committee the cycle does not run would otherwise empty every
   * screen, which looks like data loss rather than a misconfiguration.
   */
  it("falls back to every committee when the pin names one the cycle does not run", async () => {
    setSession(userSession("admin"));
    setStanding(adminStanding());
    setCycles([cycle({ reviewCommitteeId: "committee-that-left" })]);
    twoCommittees();
    setRanking([]);
    setAggregates([]);

    await renderApp(`/recruitment/${CYCLE_ID}/ranking`);

    await screen.findByRole("option", { name: "Design" });
    const picker = screen.getByLabelText("Committee");
    expect(within(picker).getAllByRole("option")).toHaveLength(2);
  });
});
