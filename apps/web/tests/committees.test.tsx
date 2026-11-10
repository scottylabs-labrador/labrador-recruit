/**
 * Committee selection.
 *
 * The page where an applicant commits to what they are applying to, so the
 * tests are about not letting them walk into a refusal: no second Apply on a
 * committee they already applied to, no Apply past the cycle's limit, and no
 * Apply on a committee that has not opened. The server enforces all three; the
 * point of the page is that the applicant never finds out that way.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import type { ApplicationSummary, CurrentCycle } from "./msw/handlers.ts";
import {
  applyCalls,
  DEFAULT_CYCLE,
  DEFAULT_OPENINGS,
  preferenceCalls,
  setApplications,
  setCurrentCycle,
  setOpenings,
  setSession,
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

function cycle(over: Partial<CurrentCycle> = {}): CurrentCycle {
  return { ...DEFAULT_CYCLE, ...over };
}

function application(over: Partial<ApplicationSummary> = {}): ApplicationSummary {
  return {
    applicationId: "app-labrador",
    openingId: "opening-labrador",
    committeeName: "Labrador",
    committeeSlug: "labrador",
    status: "Draft",
    lastSavedAt: null,
    submittedAt: null,
    ...over,
  };
}

beforeEach(() => {
  setSession(APPLICANT);
});

describe("choosing committees", () => {
  it("lists every committee that is recruiting, with what it does", async () => {
    await renderApp("/app/committees");

    const labrador = await screen.findByRole("article", { name: /labrador/i });
    expect(within(labrador).getByText(/product teams building for the CMU community/i));
    expect(await screen.findByRole("article", { name: /design/i })).toBeDefined();
  });

  it("states the limit before the applicant picks anything", async () => {
    await renderApp("/app/committees");

    // Learning the limit by being refused on the third application is the
    // worst possible time to learn it.
    expect(await screen.findByText(/up to 3 committees/i)).toBeDefined();
  });

  it("applies to a committee and reports it as started", async () => {
    const user = userEvent.setup();

    await renderApp("/app/committees");
    const labrador = await screen.findByRole("article", { name: /labrador/i });
    await user.click(within(labrador).getByRole("button", { name: /^apply/i }));

    await waitFor(() => {
      expect(applyCalls).toEqual(["opening-labrador"]);
    });
    expect(await within(labrador).findByRole("link", { name: /continue/i })).toBeDefined();
  });

  it("does not offer Apply twice for the same committee", async () => {
    setApplications([application()]);

    await renderApp("/app/committees");

    /*
     * The unique index behind this would refuse the second row, and the
     * endpoint returns the existing application rather than erroring. Neither
     * is a reason to render a button that does nothing an applicant can see.
     */
    const labrador = await screen.findByRole("article", { name: /labrador/i });
    expect(within(labrador).queryByRole("button", { name: /^apply/i })).toBeNull();
    expect(within(labrador).getByText(/already applied/i)).toBeDefined();
  });

  it("stops offering Apply once the limit is reached", async () => {
    setCurrentCycle(cycle({ maxCommitteesPerApplicant: 1 }));
    setApplications([application()]);

    await renderApp("/app/committees");

    const design = await screen.findByRole("article", { name: /design/i });
    expect(within(design).queryByRole("button", { name: /^apply/i })).toBeNull();
    expect(await screen.findByText(/reached the limit of 1 committee/i)).toBeDefined();
  });

  it("does not offer Apply for a committee that has not opened", async () => {
    setOpenings([
      { ...DEFAULT_OPENINGS[0]!, accepting: false, opensAt: "2027-03-01T17:00:00.000Z" },
    ]);

    await renderApp("/app/committees");

    const labrador = await screen.findByRole("article", { name: /labrador/i });
    expect(within(labrador).queryByRole("button", { name: /^apply/i })).toBeNull();
    expect(within(labrador).getByText(/march 1/i)).toBeDefined();
  });

  it("explains a refusal in the server's own words", async () => {
    // The endpoint knows things this page does not - another tab may have just
    // used the last slot. Its message is the one worth showing.
    setOpenings([]);
    setApplications([]);
    setCurrentCycle(cycle());

    await renderApp("/app/committees");

    expect(await screen.findByText(/no committees are recruiting/i)).toBeDefined();
  });
});

describe("ranking committees by preference", () => {
  it("asks for an order only when the cycle requires one", async () => {
    setApplications([application(), application({ applicationId: "app-design" })]);

    await renderApp("/app/committees");

    await screen.findByRole("article", { name: /labrador/i });
    // Most cycles do not rank. Asking an applicant to order their committees
    // when nobody will read the order is a question with no purpose.
    expect(screen.queryByRole("heading", { name: /order of preference/i })).toBeNull();
  });

  it("offers an order when the cycle requires one", async () => {
    setCurrentCycle(cycle({ requirePreferenceRanking: true }));
    setApplications([
      application(),
      application({
        applicationId: "app-design",
        openingId: "opening-design",
        committeeName: "Design",
        committeeSlug: "design",
      }),
    ]);

    await renderApp("/app/committees");

    expect(await screen.findByRole("heading", { name: /order of preference/i })).toBeDefined();
  });

  it("sends the whole ordering, not one change at a time", async () => {
    setCurrentCycle(cycle({ requirePreferenceRanking: true }));
    setApplications([
      application(),
      application({
        applicationId: "app-design",
        openingId: "opening-design",
        committeeName: "Design",
        committeeSlug: "design",
      }),
    ]);
    const user = userEvent.setup();

    await renderApp("/app/committees");
    await screen.findByRole("heading", { name: /order of preference/i });
    const ranking = screen.getByRole("list", { name: /order of preference/i });
    const rows = within(ranking).getAllByRole("listitem");
    await user.click(within(rows[1]!).getByRole("button", { name: /move design up/i }));
    await user.click(screen.getByRole("button", { name: /save my order/i }));

    /*
     * One call carrying the full list.
     *
     * A ranking is a single statement about a set. Sending it as independent
     * per-committee writes is how a set ends up with two first choices, and
     * the endpoint refuses a partial list for the same reason.
     */
    await waitFor(() => {
      expect(preferenceCalls).toEqual([["app-design", "app-labrador"]]);
    });
  });

  it("can be reordered from the keyboard alone", async () => {
    setCurrentCycle(cycle({ requirePreferenceRanking: true }));
    setApplications([
      application(),
      application({
        applicationId: "app-design",
        openingId: "opening-design",
        committeeName: "Design",
        committeeSlug: "design",
      }),
    ]);
    const user = userEvent.setup();

    await renderApp("/app/committees");
    await screen.findByRole("heading", { name: /order of preference/i });

    // Buttons rather than drag handles. A ranking that can only be expressed by
    // dragging cannot be expressed at all by somebody who does not use a mouse,
    // and this one is required before they can submit.
    screen.getByRole("button", { name: /move design up/i }).focus();
    await user.keyboard("{Enter}");

    const ranking = screen.getByRole("list", { name: /order of preference/i });
    const rows = within(ranking).getAllByRole("listitem");
    expect(rows[0]!.textContent).toContain("Design");
  });

  it("says which position each committee is in, in words", async () => {
    setCurrentCycle(cycle({ requirePreferenceRanking: true }));
    setApplications([
      application(),
      application({
        applicationId: "app-design",
        openingId: "opening-design",
        committeeName: "Design",
        committeeSlug: "design",
      }),
    ]);

    await renderApp("/app/committees");

    // Position conveyed only by vertical order is not conveyed to a screen
    // reader reading one row at a time.
    expect(await screen.findByText(/1st choice/i)).toBeDefined();
    expect(await screen.findByText(/2nd choice/i)).toBeDefined();
  });

  it("does not ask for an order when only one committee has been applied to", async () => {
    setCurrentCycle(cycle({ requirePreferenceRanking: true }));
    setApplications([application()]);

    await renderApp("/app/committees");

    await screen.findByRole("article", { name: /labrador/i });
    // There is nothing to order. Asking anyway is a form with one possible
    // answer.
    expect(screen.queryByRole("heading", { name: /order of preference/i })).toBeNull();
  });
});
