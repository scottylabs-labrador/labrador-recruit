import { expect, test } from "@playwright/test";

import { API_URL } from "./config.ts";
import {
  alice,
  closeCycleDeadline,
  resetDb,
  seedAlice,
  seedOpenCycle,
  sessionCookie,
} from "./db.ts";

test.beforeEach(async () => {
  await resetDb();
});

test("a guest reads what is recruiting and is sent to sign in", async ({ page }) => {
  await seedOpenCycle();

  // The root path redirects, so this also asserts that `/recruit` is the one
  // canonical landing page rather than a second copy of it.
  await page.goto("/");
  await expect(page).toHaveURL(/\/recruit$/);

  await expect(page.getByRole("heading", { name: "End To End Recruitment" })).toBeVisible();

  const committee = page.getByRole("article", { name: /labrador/i });
  await expect(committee).toBeVisible();
  await expect(committee.getByText(/product teams building for the CMU community/i)).toBeVisible();

  await page.getByRole("link", { name: "Sign in to apply" }).click();
  await expect(page).toHaveURL(/\/signin/);
  await expect(page.getByRole("button", { name: "Sign in with your Andrew ID" })).toBeVisible();
});

test("the landing page says nothing is recruiting when nothing is", async ({ page }) => {
  // No seed at all, against a real empty database. This is the between-seasons
  // state, and it must read as an explanation rather than as a broken page.
  await page.goto("/recruit");

  await expect(
    page.getByRole("heading", { name: /applications are not open right now/i }),
  ).toBeVisible();
  await expect(page.getByText(/no committees are recruiting/i)).toBeVisible();
});

test("an unauthenticated visitor to the applicant surface keeps their destination", async ({
  page,
}) => {
  await seedOpenCycle();

  await page.goto("/app/dashboard");

  // The guard is a navigation courtesy rather than the security boundary - the
  // endpoints refuse on their own - but losing the destination here would
  // silently break every link into the applicant surface.
  await expect(page).toHaveURL(/\/signin\?redirect=%2Fapp%2Fdashboard$/);
  await expect(page.getByText("/app/dashboard")).toBeVisible();
});

test("the API reports liveness", async ({ request }) => {
  // Absolute, because Playwright's `baseURL` is the interface. A relative path
  // here hits the web server, which answers every unknown path with index.html
  // for client-side routing - so the failure is a JSON parse error rather than
  // a 404, which is a confusing way to learn you asked the wrong host.
  const res = await request.get(`${API_URL}/v1/health`);

  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ status: "ok" });
});

test("a signed-in applicant sees their dashboard against the real stack", async ({
  page,
  context,
}) => {
  await seedOpenCycle();
  await seedAlice();
  await context.addCookies([await sessionCookie(alice.sessionToken)]);

  await page.goto("/app/dashboard");

  /*
   * The first authenticated path through the real stack.
   *
   * Everything below `/app` was covered only in jsdom with a mocked API, which
   * cannot catch a cookie that is not sent, a CORS rule that drops
   * credentials, or an endpoint the browser calls differently than the mock.
   */
  await expect(page.getByRole("heading", { name: /hello, alice/i })).toBeVisible();
  await expect(page.getByText(/end to end recruitment/i).first()).toBeVisible();
  await expect(page.getByText(/have not started an application/i)).toBeVisible();
});

test("an applicant can start an application end to end", async ({ page, context }) => {
  await seedOpenCycle();
  await seedAlice();
  await context.addCookies([await sessionCookie(alice.sessionToken)]);

  await page.goto("/app/committees");
  const labrador = page.getByRole("article", { name: /labrador/i });
  await labrador.getByRole("button", { name: /^apply to labrador$/i }).click();

  // The row is created by the API, read back by the next request, and the card
  // changes because of what the server said - not because the click succeeded.
  await expect(labrador.getByText(/already applied/i)).toBeVisible();

  await page.goto("/app/dashboard");
  await expect(page.getByText(/0 of 1 application submitted/i)).toBeVisible();
});

test("an applicant answers both forms, reviews and submits", async ({ page, context }) => {
  await seedOpenCycle();
  await seedAlice();
  await context.addCookies([await sessionCookie(alice.sessionToken)]);

  await page.goto("/app/committees");
  await page
    .getByRole("article", { name: /labrador/i })
    .getByRole("button", { name: /^apply to labrador$/i })
    .click();
  await expect(page.getByText(/already applied/i)).toBeVisible();

  // The shared questions, answered once.
  await page.goto("/app/apply/common");
  await page.getByLabel(/your major/i).fill("Computer Science");
  await page.getByRole("button", { name: /save draft/i }).click();
  await expect(page.getByText(/^Saved /)).toBeVisible();

  // Then the committee's own.
  await page.goto("/app/apply/labrador");
  await page.getByLabel(/why labrador/i).fill("Because of the people.");
  await page.getByRole("button", { name: /save draft/i }).click();
  await expect(page.getByText(/^Saved /)).toBeVisible();

  /*
   * The review page reads both back from the server, not from anything the
   * browser kept. If an autosave had silently failed, this is where it would
   * show as a missing required answer rather than as a submit that fails.
   */
  await page.goto("/app/review");
  await expect(page.getByText("Computer Science")).toBeVisible();
  await expect(page.getByText("Because of the people.")).toBeVisible();

  await page.getByRole("button", { name: /submit my application/i }).click();

  // The confirmation comes from the server's answer to the submit, never from
  // the click.
  await expect(page.getByText(/your application has been submitted/i)).toBeVisible();

  // And it is final: the shared answers are locked and the committee
  // application is no longer editable.
  await page.goto("/app/apply/common");
  await expect(page.getByText(/can no longer be changed/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /save draft/i })).toBeHidden();

  await page.goto("/app/submissions");
  await expect(page.getByRole("row", { name: /labrador/i }).getByText("Submitted")).toBeVisible();
});

test("the deadline is enforced by the server, not the browser", async ({ page, context }) => {
  const seeded = await seedOpenCycle();
  await seedAlice();
  await context.addCookies([await sessionCookie(alice.sessionToken)]);

  await page.goto("/app/committees");
  await page
    .getByRole("article", { name: /labrador/i })
    .getByRole("button", { name: /^apply to labrador$/i })
    .click();
  await expect(page.getByText(/already applied/i)).toBeVisible();

  await page.goto("/app/apply/labrador");
  await page.getByLabel(/why labrador/i).fill("Because of the people.");
  await page.getByRole("button", { name: /save draft/i }).click();
  await expect(page.getByText(/^Saved /)).toBeVisible();

  await page.goto("/app/apply/common");
  await page.getByLabel(/your major/i).fill("Computer Science");
  await page.getByRole("button", { name: /save draft/i }).click();
  await expect(page.getByText(/^Saved /)).toBeVisible();

  // The deadline passes while the review page is open. The browser's copy of
  // the cycle still says it is open, which is exactly the situation in which a
  // client-side check would wave the submission through.
  await closeCycleDeadline(seeded.cycleId);

  await page.goto("/app/review");
  await page.getByRole("button", { name: /submit my application/i }).click();

  // The server's own refusal, word for word, so this cannot pass on some other
  // element that happens to contain "deadline".
  await expect(page.getByText("The deadline for this recruitment cycle has passed.")).toBeVisible();
  await expect(page.getByText(/your application has been submitted/i)).toBeHidden();
});
