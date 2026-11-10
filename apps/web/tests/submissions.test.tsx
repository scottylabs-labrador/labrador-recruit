/**
 * Application history, submission detail, and the profile page.
 *
 * These are the pages an applicant refreshes while waiting, which makes them
 * the pages most likely to be read for a signal that is not there. The tests
 * are mostly about absence: no score, no shortlist position, no reviewer
 * identity, no internal note, and nothing about a decision before it has been
 * released.
 */
import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { ApplicationSummary } from "./msw/handlers.ts";
import {
  DEFAULT_COMMON_RESPONSE,
  setApplicationDraft,
  setApplications,
  setCommonResponse,
  setProfile,
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

function application(over: Partial<ApplicationSummary> = {}): ApplicationSummary {
  return {
    applicationId: "app-labrador",
    openingId: "opening-labrador",
    committeeName: "Labrador",
    committeeSlug: "labrador",
    status: "Submitted",
    lastSavedAt: "2027-01-20T15:04:00.000Z",
    submittedAt: "2027-01-22T18:00:00.000Z",
    ...over,
  };
}

beforeEach(() => {
  setSession(APPLICANT);
});

describe("application history", () => {
  it("lists each application with its committee, status and submission time", async () => {
    setApplications([application()]);

    await renderApp("/app/submissions");

    const row = await screen.findByRole("row", { name: /labrador/i });
    expect(within(row).getByText("Submitted")).toBeDefined();
    expect(within(row).getByText(/jan 22/i)).toBeDefined();
  });

  it("shows the projected status and nothing about an applicant's standing", async () => {
    setApplications([
      application({ status: "Under Review" }),
      application({
        applicationId: "app-design",
        committeeName: "Design",
        committeeSlug: "design",
        status: "Interview",
      }),
    ]);

    await renderApp("/app/submissions");

    await screen.findByRole("row", { name: /labrador/i });
    // No score, no shortlist position, no reviewer identity, no internal note,
    // ever. The server already projects the status; this asserts the client
    // does not reintroduce what it dropped.
    for (const forbidden of [/shortlist/i, /score/i, /rank/i, /reviewer/i, /\bnote\b/i]) {
      expect(screen.queryByText(forbidden)).toBeNull();
    }
  });

  it("says nothing about a decision until one has been released", async () => {
    setApplications([application({ status: "Under Review" })]);

    await renderApp("/app/submissions");

    await screen.findByRole("row", { name: /labrador/i });
    /*
     * `Under Review` covers both "genuinely being read" and "decided but not
     * released", deliberately and indistinguishably. A page that hinted at the
     * difference would be an oracle for an unreleased decision.
     */
    expect(screen.queryByText(/decision/i)).toBeNull();
  });

  it("invites a first-time applicant to start rather than showing an empty table", async () => {
    setApplications([]);

    await renderApp("/app/submissions");

    expect(await screen.findByText(/have not applied to anything yet/i)).toBeDefined();
    expect(await screen.findByRole("link", { name: /browse committees/i })).toBeDefined();
  });
});

describe("one submission in detail", () => {
  it("reads back exactly what was sent", async () => {
    setApplications([application()]);
    setApplicationDraft("app-labrador", {
      formId: "form-labrador",
      revision: 4,
      answers: { why: "Because of the people." },
    });
    setCommonResponse({
      ...DEFAULT_COMMON_RESPONSE,
      revision: 2,
      answers: { major: "Computer Science", year: "Senior" },
      locked: true,
    });

    await renderApp("/app/submissions/app-labrador");

    // Both halves: the shared answers went to this committee too, so leaving
    // them out would misrepresent what was sent.
    expect(await screen.findByText(/because of the people/i)).toBeDefined();
    expect(await screen.findByText("Computer Science")).toBeDefined();
  });

  it("is not editable", async () => {
    setApplications([application()]);
    setApplicationDraft("app-labrador", {
      formId: "form-labrador",
      revision: 4,
      answers: { why: "Because of the people." },
    });

    await renderApp("/app/submissions/app-labrador");

    await screen.findByText(/because of the people/i);
    expect(screen.queryByLabelText(/why labrador/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
  });

  it("says the application does not exist rather than who it belongs to", async () => {
    setApplications([application()]);

    await renderApp("/app/submissions/app-someone-else");

    /*
     * The endpoint answers 404 for an application the caller does not own,
     * exactly as it does for one that never existed. The page must not
     * distinguish them either, or it becomes the oracle the API refused to be.
     */
    expect(await screen.findByText(/could not find that application/i)).toBeDefined();
    expect(screen.queryByText(/permission/i)).toBeNull();
    expect(screen.queryByText(/belongs to/i)).toBeNull();
  });
});

describe("the profile page", () => {
  it("shows the identity CMU provided, and says it came from CMU", async () => {
    await renderApp("/app/profile");

    expect(await screen.findByText("Avery Quinn")).toBeDefined();
    expect(await screen.findByText("aquinn@andrew.cmu.edu")).toBeDefined();
    // Not editable here, and the page says why rather than offering a field
    // that would silently fail or be overwritten at the next sign-in.
    expect(screen.getByText(/comes from CMU/i)).toBeDefined();
  });

  it("states the cycle and its deadline", async () => {
    await renderApp("/app/profile");

    expect(await screen.findAllByText(/spring 2027/i)).not.toHaveLength(0);
    expect(await screen.findAllByText(/january 31/i)).not.toHaveLength(0);
  });

  it("says the shared answers are locked once they are", async () => {
    setProfile({
      cycleSlug: "spring-2027",
      cycleName: "Spring 2027 Recruitment",
      closesAt: "2027-02-01T04:59:00.000Z",
      commonLocked: true,
    });

    await renderApp("/app/profile");

    expect(await screen.findByText(/can no longer be changed/i)).toBeDefined();
  });

  it("explains that no model evaluates an applicant", async () => {
    await renderApp("/app/profile");

    // The promise is repeated where somebody looks for what the platform does
    // with what they wrote, not only on the page they saw before signing in.
    expect(await screen.findByText(/not evaluated by any model/i)).toBeDefined();
  });
});
