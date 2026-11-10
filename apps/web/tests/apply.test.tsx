/**
 * The two application forms.
 *
 * `/app/apply/common` and `/app/apply/:teamSlug` are the same component over a
 * different form, which is the point of `DynamicFormRenderer`. What these
 * tests protect is the part that is easy to get subtly wrong and expensive
 * when it is: autosave. A draft that silently fails to save, or that loses
 * what somebody typed because another tab was ahead, destroys an evening's
 * work and the applicant has no way to know it happened.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { AUTOSAVE_IDLE_MS } from "@/components/applicant/ApplicationForm.tsx";

import type { ApplicationSummary } from "./msw/handlers.ts";
import {
  COMMITTEE_FORM,
  DEFAULT_COMMON_RESPONSE,
  draftSaves,
  failNextDraftSaveWithConflict,
  setApplicationDraft,
  setApplications,
  setCommonResponse,
  setForms,
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
    status: "Draft",
    lastSavedAt: null,
    submittedAt: null,
    ...over,
  };
}

beforeEach(() => {
  setSession(APPLICANT);
});

describe("the shared questions", () => {
  it("renders the published questions", async () => {
    await renderApp("/app/apply/common");

    expect(await screen.findByLabelText(/your major/i)).toBeDefined();
    expect(await screen.findByRole("group", { name: /year/i })).toBeDefined();
  });

  it("shows the answers already saved", async () => {
    setCommonResponse({
      ...DEFAULT_COMMON_RESPONSE,
      revision: 3,
      answers: { major: "Computer Science" },
    });

    await renderApp("/app/apply/common");

    expect(await screen.findByDisplayValue("Computer Science")).toBeDefined();
  });

  it("saves a draft when asked, carrying the revision it read", async () => {
    setCommonResponse({ ...DEFAULT_COMMON_RESPONSE, revision: 3, answers: {} });
    const user = userEvent.setup();

    await renderApp("/app/apply/common");
    await user.type(await screen.findByLabelText(/your major/i), "Statistics");
    await user.click(screen.getByRole("button", { name: /save draft/i }));

    await waitFor(() => {
      expect(draftSaves).toHaveLength(1);
    });
    // The revision is the whole concurrency mechanism. Sending anything but the
    // one that was read turns a conflict into a silent overwrite.
    expect(draftSaves[0]).toMatchObject({ target: "common", revision: 3 });
    expect(draftSaves[0]!.answers).toEqual([{ questionKey: "major", value: "Statistics" }]);
  });

  it("sends the new revision on a second save, not the one it started with", async () => {
    setCommonResponse({ ...DEFAULT_COMMON_RESPONSE, revision: 3, answers: {} });
    const user = userEvent.setup();

    await renderApp("/app/apply/common");
    const major = await screen.findByLabelText(/your major/i);
    await user.type(major, "Stats");
    await user.click(screen.getByRole("button", { name: /save draft/i }));
    await waitFor(() => {
      expect(draftSaves).toHaveLength(1);
    });

    await user.type(major, "!");
    await user.click(screen.getByRole("button", { name: /save draft/i }));

    /*
     * Each save advances the revision, and the next one must carry the new
     * value. Holding the original would make every save after the first fail
     * as stale — which looks exactly like the server being broken.
     */
    await waitFor(() => {
      expect(draftSaves).toHaveLength(2);
    });
    expect(draftSaves[1]!.revision).toBe(4);
  });

  it("says when it last saved", async () => {
    const user = userEvent.setup();

    await renderApp("/app/apply/common");
    await user.type(await screen.findByLabelText(/your major/i), "Design");
    await user.click(screen.getByRole("button", { name: /save draft/i }));

    expect(await screen.findByText(/saved/i)).toBeDefined();
  });

  it("keeps what was typed when the server says another tab is ahead", async () => {
    failNextDraftSaveWithConflict();
    const user = userEvent.setup();

    await renderApp("/app/apply/common");
    await user.type(await screen.findByLabelText(/your major/i), "Physics");
    await user.click(screen.getByRole("button", { name: /save draft/i }));

    /*
     * A laptop and a phone both autosaving is ordinary. The one unacceptable
     * outcome is losing the text: the applicant is told their other tab is
     * ahead and what to do, and the field still holds what they wrote.
     */
    expect(await screen.findByText(/somewhere else/i)).toBeDefined();
    expect(screen.getByDisplayValue("Physics")).toBeDefined();
  });

  it("does not report a conflict as a generic failure", async () => {
    failNextDraftSaveWithConflict();
    const user = userEvent.setup();

    await renderApp("/app/apply/common");
    await user.type(await screen.findByLabelText(/your major/i), "Physics");
    await user.click(screen.getByRole("button", { name: /save draft/i }));

    await screen.findByText(/somewhere else/i);
    // "Something went wrong" would send somebody looking for a fault that does
    // not exist, and retrying is exactly the wrong next move.
    expect(screen.queryByText(/^something went wrong$/i)).toBeNull();
  });

  it("shows and hides a conditional question as the answer changes", async () => {
    const user = userEvent.setup();

    await renderApp("/app/apply/common");
    await screen.findByRole("group", { name: /year/i });

    expect(screen.queryByLabelText(/which school did you transfer from/i)).toBeNull();
    await user.click(screen.getByRole("radio", { name: "Junior" }));
    expect(await screen.findByLabelText(/which school did you transfer from/i)).toBeDefined();

    await user.click(screen.getByRole("radio", { name: "Senior" }));
    await waitFor(() => {
      expect(screen.queryByLabelText(/which school did you transfer from/i)).toBeNull();
    });
  });

  it("renders read-only once the answers are locked, and says why", async () => {
    setCommonResponse({
      ...DEFAULT_COMMON_RESPONSE,
      revision: 2,
      answers: { major: "Computer Science" },
      locked: true,
    });

    await renderApp("/app/apply/common");

    // Locked means unchangeable, not invisible. Somebody who submitted still
    // needs to read back what they sent, and needs to know who can correct it.
    expect(await screen.findByText(/Computer Science/)).toBeDefined();
    expect(screen.queryByLabelText(/your major/i)).toBeNull();
    expect(screen.getByText(/can no longer be changed/i)).toBeDefined();
    expect(screen.getByText(/ask a scottylabs administrator/i)).toBeDefined();
    expect(screen.queryByRole("button", { name: /save draft/i })).toBeNull();
  });
});

describe("autosave", () => {
  /*
   * Real timers, and a real wait of `AUTOSAVE_IDLE_MS`.
   *
   * Fake timers were the obvious tool and do not work here: the save goes
   * through the mock server over `fetch`, and a frozen clock stops that
   * request completing, so the test times out looking exactly like autosave
   * never firing. A second of real time per test buys an assertion about the
   * delay the applicant actually experiences.
   */
  const AFTER_IDLE = AUTOSAVE_IDLE_MS + 2_000;

  function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  it("saves on its own after a pause in typing", async () => {
    const user = userEvent.setup();

    await renderApp("/app/apply/common");
    const major = await screen.findByLabelText(/your major/i);

    // One keystroke, then the assertion, because a single keystroke cannot
    // take `AUTOSAVE_IDLE_MS` even on a slow machine. Asserting after a whole
    // word would be a test that fails when the test runner is busy rather than
    // when the product is wrong.
    await user.type(major, "C");
    expect(draftSaves).toHaveLength(0);

    await user.type(major, "hemistry");

    // Autosave is the promise the page makes by not having a prominent Save
    // button. If it never fires, the applicant loses everything and finds out
    // much later.
    await waitFor(
      () => {
        expect(draftSaves).toHaveLength(1);
      },
      { timeout: AFTER_IDLE },
    );
  });

  it("saves once for a burst of typing, not once per keystroke", async () => {
    const user = userEvent.setup();

    await renderApp("/app/apply/common");
    await user.type(await screen.findByLabelText(/your major/i), "Chemistry");
    await waitFor(
      () => {
        expect(draftSaves).toHaveLength(1);
      },
      { timeout: AFTER_IDLE },
    );

    // And it stays at one. A timer re-armed on every save would turn one burst
    // of typing into an endless stream of requests.
    await sleep(AUTOSAVE_IDLE_MS + 500);
    expect(draftSaves).toHaveLength(1);
  });

  it("does not save when nothing has changed", async () => {
    await renderApp("/app/apply/common");
    await screen.findByLabelText(/your major/i);

    await sleep(AFTER_IDLE);

    // An idle tab must not generate traffic, and must not bump the revision
    // out from under another tab somebody is typing in.
    expect(draftSaves).toHaveLength(0);
  });
});

describe("a committee application", () => {
  it("renders that committee's questions", async () => {
    setApplications([application()]);
    setApplicationDraft("app-labrador", {
      formId: COMMITTEE_FORM.formId,
      revision: 1,
      answers: {},
    });

    await renderApp("/app/apply/labrador");

    expect(await screen.findByLabelText(/why labrador/i)).toBeDefined();
  });

  it("saves against that application, not the shared answers", async () => {
    setApplications([application()]);
    setApplicationDraft("app-labrador", {
      formId: COMMITTEE_FORM.formId,
      revision: 2,
      answers: {},
    });
    const user = userEvent.setup();

    await renderApp("/app/apply/labrador");
    await user.type(await screen.findByLabelText(/why labrador/i), "Because of the people.");
    await user.click(screen.getByRole("button", { name: /save draft/i }));

    await waitFor(() => {
      expect(draftSaves).toHaveLength(1);
    });
    expect(draftSaves[0]).toMatchObject({ target: "app-labrador", revision: 2 });
  });

  it("offers to start the application when there is not one yet", async () => {
    setApplications([]);

    await renderApp("/app/apply/labrador");

    // Reached by typing a URL or following an old link. Better to say what is
    // missing and where to fix it than to render an empty form that cannot save.
    expect(await screen.findByText(/have not applied to this committee/i)).toBeDefined();
    expect(await screen.findByRole("link", { name: /browse committees/i })).toBeDefined();
  });

  it("renders read-only once the application has been submitted", async () => {
    setApplications([
      application({ status: "Submitted", submittedAt: "2027-01-22T18:00:00.000Z" }),
    ]);
    setApplicationDraft("app-labrador", {
      formId: COMMITTEE_FORM.formId,
      revision: 4,
      answers: { why: "Because of the people." },
    });

    await renderApp("/app/apply/labrador");

    // Submitting is final, and the server refuses a write. An editable field
    // here would invite somebody to rewrite an essay that cannot be saved.
    expect(await screen.findByText(/because of the people/i)).toBeDefined();
    expect(screen.queryByLabelText(/why labrador/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /save draft/i })).toBeNull();
  });

  it("explains when the committee's form has not been published", async () => {
    setApplications([application()]);
    setApplicationDraft("app-labrador", { formId: null, revision: 0, answers: {} });
    setForms([]);

    await renderApp("/app/apply/labrador");

    // A real state: a director opened the committee before publishing its
    // questions. An empty page would read as a broken application.
    expect(await screen.findByText(/questions are not ready yet/i)).toBeDefined();
  });

  it("links on to the shared questions and the review page", async () => {
    setApplications([application()]);

    await renderApp("/app/apply/labrador");

    await screen.findByLabelText(/why labrador/i);
    const nav = screen.getByRole("navigation", { name: /your application/i });
    expect(within(nav).getByRole("link", { name: /shared questions/i })).toBeDefined();
    expect(within(nav).getByRole("link", { name: /review/i })).toBeDefined();
  });
});
