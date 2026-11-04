/**
 * The student dashboard.
 *
 * The page an applicant returns to, so the tests are mostly about honesty: it
 * must not offer an action the server will refuse, must not imply progress
 * that has not happened, and must never show a word about an applicant's
 * standing that the projected status does not already contain.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import type { ApplicationSummary } from "./msw/handlers.ts";
import {
  setApplications,
  setCurrentCycle,
  setProfile,
  setSession,
  withdrawCalls,
} from "./msw/handlers.ts";
import { renderApp } from "./render.tsx";

const APPLICANT = {
  user: {
    id: "aquinn",
    name: "Avery Quinn",
    email: "aquinn@andrew.cmu.edu",
    role: "user" as const,
  },
};

function application(over: Partial<ApplicationSummary> = {}): ApplicationSummary {
  return {
    applicationId: "app-labrador",
    openingId: "opening-labrador",
    committeeName: "Labrador",
    committeeSlug: "labrador",
    status: "Draft",
    lastSavedAt: "2027-01-20T15:04:00.000Z",
    submittedAt: null,
    ...over,
  };
}

beforeEach(() => {
  setSession(APPLICANT);
});

describe("the student dashboard", () => {
  it("greets the applicant by name", async () => {
    await renderApp("/app/dashboard");

    expect(await screen.findByText(/avery/i)).toBeDefined();
  });

  it("states the cycle deadline in the cycle's time zone", async () => {
    await renderApp("/app/dashboard");

    // Pittsburgh's January 31st, not the viewer's February 1st.
    expect(await screen.findAllByText(/january 31/i)).not.toHaveLength(0);
  });

  it("summarises how many applications are submitted out of how many started", async () => {
    setApplications([
      application(),
      application({
        applicationId: "app-design",
        committeeName: "Design",
        committeeSlug: "design",
        status: "Submitted",
        submittedAt: "2027-01-22T18:00:00.000Z",
      }),
    ]);

    await renderApp("/app/dashboard");

    expect(await screen.findByText(/1 of 2 applications submitted/i)).toBeDefined();
  });

  it("shows a card per application with its committee and status", async () => {
    setApplications([application()]);

    await renderApp("/app/dashboard");

    const card = await screen.findByRole("article", { name: /labrador/i });
    expect(within(card).getByText("Draft")).toBeDefined();
  });

  it("offers Continue on a draft and the last time it saved", async () => {
    setApplications([application()]);

    await renderApp("/app/dashboard");

    const card = await screen.findByRole("article", { name: /labrador/i });
    expect(within(card).getByRole("link", { name: /continue/i })).toBeDefined();
    expect(within(card).getByText(/last saved/i)).toBeDefined();
  });

  it("offers View rather than Continue once an application is submitted", async () => {
    setApplications([
      application({ status: "Submitted", submittedAt: "2027-01-22T18:00:00.000Z" }),
    ]);

    await renderApp("/app/dashboard");

    const card = await screen.findByRole("article", { name: /labrador/i });
    // Submitting is final. An Edit affordance here would promise something the
    // server refuses, and the applicant would find that out after writing.
    expect(within(card).queryByRole("link", { name: /continue/i })).toBeNull();
    expect(within(card).getByRole("link", { name: /view/i })).toBeDefined();
    // The time it was sent, not just the status word - "Submitted" alone leaves
    // somebody wondering whether the one they sent last week went through.
    expect(within(card).getByText(/submitted jan 22/i)).toBeDefined();
  });

  it("does not offer to withdraw an application that is already withdrawn", async () => {
    setApplications([application({ status: "Withdrawn" })]);

    await renderApp("/app/dashboard");

    const card = await screen.findByRole("article", { name: /labrador/i });
    expect(within(card).queryByRole("button", { name: /withdraw/i })).toBeNull();
  });

  it("does not offer to withdraw once a decision has been released", async () => {
    setApplications([application({ status: "Decision Available" })]);

    await renderApp("/app/dashboard");

    // The server refuses this, because withdrawing after reading a decision is
    // not withdrawing from consideration. Offering the button anyway would
    // produce a refusal the applicant cannot act on.
    const card = await screen.findByRole("article", { name: /labrador/i });
    expect(within(card).queryByRole("button", { name: /withdraw/i })).toBeNull();
  });

  it("offers to withdraw an application still under consideration", async () => {
    setApplications([application({ status: "Under Review" })]);

    await renderApp("/app/dashboard");

    const card = await screen.findByRole("article", { name: /labrador/i });
    expect(within(card).getByRole("button", { name: /withdraw/i })).toBeDefined();
  });

  it("shows no word about an applicant's standing beyond the projected status", async () => {
    setApplications([application({ status: "Under Review" })]);

    await renderApp("/app/dashboard");

    await screen.findByRole("article", { name: /labrador/i });
    // Product rule: no score, no shortlist position, no reviewer identity, no
    // internal note, ever. The server already projects the status; this is the
    // assertion that the client does not reintroduce what it dropped.
    for (const forbidden of [/shortlist/i, /score/i, /rank/i, /reviewer/i]) {
      expect(screen.queryByText(forbidden)).toBeNull();
    }
  });

  it("invites a first-time applicant to pick a committee", async () => {
    setApplications([]);

    await renderApp("/app/dashboard");

    expect(await screen.findByText(/have not started an application/i)).toBeDefined();
    expect(await screen.findByRole("link", { name: /browse committees/i })).toBeDefined();
  });

  it("offers another committee while the applicant is under the limit", async () => {
    setApplications([application()]);

    await renderApp("/app/dashboard");

    expect(await screen.findByRole("link", { name: /apply to another committee/i })).toBeDefined();
  });

  it("says the limit is reached rather than offering an action that would fail", async () => {
    setCurrentCycle({
      slug: "spring-2027",
      name: "Spring 2027 Recruitment",
      description: null,
      timeZone: "America/New_York",
      opensAt: "2027-01-05T17:00:00.000Z",
      closesAt: "2027-02-01T04:59:00.000Z",
      maxCommitteesPerApplicant: 1,
      requirePreferenceRanking: false,
    });
    setApplications([application()]);

    await renderApp("/app/dashboard");

    expect(await screen.findByText(/reached the limit of 1 committee/i)).toBeDefined();
    expect(screen.queryByRole("link", { name: /apply to another committee/i })).toBeNull();
  });

  it("does not withdraw on the first click", async () => {
    setApplications([application({ status: "Under Review" })]);
    const user = userEvent.setup();

    await renderApp("/app/dashboard");
    const card = await screen.findByRole("article", { name: /labrador/i });
    await user.click(within(card).getByRole("button", { name: /withdraw/i }));

    /*
     * The single most destructive thing on this page sits next to Continue.
     * One mis-click must not discard work somebody spent an evening on, so the
     * first click asks and sends nothing.
     */
    expect(withdrawCalls).toEqual([]);
    expect(within(card).getByText(/withdraw your application to labrador\?/i)).toBeDefined();
    expect(within(card).getByText(/cannot undo this/i)).toBeDefined();
  });

  it("withdraws once the applicant confirms", async () => {
    setApplications([application({ status: "Under Review" })]);
    const user = userEvent.setup();

    await renderApp("/app/dashboard");
    const card = await screen.findByRole("article", { name: /labrador/i });
    await user.click(within(card).getByRole("button", { name: /withdraw/i }));
    await user.click(within(card).getByRole("button", { name: /yes, withdraw it/i }));

    await waitFor(() => {
      expect(withdrawCalls).toEqual(["app-labrador"]);
    });
    // And the page reflects it, rather than leaving a stale card that invites a
    // second attempt the server would refuse.
    await waitFor(() => {
      expect(screen.getByText("Withdrawn")).toBeDefined();
    });
  });

  it("sends nothing when the applicant backs out", async () => {
    setApplications([application({ status: "Under Review" })]);
    const user = userEvent.setup();

    await renderApp("/app/dashboard");
    const card = await screen.findByRole("article", { name: /labrador/i });
    await user.click(within(card).getByRole("button", { name: /withdraw/i }));
    await user.click(within(card).getByRole("button", { name: /keep my application/i }));

    expect(withdrawCalls).toEqual([]);
    expect(within(card).getByRole("button", { name: /^withdraw$/i })).toBeDefined();
  });

  it("can be withdrawn from the keyboard alone", async () => {
    setApplications([application({ status: "Under Review" })]);
    const user = userEvent.setup();

    await renderApp("/app/dashboard");
    const card = await screen.findByRole("article", { name: /labrador/i });

    // Native buttons, reached by Tab and fired by Enter. Anything that needs a
    // pointer to confirm a destructive action is unusable to somebody who
    // cannot use one, and this is the action they can least afford to get wrong.
    within(card)
      .getByRole("button", { name: /withdraw/i })
      .focus();
    await user.keyboard("{Enter}");
    within(card)
      .getByRole("button", { name: /yes, withdraw it/i })
      .focus();
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(withdrawCalls).toEqual(["app-labrador"]);
    });
  });

  it("explains that applications are not open when there is no cycle", async () => {
    // A 404 from the profile endpoint is the ordinary state between seasons.
    setProfile(null);
    setCurrentCycle(null);
    setApplications([]);

    await renderApp("/app/dashboard");

    expect(await screen.findByText(/applications are not open/i)).toBeDefined();
  });
});
