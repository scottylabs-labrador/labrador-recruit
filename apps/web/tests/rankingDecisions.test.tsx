import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { userSession } from "./fixtures.ts";
import {
  lastDecision,
  setCommittees,
  setCycles,
  setRanking,
  setSession,
  setStanding,
} from "./msw/handlers.ts";
import {
  committee,
  COMMITTEE_TECH,
  cycle,
  CYCLE_ID,
  myStanding,
  rankingRow,
} from "./recruitmentFixtures.ts";
import { renderApp } from "./render.tsx";

function asLead() {
  setSession(userSession("user"));
  setCycles([cycle()]);
  setCommittees([committee()]);
  setStanding(
    myStanding({ memberships: [{ role: "committee_lead", committeeId: COMMITTEE_TECH }] }),
  );
}

function asReviewer() {
  setSession(userSession("user"));
  setCycles([cycle()]);
  setCommittees([committee()]);
  setStanding(myStanding({ memberships: [{ role: "reviewer", committeeId: COMMITTEE_TECH }] }));
}

describe("recording a decision from the ranking", () => {
  it("offers admit, waitlist and reject to someone who may decide", async () => {
    asLead();
    setRanking([rankingRow({ reviewsShortBy: 0 })]);
    await renderApp(`/recruitment/${CYCLE_ID}/ranking`);

    expect(await screen.findByRole("button", { name: /Admit/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /Waitlist/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /Reject/ })).toBeDefined();
  });

  /**
   * A reviewer can read the ranking but not act on it. The server refuses
   * either way; withholding the control stops it looking like their click
   * failed.
   */
  it("withholds them from an ordinary reviewer", async () => {
    asReviewer();
    setRanking([rankingRow({ reviewsShortBy: 0 })]);
    await renderApp(`/recruitment/${CYCLE_ID}/ranking`);

    await screen.findByText("Robin Fixture");
    expect(screen.queryByRole("button", { name: /Admit/ })).toBeNull();
  });

  it("records the decision when the review minimum is already met", async () => {
    asLead();
    setRanking([rankingRow({ reviewsShortBy: 0 })]);
    const user = userEvent.setup();
    await renderApp(`/recruitment/${CYCLE_ID}/ranking`);

    await user.click(await screen.findByRole("button", { name: /Admit/ }));

    await waitFor(() => {
      expect(lastDecision?.status).toBe("accept");
    });
  });

  /**
   * Deciding before the minimum is allowed — a committee sometimes already
   * knows — but admitting somebody nobody has read is a terrible thing to do
   * by accident, so it is confirmed and the confirmation says what is missing.
   */
  it("confirms first when the candidacy is short of reviews, and says by how many", async () => {
    asLead();
    setRanking([rankingRow({ submittedCount: 0, minimumReviews: 2, reviewsShortBy: 2 })]);
    const user = userEvent.setup();
    await renderApp(`/recruitment/${CYCLE_ID}/ranking`);

    await user.click(await screen.findByRole("button", { name: /Admit/ }));

    expect(await screen.findByText(/2 reviews short/)).toBeDefined();
    expect(lastDecision).toBeNull();
  });

  it("records it once that confirmation is accepted", async () => {
    asLead();
    setRanking([rankingRow({ submittedCount: 0, minimumReviews: 2, reviewsShortBy: 2 })]);
    const user = userEvent.setup();
    await renderApp(`/recruitment/${CYCLE_ID}/ranking`);

    await user.click(await screen.findByRole("button", { name: /Admit/ }));
    await user.click(await screen.findByRole("button", { name: "Yes, admit" }));

    await waitFor(() => {
      expect(lastDecision?.status).toBe("accept");
    });
  });

  it("lets the confirmation be cancelled without recording anything", async () => {
    asLead();
    setRanking([rankingRow({ submittedCount: 0, minimumReviews: 2, reviewsShortBy: 2 })]);
    const user = userEvent.setup();
    await renderApp(`/recruitment/${CYCLE_ID}/ranking`);

    await user.click(await screen.findByRole("button", { name: /Admit/ }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(lastDecision).toBeNull();
    expect(await screen.findByRole("button", { name: /Admit/ })).toBeDefined();
  });

  it("shows a decision that has already been recorded", async () => {
    asLead();
    setRanking([rankingRow({ decisionStatus: "waitlist", reviewsShortBy: 0 })]);
    await renderApp(`/recruitment/${CYCLE_ID}/ranking`);

    // "Waitlist" is also a button label, so assert on the badge specifically:
    // the recorded decision is rendered as text, not as a control.
    const matches = await screen.findAllByText("Waitlist");
    expect(matches.some((element) => element.tagName !== "BUTTON")).toBe(true);
  });
});
