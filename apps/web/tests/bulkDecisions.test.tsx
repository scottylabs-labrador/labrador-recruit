import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { userSession } from "./fixtures.ts";
import {
  decisionLog,
  setCommittees,
  setCycles,
  setRanking,
  setRejectedCandidacies,
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

function asLead(cutoffs: { admit?: number | null; reject?: number | null } = {}) {
  setSession(userSession("user"));
  setCycles([
    cycle({
      decisionCutoffAdmit: cutoffs.admit ?? null,
      decisionCutoffReject: cutoffs.reject ?? null,
    }),
  ]);
  setCommittees([committee()]);
  setStanding(
    myStanding({ memberships: [{ role: "committee_lead", committeeId: COMMITTEE_TECH }] }),
  );
}

/** Three complete rows, so nothing is short of the review minimum by default. */
function threeRows() {
  setRanking([
    rankingRow({ rank: 1, candidacyId: "c1", applicantName: "First", reviewsShortBy: 0 }),
    rankingRow({ rank: 2, candidacyId: "c2", applicantName: "Second", reviewsShortBy: 0 }),
    rankingRow({ rank: 3, candidacyId: "c3", applicantName: "Third", reviewsShortBy: 0 }),
  ]);
}

const RANKING = `/recruitment/${CYCLE_ID}/ranking`;

describe("selecting rows on the ranking", () => {
  beforeEach(() => {
    setRejectedCandidacies([]);
  });

  it("offers a checkbox per row to someone who may decide", async () => {
    asLead();
    threeRows();
    await renderApp(RANKING);

    expect(await screen.findByRole("checkbox", { name: "Select First" })).toBeDefined();
  });

  it("withholds selection from an ordinary reviewer", async () => {
    setSession(userSession("user"));
    setCycles([cycle()]);
    setCommittees([committee()]);
    setStanding(myStanding({ memberships: [{ role: "reviewer", committeeId: COMMITTEE_TECH }] }));
    threeRows();
    await renderApp(RANKING);

    await screen.findByRole("link", { name: "First" });
    expect(screen.queryByRole("checkbox", { name: "Select First" })).toBeNull();
  });

  it("selects every visible row from the header box", async () => {
    asLead();
    threeRows();
    const user = userEvent.setup();
    await renderApp(RANKING);

    await user.click(await screen.findByRole("checkbox", { name: "Select every row shown" }));

    expect(await screen.findByText("3 selected")).toBeDefined();
  });
});

describe("the decision lines", () => {
  beforeEach(() => {
    setRejectedCandidacies([]);
  });

  it("draws the admit and reject lines where the cycle puts them", async () => {
    asLead({ admit: 1, reject: 3 });
    threeRows();
    await renderApp(RANKING);

    expect(await screen.findByText("Admit line")).toBeDefined();
    expect(screen.getByText("Reject line")).toBeDefined();
  });

  it("draws no line when the cycle sets none", async () => {
    asLead();
    threeRows();
    await renderApp(RANKING);

    await screen.findByRole("link", { name: "First" });
    expect(screen.queryByText("Admit line")).toBeNull();
  });

  /**
   * The line is a reading aid and a selection, never an instruction: selecting
   * above it must record nothing on its own. Product rule 1 forbids an
   * automatic decision, "including by numeric cutoff".
   */
  it("selects everyone above the admit line without deciding anything", async () => {
    asLead({ admit: 2 });
    threeRows();
    const user = userEvent.setup();
    await renderApp(RANKING);

    await user.click(
      await screen.findByRole("button", { name: /Select everyone above the admit line/ }),
    );

    expect(await screen.findByText("2 selected")).toBeDefined();
    expect(decisionLog).toHaveLength(0);
  });
});

describe("applying a decision in bulk", () => {
  beforeEach(() => {
    setRejectedCandidacies([]);
  });

  /**
   * One audited write per candidacy rather than a single bulk call, so each
   * decision stays attributable to the person who pressed the button.
   */
  it("writes one decision per selected candidacy", async () => {
    asLead();
    threeRows();
    const user = userEvent.setup();
    await renderApp(RANKING);

    await user.click(await screen.findByRole("checkbox", { name: "Select every row shown" }));
    await user.click(await screen.findByRole("button", { name: "Admit selected" }));

    await waitFor(() => {
      expect(decisionLog).toHaveLength(3);
    });
    expect(decisionLog.map((entry) => entry.candidacyId).sort()).toEqual(["c1", "c2", "c3"]);
    expect(decisionLog.every((entry) => entry.status === "accept")).toBe(true);
  });

  /**
   * A bulk action that half-succeeded has to say so. Silently reporting success
   * would leave the reader believing rows were decided that were not.
   */
  it("reports how many could not be recorded rather than failing silently", async () => {
    asLead();
    threeRows();
    setRejectedCandidacies(["c2"]);
    const user = userEvent.setup();
    await renderApp(RANKING);

    await user.click(await screen.findByRole("checkbox", { name: "Select every row shown" }));
    await user.click(await screen.findByRole("button", { name: "Reject selected" }));

    await waitFor(() => {
      expect(decisionLog).toHaveLength(2);
    });
    expect(await screen.findByText(/1 could not be recorded/)).toBeDefined();
  });

  it("confirms first when some of the selection is short of reviews", async () => {
    asLead();
    setRanking([
      rankingRow({ rank: 1, candidacyId: "c1", applicantName: "First", reviewsShortBy: 0 }),
      rankingRow({ rank: 2, candidacyId: "c2", applicantName: "Second", reviewsShortBy: 2 }),
    ]);
    const user = userEvent.setup();
    await renderApp(RANKING);

    await user.click(await screen.findByRole("checkbox", { name: "Select every row shown" }));
    await user.click(await screen.findByRole("button", { name: "Admit selected" }));

    expect(await screen.findByText(/1 of the 2 selected/)).toBeDefined();
    expect(decisionLog).toHaveLength(0);
  });

  it("records them once that confirmation is accepted", async () => {
    asLead();
    setRanking([
      rankingRow({ rank: 1, candidacyId: "c1", applicantName: "First", reviewsShortBy: 0 }),
      rankingRow({ rank: 2, candidacyId: "c2", applicantName: "Second", reviewsShortBy: 2 }),
    ]);
    const user = userEvent.setup();
    await renderApp(RANKING);

    await user.click(await screen.findByRole("checkbox", { name: "Select every row shown" }));
    await user.click(await screen.findByRole("button", { name: "Admit selected" }));
    await user.click(await screen.findByRole("button", { name: "Yes, admit 2" }));

    await waitFor(() => {
      expect(decisionLog).toHaveLength(2);
    });
  });
});
