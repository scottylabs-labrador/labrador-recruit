import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { userSession } from "./fixtures.ts";
import {
  requestsMatching,
  setCommittees,
  setCycles,
  setDistributionPlan,
  setSession,
  setStanding,
  setWorkloads,
} from "./msw/handlers.ts";
import {
  committee,
  COMMITTEE_TECH,
  cycle,
  CYCLE_ID,
  distributionPlan,
  leadStanding,
  myStanding,
  reviewerWorkload,
} from "./recruitmentFixtures.ts";
import { renderApp } from "./render.tsx";

const ASSIGNMENTS = `/recruitment/${CYCLE_ID}/assignments`;

function asLead() {
  setSession(userSession("user"));
  setCycles([cycle()]);
  setCommittees([committee()]);
  setStanding(leadStanding(COMMITTEE_TECH));
}

describe("who may assign reviewers", () => {
  it("offers the tab and the screen to a committee lead", async () => {
    asLead();
    setDistributionPlan(distributionPlan());
    await renderApp(ASSIGNMENTS);

    expect(await screen.findByRole("button", { name: /Preview assignments/ })).toBeDefined();
  });

  it("withholds both from an ordinary reviewer", async () => {
    setSession(userSession("user"));
    setCycles([cycle()]);
    setCommittees([committee()]);
    setStanding(myStanding({ memberships: [{ role: "reviewer", committeeId: COMMITTEE_TECH }] }));
    await renderApp(ASSIGNMENTS);

    await screen.findByText(/Assigning reviewers is a lead or admin action/);
    expect(screen.queryByRole("link", { name: "Assignments" })).toBeNull();
    // Nothing is even asked for, so a reviewer cannot provoke the 403 by
    // landing on the URL directly.
    expect(requestsMatching("POST", "/assignments/distribute")).toHaveLength(0);
  });
});

describe("previewing before assigning", () => {
  it("names every assignment it would make, and writes nothing yet", async () => {
    asLead();
    setDistributionPlan(distributionPlan());
    const user = userEvent.setup();
    await renderApp(ASSIGNMENTS);

    await user.click(await screen.findByRole("button", { name: /Preview assignments/ }));

    await screen.findByText(/Nothing is written until you confirm/);

    // Every row is named, not just counted: a lead cannot check a split they
    // cannot read, and this writes a queue for the whole committee at once.
    await screen.findByText("Show all 2 assignments");
    const rows = screen.getByRole("list", { name: "Planned assignments" });
    expect(within(rows).getByText("Alice")).toBeDefined();
    expect(within(rows).getByText("Bob")).toBeDefined();

    const calls = requestsMatching("POST", "/assignments/distribute");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toMatchObject({ dryRun: true });
  });

  it("applies exactly what was previewed, and reports the count", async () => {
    asLead();
    setDistributionPlan(distributionPlan());
    const user = userEvent.setup();
    await renderApp(ASSIGNMENTS);

    await user.click(await screen.findByRole("button", { name: /Preview assignments/ }));
    await user.click(await screen.findByRole("button", { name: /Assign 2 reviewers/ }));

    await screen.findByText(/assignments created across/);
    const calls = requestsMatching("POST", "/assignments/distribute");
    expect(calls).toHaveLength(2);
    expect(calls[0]?.body).toMatchObject({ reviewersPerCandidacy: 3, dryRun: true });
    // The applied call carries the same target as the preview, so what a lead
    // confirmed is what gets written.
    expect(calls[1]?.body).toMatchObject({ reviewersPerCandidacy: 3, dryRun: false });
  });

  it("sends the target the lead typed", async () => {
    asLead();
    setDistributionPlan(distributionPlan());
    const user = userEvent.setup();
    await renderApp(ASSIGNMENTS);

    const target = await screen.findByLabelText("Reviewers per applicant");
    await user.clear(target);
    await user.type(target, "2");
    await user.click(screen.getByRole("button", { name: /Preview assignments/ }));

    await screen.findByText(/Nothing is written until you confirm/);
    expect(requestsMatching("POST", "/assignments/distribute")[0]?.body).toMatchObject({
      reviewersPerCandidacy: 2,
    });
  });

  it("says plainly when there is nothing left to do", async () => {
    asLead();
    setDistributionPlan(distributionPlan({ planned: [] }));
    const user = userEvent.setup();
    await renderApp(ASSIGNMENTS);

    await user.click(await screen.findByRole("button", { name: /Preview assignments/ }));

    await screen.findByText(/already has enough reviewers/);
    // No confirm button, because there is nothing to confirm.
    expect(screen.queryByRole("button", { name: /^Assign / })).toBeNull();
  });

  it("warns about applicants who cannot reach the target", async () => {
    asLead();
    setDistributionPlan(
      distributionPlan({
        shortfalls: [{ candidacyId: "c9", applicantName: "Short Fall", have: 1, want: 3 }],
      }),
    );
    const user = userEvent.setup();
    await renderApp(ASSIGNMENTS);

    await user.click(await screen.findByRole("button", { name: /Preview assignments/ }));

    await screen.findByText(/1 applicant cannot reach that many reviewers/);
    // The shortfall names the applicant and the gap, because the fix - enrol
    // more reviewers - is a human decision that needs the specifics.
    await screen.findByText(/Short Fall — 1 of 3/);
  });
});

describe("the workload table", () => {
  it("shows reviewers by name rather than by id", async () => {
    asLead();
    setDistributionPlan(distributionPlan());
    setWorkloads([
      reviewerWorkload({ userId: "u-alice", name: "Alice Reviewer", outstanding: 7 }),
      reviewerWorkload({ userId: "u-bob", name: "Bob Reviewer", outstanding: 1 }),
    ]);
    await renderApp(ASSIGNMENTS);

    const row = (await screen.findByText("Alice Reviewer")).closest("tr");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("7")).toBeDefined();
    expect(screen.queryByText("u-alice")).toBeNull();
  });
});
