import { expect, test } from "@playwright/test";

import { API_URL } from "./config.ts";
import { resetDb, seedOpenCycle } from "./db.ts";

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
