/**
 * The review and submit page.
 *
 * The last page before an irreversible act, and the only place an applicant
 * sees everything they are about to send in one view. The tests are about the
 * two ways this page can betray somebody: letting them submit something
 * incomplete, and claiming a submission succeeded when it did not.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import type { ApplicationSummary } from "./msw/handlers.ts";
import {
  DEFAULT_COMMON_RESPONSE,
  setApplicationDraft,
  setApplications,
  setCommonResponse,
  setNextSubmission,
  setSession,
  submissionCalls,
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

/** A complete application: every required answer present, so submit is offered. */
function readyToSubmit() {
  setCommonResponse({
    ...DEFAULT_COMMON_RESPONSE,
    revision: 2,
    answers: { major: "Computer Science", year: "Senior" },
  });
  setApplications([application()]);
  setApplicationDraft("app-labrador", {
    formId: "form-labrador",
    revision: 3,
    answers: { why: "Because of the people." },
  });
}

beforeEach(() => {
  setSession(APPLICANT);
});

describe("reviewing before submitting", () => {
  it("shows the shared answers and each committee's answers in one place", async () => {
    readyToSubmit();

    await renderApp("/app/review");

    expect(await screen.findByText("Computer Science")).toBeDefined();
    const labrador = await screen.findByRole("region", { name: /labrador/i });
    expect(within(labrador).getByText(/because of the people/i)).toBeDefined();
  });

  it("states the deadline in the cycle's time zone", async () => {
    readyToSubmit();

    await renderApp("/app/review");

    expect(await screen.findAllByText(/january 31/i)).not.toHaveLength(0);
  });

  it("lists every missing required answer, with a link to the question", async () => {
    setCommonResponse({ ...DEFAULT_COMMON_RESPONSE, revision: 1, answers: {} });
    setApplications([application()]);
    setApplicationDraft("app-labrador", { formId: "form-labrador", revision: 1, answers: {} });

    await renderApp("/app/review");

    /*
     * Named and linked, not counted.
     *
     * "3 questions are incomplete" sends somebody hunting through every form.
     * The question's own words and a link to the page holding it is the
     * difference between a fixable problem and a scavenger hunt.
     *
     * Scoped to the region, because the question label legitimately appears
     * again further down where the answers are read back.
     */
    const unfinished = await screen.findByRole("region", {
      name: /finish these before submitting/i,
    });
    expect(within(unfinished).getByText(/your major/i)).toBeDefined();
    expect(within(unfinished).getByText(/why labrador/i)).toBeDefined();
    // Three: `major` and `year` are both required on the shared form, and
    // `why` on Labrador's. One link each, because "3 questions are incomplete"
    // is the version that helps nobody.
    expect(within(unfinished).getAllByRole("link", { name: /go to this question/i })).toHaveLength(
      3,
    );
  });

  it("does not offer to submit while something required is missing", async () => {
    setCommonResponse({ ...DEFAULT_COMMON_RESPONSE, revision: 1, answers: {} });
    setApplications([application()]);
    setApplicationDraft("app-labrador", { formId: "form-labrador", revision: 1, answers: {} });

    await renderApp("/app/review");

    await screen.findByRole("region", { name: /finish these before submitting/i });
    // The server refuses it anyway. Offering the button regardless would turn
    // a fixable omission into a failure the applicant has to decode.
    expect(screen.queryByRole("button", { name: /submit/i })).toBeNull();
  });

  it("does not require a question the rules hide", async () => {
    // `transferFrom` is required only for a Junior. A Senior must not be told
    // they have left it blank — the same `evaluateVisibility` the server uses.
    setCommonResponse({
      ...DEFAULT_COMMON_RESPONSE,
      revision: 2,
      answers: { major: "Computer Science", year: "Senior" },
    });
    setApplications([application()]);
    setApplicationDraft("app-labrador", {
      formId: "form-labrador",
      revision: 3,
      answers: { why: "Because of the people." },
    });

    await renderApp("/app/review");

    expect(await screen.findByRole("button", { name: /submit/i })).toBeDefined();
    expect(screen.queryByText(/which school did you transfer from/i)).toBeNull();
  });

  it("warns that submitting is final before it happens", async () => {
    readyToSubmit();

    await renderApp("/app/review");

    await screen.findByRole("button", { name: /submit/i });
    expect(screen.getByText(/cannot change/i)).toBeDefined();
  });

  it("says there is nothing to submit rather than rendering an empty page", async () => {
    setApplications([]);

    await renderApp("/app/review");

    expect(await screen.findByText(/nothing to submit yet/i)).toBeDefined();
  });
});

describe("submitting", () => {
  it("submits every unsubmitted application in one act", async () => {
    readyToSubmit();
    const user = userEvent.setup();

    await renderApp("/app/review");
    await user.click(await screen.findByRole("button", { name: /submit/i }));

    await waitFor(() => {
      expect(submissionCalls).toHaveLength(1);
    });
    // All or nothing. Half a submission is the worst outcome available here.
    expect(submissionCalls[0]!.applicationIds).toEqual(["app-labrador"]);
    expect(submissionCalls[0]!.idempotencyKey).toBeTruthy();
  });

  it("shows the confirmation only after the server commits", async () => {
    readyToSubmit();
    const user = userEvent.setup();

    await renderApp("/app/review");
    const submit = await screen.findByRole("button", { name: /submit/i });

    // Before the click there is no confirmation. An optimistic one would tell
    // somebody their application is in when it may not be.
    expect(screen.queryByText(/your application has been submitted/i)).toBeNull();

    await user.click(submit);

    expect(await screen.findByText(/your application has been submitted/i)).toBeDefined();
  });

  it("reuses one key for a repeated attempt, so a double click submits once", async () => {
    readyToSubmit();
    const user = userEvent.setup();

    await renderApp("/app/review");
    const submit = await screen.findByRole("button", { name: /submit/i });
    await user.dblClick(submit);

    await waitFor(() => {
      expect(submissionCalls.length).toBeGreaterThan(0);
    });
    /*
     * Either one request, or two carrying the same key.
     *
     * The endpoint is idempotent per key, so the only unsafe thing the page
     * can do is generate a fresh key per click - which the server would read
     * as a second, separate submission and refuse with an error the applicant
     * cannot interpret.
     */
    const keys = new Set(submissionCalls.map((call) => call.idempotencyKey));
    expect(keys.size).toBe(1);
  });

  it("names the committee and the question when the server refuses as incomplete", async () => {
    readyToSubmit();
    setNextSubmission("incomplete");
    const user = userEvent.setup();

    await renderApp("/app/review");
    await user.click(await screen.findByRole("button", { name: /submit/i }));

    /*
     * The server validates against its own copy of the answers, so it can
     * refuse something this page believed was complete - an autosave that
     * never landed, most likely. Its per-application detail is rendered rather
     * than collapsed into "submission failed".
     */
    const problem = await screen.findByRole("alert");
    expect(within(problem).getByText("Labrador")).toBeDefined();
    expect(within(problem).getByText(/why labrador\? is missing/i)).toBeDefined();
    expect(screen.queryByText(/your application has been submitted/i)).toBeNull();
  });

  it("reports a passed deadline in the server's own words", async () => {
    readyToSubmit();
    setNextSubmission("deadline");
    const user = userEvent.setup();

    await renderApp("/app/review");
    await user.click(await screen.findByRole("button", { name: /submit/i }));

    // The deadline is evaluated server-side and is the authority. A browser
    // clock is not evidence, so this page never claims to know better.
    expect(await screen.findByText(/deadline.*has passed/i)).toBeDefined();
    expect(screen.queryByText(/your application has been submitted/i)).toBeNull();
  });

  it("says everything is already submitted rather than offering to resend", async () => {
    setCommonResponse({
      ...DEFAULT_COMMON_RESPONSE,
      revision: 2,
      answers: { major: "Computer Science", year: "Senior" },
      locked: true,
    });
    setApplications([
      application({ status: "Submitted", submittedAt: "2027-01-22T18:00:00.000Z" }),
    ]);
    setApplicationDraft("app-labrador", {
      formId: "form-labrador",
      revision: 3,
      answers: { why: "Because of the people." },
    });

    await renderApp("/app/review");

    expect(await screen.findByText(/already submitted/i)).toBeDefined();
    expect(screen.queryByRole("button", { name: /^submit/i })).toBeNull();
  });
});
