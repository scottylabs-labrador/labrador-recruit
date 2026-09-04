import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { userSession } from "./fixtures.ts";
import {
  lastAccountCreate,
  lastCommitteeAttach,
  lastCycleCreate,
  lastCycleUpdate,
  lastMembershipGrant,
  lastRevokedMembershipId,
  resetAdminRecorders,
  setCommittees,
  setCycles,
  setIdentityProviderConfigured,
  setMemberships,
  setSession,
  setStanding,
} from "./msw/handlers.ts";
import { committee, COMMITTEE_TECH, cycle, CYCLE_ID, myStanding } from "./recruitmentFixtures.ts";
import { renderApp } from "./render.tsx";

/**
 * Running a cycle used to mean someone with repository access running a script:
 * creating the cycle, attaching a committee, granting a membership and issuing
 * an account were all code. This screen is what makes the tool hand-offable.
 */
function asAdmin() {
  setSession(userSession("user"));
  setCycles([cycle()]);
  setCommittees([committee()]);
  setStanding(myStanding({ memberships: [{ role: "recruitment_admin", committeeId: null }] }));
}

function asReviewer() {
  setSession(userSession("user"));
  setCycles([cycle()]);
  setCommittees([committee()]);
  setStanding(myStanding({ memberships: [{ role: "reviewer", committeeId: COMMITTEE_TECH }] }));
}

/**
 * Starting a cycle is a global-admin power, not a cycle membership: there is no
 * cycle to hold a membership in yet. `abac.ts` grants "create Cycle" only to a
 * global admin for exactly that reason.
 */
function asGlobalAdmin() {
  asAdmin();
  setSession(userSession("admin"));
}

const SETTINGS = `/recruitment/${CYCLE_ID}/settings`;

describe("cycle settings", () => {
  beforeEach(() => {
    resetAdminRecorders();
    setIdentityProviderConfigured(false);
  });

  it("saves the cycle's own settings", async () => {
    asAdmin();
    const user = userEvent.setup();
    await renderApp(SETTINGS);

    // "Name" labels the cycle, the committee form and the account form, so this
    // one has to say which.
    const name = await screen.findByLabelText("Name", { selector: "#name" });
    await user.clear(name);
    await user.type(name, "Fall 2027");
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() => {
      expect(lastCycleUpdate?.["name"]).toBe("Fall 2027");
    });
  });

  /**
   * The cutoff is a line drawn on the ranking, never an instruction. Saving one
   * must record the number and nothing else - no decision may follow from it.
   */
  it("records the decision lines as plain numbers", async () => {
    asAdmin();
    const user = userEvent.setup();
    await renderApp(SETTINGS);

    await user.type(await screen.findByLabelText("Admit above rank"), "25");
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() => {
      expect(lastCycleUpdate?.["decisionCutoffAdmit"]).toBe(25);
    });
  });

  /** A blank box is "no line", which is not the same as rank zero. */
  it("sends a blank decision line as null rather than zero", async () => {
    asAdmin();
    const user = userEvent.setup();
    await renderApp(SETTINGS);

    await user.click(await screen.findByRole("button", { name: "Save settings" }));

    await waitFor(() => {
      expect(lastCycleUpdate).not.toBeNull();
    });
    expect(lastCycleUpdate?.["decisionCutoffAdmit"]).toBeNull();
  });

  /**
   * This setting existed on the cycle from the beginning and no API path could
   * set it, so it behaved as though hardcoded. It is reachable now.
   */
  it("can turn off creating candidacies from opt-ins", async () => {
    asAdmin();
    const user = userEvent.setup();
    await renderApp(SETTINGS);

    await user.click(await screen.findByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() => {
      expect(lastCycleUpdate?.["candidacyIncludeOptIns"]).toBe(false);
    });
  });

  it("attaches a committee", async () => {
    asAdmin();
    const user = userEvent.setup();
    await renderApp(SETTINGS);

    await user.type(await screen.findByLabelText("Slug"), "design");
    await user.type(screen.getByLabelText("Name", { selector: "#committee-name" }), "Design");
    await user.click(screen.getByRole("button", { name: "Add committee" }));

    await waitFor(() => {
      expect(lastCommitteeAttach?.["slug"]).toBe("design");
    });
  });

  it("grants a membership, lower-casing the Andrew ID", async () => {
    asAdmin();
    const user = userEvent.setup();
    await renderApp(SETTINGS);

    await user.type(await screen.findByLabelText("Andrew ID"), "JDoe");
    await user.selectOptions(screen.getByLabelText("Role"), "committee_lead");
    await user.click(screen.getByRole("button", { name: "Grant" }));

    await waitFor(() => {
      expect(lastMembershipGrant?.["userId"]).toBe("jdoe");
    });
    expect(lastMembershipGrant?.["role"]).toBe("committee_lead");
  });

  it("revokes an existing membership", async () => {
    asAdmin();
    setMemberships([
      {
        id: "membership-7",
        userId: "jdoe",
        userName: "Jane Doe",
        role: "reviewer",
        committeeId: COMMITTEE_TECH,
        committeeName: "Technology",
        active: true,
      },
    ]);
    const user = userEvent.setup();
    await renderApp(SETTINGS);

    await user.click(await screen.findByRole("button", { name: "Revoke" }));

    await waitFor(() => {
      expect(lastRevokedMembershipId).toBe("membership-7");
    });
  });

  /** Revoking deactivates rather than deletes, so the row stays readable. */
  it("shows a revoked membership without offering to revoke it again", async () => {
    asAdmin();
    setMemberships([
      {
        id: "membership-8",
        userId: "old",
        userName: "Former Reviewer",
        role: "reviewer",
        committeeId: null,
        committeeName: null,
        active: false,
      },
    ]);
    await renderApp(SETTINGS);

    const row = (await screen.findByText("Former Reviewer")).closest("tr");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("Revoked")).toBeDefined();
    expect(within(row as HTMLElement).queryByRole("button", { name: "Revoke" })).toBeNull();
  });

  it("withholds the whole screen from an ordinary reviewer", async () => {
    asReviewer();
    await renderApp(SETTINGS);

    expect(await screen.findByText("Not yours to change")).toBeDefined();
    expect(screen.queryByLabelText("Andrew ID")).toBeNull();
  });
});

describe("issuing sign-in accounts", () => {
  beforeEach(() => {
    resetAdminRecorders();
  });

  it("creates an account and shows the temporary password once", async () => {
    asAdmin();
    setIdentityProviderConfigured(false);
    const user = userEvent.setup();
    await renderApp(SETTINGS);

    await user.type(
      await screen.findByLabelText("Andrew ID", { selector: "#account-andrew" }),
      "jdoe",
    );
    await user.type(screen.getByLabelText("Name", { selector: "#account-name" }), "Jane Doe");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("fixture-temporary-password")).toBeDefined();
    expect(lastAccountCreate?.["andrewId"]).toBe("jdoe");
  });

  /**
   * Once single sign-on is on, people provision themselves on first login and a
   * password issued here would be a way around the Goldador group gate rather
   * than a convenience. The section retires itself.
   */
  it("disappears once single sign-on is configured", async () => {
    asAdmin();
    setIdentityProviderConfigured(true);
    await renderApp(SETTINGS);

    await screen.findByLabelText("Name", { selector: "#name" });
    expect(screen.queryByText("Sign-in accounts")).toBeNull();
    expect(screen.queryByRole("button", { name: "Create account" })).toBeNull();
  });
});

describe("starting a cycle", () => {
  beforeEach(() => {
    resetAdminRecorders();
    setIdentityProviderConfigured(false);
  });

  /**
   * Creating a cycle was a script until now, which meant nobody on the team
   * could start one without someone with repository access.
   */
  it("creates a cycle from the recruitment page", async () => {
    asGlobalAdmin();
    const user = userEvent.setup();
    await renderApp("/recruitment");

    await user.type(await screen.findByLabelText("Slug"), "Fall-2027");
    await user.type(screen.getByLabelText("Name"), "Fall 2027");
    await user.click(screen.getByRole("button", { name: "Create cycle" }));

    await waitFor(() => {
      expect(lastCycleCreate?.["slug"]).toBe("fall-2027");
    });
    expect(lastCycleCreate?.["name"]).toBe("Fall 2027");
  });

  it("does not offer it to somebody who cannot create one", async () => {
    asReviewer();
    await renderApp("/recruitment");

    // "Spring 2026" also names an option in the cycle picker, so match the card's
    // link rather than the text.
    await screen.findByRole("link", { name: "Spring 2026" });
    expect(screen.queryByRole("button", { name: "Create cycle" })).toBeNull();
  });
});
