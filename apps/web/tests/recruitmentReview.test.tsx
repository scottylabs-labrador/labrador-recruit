import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { userSession } from "./fixtures.ts";
import {
  requestsMatching,
  setApplications,
  setCommittees,
  setCycles,
  setPeerReviews,
  setQueue,
  setReview,
  setRubric,
  setSession,
} from "./msw/handlers.ts";
import {
  application,
  ASSIGNMENT_ID,
  committee,
  cycle,
  peerReview,
  queueEntry,
  review,
  rubric,
} from "./recruitmentFixtures.ts";
import { renderApp } from "./render.tsx";

const REVIEW_PATH = `/recruitment/cycle-1/review/${ASSIGNMENT_ID}`;
const AUTOSAVE_TIMEOUT_MS = 5000;

function seed() {
  setSession(userSession());
  setCycles([cycle()]);
  setCommittees([committee()]);
  setQueue([queueEntry()]);
  setApplications([application()]);
  setRubric(rubric());
  setReview(review());
  setPeerReviews([peerReview()]);
}

async function fillValidReview(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("radio", { name: "3" }));
  await user.selectOptions(screen.getByLabelText("Recommendation"), "yes");
  await user.selectOptions(screen.getByLabelText("Confidence"), "high");
  await user.type(screen.getByLabelText("Rationale (required)"), "Clear, concrete experience.");
}

describe("review page", () => {
  it("shows the application beside the rubric, and never embeds an applicant link", async () => {
    seed();
    await renderApp(REVIEW_PATH);

    expect(await screen.findByText("Describe a project you built.")).toBeDefined();
    expect(screen.getByText("A scheduling tool for my club.")).toBeDefined();

    const link = screen.getByRole("link", { name: /example\.com\/robin/ });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(document.querySelectorAll("iframe")).toHaveLength(0);
    expect(document.querySelectorAll("img")).toHaveLength(0);

    expect(screen.getByRole("radio", { name: "3" })).toBeDefined();
  });

  it("says so when the committee-specific response is absent", async () => {
    seed();
    const detail = application().detail;
    if (detail === undefined) throw new Error("fixture is missing a detail");
    setApplications([
      application({
        detail: {
          ...detail,
          sections: detail.sections.filter((section) => section.committeeId === null),
        },
      }),
    ]);

    await renderApp(REVIEW_PATH);

    expect(await screen.findByText("No committee-specific response submitted.")).toBeDefined();
  });

  it("refuses to submit without a rationale and explains why", async () => {
    const user = userEvent.setup();
    seed();
    await renderApp(REVIEW_PATH);

    await user.click(await screen.findByRole("radio", { name: "4" }));
    await user.selectOptions(screen.getByLabelText("Recommendation"), "yes");
    await user.selectOptions(screen.getByLabelText("Confidence"), "high");

    await user.click(screen.getByRole("button", { name: "Submit review" }));

    expect(screen.getByText("A rationale is required before you can submit.")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Yes, submit and lock" })).toBeNull();
    expect(requestsMatching("POST", "/review/submit")).toHaveLength(0);
    expect(screen.getByLabelText("Rationale (required)").getAttribute("aria-invalid")).toBe("true");
  });

  it("autosaves the draft with a PUT and reports the save state", async () => {
    const user = userEvent.setup();
    seed();
    await renderApp(REVIEW_PATH);

    await user.type(
      await screen.findByLabelText("Rationale (required)"),
      "Strong systems instincts.",
    );

    expect(screen.getByText("Saving…")).toBeDefined();

    await waitFor(
      () => {
        expect(requestsMatching("PUT", "/assignments/assignment-1/review").length).toBeGreaterThan(
          0,
        );
      },
      { timeout: AUTOSAVE_TIMEOUT_MS },
    );

    const [put] = requestsMatching("PUT", "/assignments/assignment-1/review");
    if (put === undefined) throw new Error("expected an autosave request");
    expect((put.body as { rationale: string }).rationale).toBe("Strong systems instincts.");
    expect(await screen.findByText("Saved", {}, { timeout: AUTOSAVE_TIMEOUT_MS })).toBeDefined();
  });

  it("locks the review after an explicit, warned submit and reveals peer reviews", async () => {
    const user = userEvent.setup();
    seed();
    await renderApp(REVIEW_PATH);

    await fillValidReview(user);
    await user.click(screen.getByRole("button", { name: "Submit review" }));

    expect(screen.getByText(/Submitting locks your review/)).toBeDefined();
    expect(requestsMatching("POST", "/review/submit")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Yes, submit and lock" }));

    await waitFor(() => {
      expect(screen.getByText(/This review is locked/)).toBeDefined();
    });
    expect(screen.queryByLabelText("Rationale (required)")).toBeNull();
    expect(screen.queryByRole("button", { name: "Submit review" })).toBeNull();
    expect(requestsMatching("POST", "/review/submit")).toHaveLength(1);

    expect(await screen.findByText("Solid project experience and clear writing.")).toBeDefined();
  });

  it("requires a confirmation step before declaring a conflict, and never asks for a reason", async () => {
    const user = userEvent.setup();
    seed();
    await renderApp(REVIEW_PATH);

    await user.click(await screen.findByRole("button", { name: "Declare conflict of interest" }));

    expect(screen.getByText("Declare a conflict of interest?")).toBeDefined();
    expect(requestsMatching("POST", "/conflict")).toHaveLength(0);
    expect(screen.queryByLabelText(/reason/i)).toBeNull();

    await user.click(screen.getByRole("button", { name: "Yes, declare conflict" }));

    await waitFor(() => {
      expect(requestsMatching("POST", "/conflict")).toHaveLength(1);
    });
  });

  it("lets a conflict confirmation be cancelled without calling the API", async () => {
    const user = userEvent.setup();
    seed();
    await renderApp(REVIEW_PATH);

    await user.click(await screen.findByRole("button", { name: "Declare conflict of interest" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText("Declare a conflict of interest?")).toBeNull();
    expect(requestsMatching("POST", "/conflict")).toHaveLength(0);
  });

  it("navigates through the queue with previous and next", async () => {
    const user = userEvent.setup();
    seed();
    setQueue([
      queueEntry(),
      queueEntry({
        assignmentId: "assignment-2",
        candidacyId: "candidacy-2",
        applicantName: "Sam Fixture",
      }),
    ]);

    const { router } = await renderApp(REVIEW_PATH);

    expect(await screen.findByText("1 of 2")).toBeDefined();
    expect(screen.getByRole("button", { name: /Previous/ }).hasAttribute("disabled")).toBe(true);

    await user.click(screen.getByRole("button", { name: /Next/ }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/recruitment/cycle-1/review/assignment-2");
    });
  });
});
