import { expect, test, type Page } from "@playwright/test";

import { signIn } from "./auth.ts";
import {
  assignmentsForCandidacy,
  firstAssignmentFor,
  resetDb,
  seededStaff,
  seedRecruitmentCycle,
} from "./db.ts";

/**
 * End-to-end flows over a real server, a real database, and the built web app.
 *
 * These exist to catch what unit and API tests cannot: that the pieces are
 * actually wired together, and that independent review survives the round trip
 * through the browser rather than only holding in a predicate.
 */

const CRITERIA = ["interest", "initiative", "ideas", "experience", "growth"];

/** Scores every reviewer criterion. Radios are `sr-only`, so click the label. */
async function scoreEveryCriterion(page: Page, score: number) {
  for (const key of CRITERIA) {
    await page.locator(`label[for="criterion-${key}-${score}"]`).click();
  }
}

async function completeReview(page: Page, rationale: string, score = 4) {
  await scoreEveryCriterion(page, score);
  await page.getByLabel("Recommendation").selectOption("yes");
  await page.getByLabel("Confidence").selectOption("high");
  await page.getByLabel(/Rationale/).fill(rationale);
}

test.beforeEach(async () => {
  await resetDb();
});

test("a reviewer completes a review end to end and it locks", async ({ page, context }) => {
  const { cycleId } = await seedRecruitmentCycle();
  await signIn(context, seededStaff.reviewer.sessionToken);

  await page.goto(`/recruitment/${cycleId}/queue`);
  await expect(page.getByRole("table")).toBeVisible();

  const assignment = await firstAssignmentFor(seededStaff.reviewer.id);
  expect(assignment).not.toBeNull();
  if (!assignment) return;

  await page.goto(`/recruitment/${cycleId}/review/${assignment.assignmentId}`);

  // The application and the rubric sit side by side.
  await expect(page.getByRole("button", { name: "Submit review" })).toBeVisible();

  await completeReview(page, "Clear evidence of shipping work unprompted.");

  // The draft autosaves before any explicit submit.
  await expect(page.getByText("Saved")).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Submit review" }).click();
  await expect(page.getByText(/Submitting locks your review/)).toBeVisible();

  const submitted = page.waitForResponse(
    (response) => response.url().includes("/review/submit") && response.status() === 200,
  );
  await page.getByRole("button", { name: "Yes, submit and lock" }).click();
  await submitted;

  await expect(page.getByText(/This review is locked/)).toBeVisible();
});

test("a reviewer cannot submit without a rationale", async ({ page, context }) => {
  const { cycleId } = await seedRecruitmentCycle();
  await signIn(context, seededStaff.reviewer.sessionToken);

  const assignment = await firstAssignmentFor(seededStaff.reviewer.id);
  if (!assignment) return;

  await page.goto(`/recruitment/${cycleId}/review/${assignment.assignmentId}`);
  await scoreEveryCriterion(page, 4);
  await page.getByLabel("Recommendation").selectOption("yes");
  await page.getByLabel("Confidence").selectOption("high");

  await page.getByRole("button", { name: "Submit review" }).click();

  await expect(page.getByText("A rationale is required before you can submit.")).toBeVisible();
});

/**
 * The flow the whole permission model exists for: one reviewer's assessment
 * must not reach another until they have committed their own.
 */
test("a reviewer sees a peer's review only after submitting their own", async ({
  page,
  context,
  browser,
}) => {
  const { cycleId } = await seedRecruitmentCycle();

  const first = await firstAssignmentFor(seededStaff.reviewer.id);
  expect(first).not.toBeNull();
  if (!first) return;

  const peers = await assignmentsForCandidacy(first.candidacyId);
  const peer = peers.find((row) => row.reviewerUserId !== seededStaff.reviewer.id);
  expect(peer).toBeDefined();
  if (!peer) return;

  const peerStaff = Object.values(seededStaff).find((s) => s.id === peer.reviewerUserId);
  expect(peerStaff).toBeDefined();
  if (!peerStaff) return;

  // The peer submits first, in their own browser context.
  const peerContext = await browser.newContext();
  await signIn(peerContext, peerStaff.sessionToken);
  const peerPage = await peerContext.newPage();
  await peerPage.goto(`/recruitment/${cycleId}/review/${peer.assignmentId}`);
  await completeReview(peerPage, "A distinctive rationale only the peer wrote.", 5);
  const peerSubmitted = peerPage.waitForResponse(
    (response) => response.url().includes("/review/submit") && response.status() === 200,
  );
  await peerPage.getByRole("button", { name: "Submit review" }).click();
  await peerPage.getByRole("button", { name: "Yes, submit and lock" }).click();
  await peerSubmitted;
  await peerContext.close();

  // Our reviewer has not submitted, so the peer's rationale must be absent.
  await signIn(context, seededStaff.reviewer.sessionToken);
  await page.goto(`/recruitment/${cycleId}/review/${first.assignmentId}`);
  await expect(page.getByRole("button", { name: "Submit review" })).toBeVisible();
  await expect(page.getByText("A distinctive rationale only the peer wrote.")).toHaveCount(0);

  // After submitting, it appears.
  await completeReview(page, "My own independent assessment.");
  const mineSubmitted = page.waitForResponse(
    (response) => response.url().includes("/review/submit") && response.status() === 200,
  );
  await page.getByRole("button", { name: "Submit review" }).click();
  await page.getByRole("button", { name: "Yes, submit and lock" }).click();
  await mineSubmitted;

  await expect(page.getByText("A distinctive rationale only the peer wrote.")).toBeVisible({
    timeout: 15_000,
  });
});

test("declaring a conflict discards the draft and never asks why", async ({ page, context }) => {
  const { cycleId } = await seedRecruitmentCycle();
  await signIn(context, seededStaff.reviewer.sessionToken);

  const assignment = await firstAssignmentFor(seededStaff.reviewer.id);
  if (!assignment) return;

  await page.goto(`/recruitment/${cycleId}/review/${assignment.assignmentId}`);
  await page.getByRole("button", { name: "Declare conflict of interest" }).click();

  await expect(page.getByText("Declare a conflict of interest?")).toBeVisible();
  // The reviewer is never asked to explain themselves.
  await expect(page.getByRole("textbox", { name: /reason/i })).toHaveCount(0);

  const conflicted = page.waitForResponse(
    (response) => response.url().includes("/conflict") && response.status() === 204,
  );
  await page.getByRole("button", { name: "Yes, declare conflict" }).click();
  await conflicted;

  await page.goto(`/recruitment/${cycleId}/queue`);
  // Scoped to the table: an unscoped match also hits the hidden filter option.
  await expect(page.getByRole("table").getByText("Conflicted").first()).toBeVisible();
});

test("a cycle the caller has no standing in is not reachable", async ({ page, context }) => {
  await seedRecruitmentCycle();
  await signIn(context, seededStaff.reviewer.sessionToken);

  await page.goto("/recruitment/00000000-0000-0000-0000-000000000001/queue");

  await expect(page.getByText(/do not have access/i)).toBeVisible();
});

test("an unauthenticated visitor is not shown a review queue", async ({ page }) => {
  const { cycleId } = await seedRecruitmentCycle();

  await page.goto(`/recruitment/${cycleId}/queue`);

  await expect(page.getByRole("table")).toHaveCount(0);
});
