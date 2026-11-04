import { expect, test } from "@playwright/test";

import { API_URL } from "./config.ts";
import { resetDb } from "./db.ts";

test.beforeEach(async () => {
  await resetDb();
});

test("a guest is told what the platform is and how to get in", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("ScottyLabs Recruit")).toBeVisible();
  await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
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
