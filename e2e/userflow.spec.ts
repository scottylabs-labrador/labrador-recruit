import { expect, test } from "@playwright/test";

import { signIn } from "./auth.ts";
import { adminUser, alice, resetDb, seedAdmin, seedAlice } from "./db.ts";

test.beforeEach(async () => {
  await resetDb();
});

test("a guest is told what the platform is and how to get in", async ({ page }) => {
  await page.goto("/");

  // Both assertions are exact on purpose. The nav's "Sign In" and the password
  // form's "Sign in" differ only in case, and Playwright matches an accessible
  // name case-insensitively, so a loose match resolves to two buttons whenever
  // password sign-in is enabled. "Recruit" is a substring of the nav's
  // "Recruitment" for the same reason.
  await expect(page.getByRole("button", { name: "Sign In", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recruit", exact: true })).toBeVisible();
  await expect(page.getByText(/not evaluated by any model/)).toBeVisible();
});

test("a signed-in user lands on recruitment rather than an empty page", async ({
  page,
  context,
}) => {
  await seedAlice();
  await signIn(context, alice.sessionToken);
  await page.goto("/");

  await expect(page).toHaveURL(/\/recruitment$/);
  await expect(page.getByRole("heading", { name: "Recruitment" })).toBeVisible();
});

test("an admin can open the dashboard and see users", async ({ page, context }) => {
  await seedAlice();
  await seedAdmin();
  await signIn(context, adminUser.sessionToken);
  await page.goto("/dashboard");

  await expect(page.getByRole("heading", { name: "Admin Dashboard" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Alice", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "alice", exact: true })).toBeVisible();
});
