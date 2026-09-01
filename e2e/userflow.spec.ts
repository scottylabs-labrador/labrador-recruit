import { expect, test } from "@playwright/test";

import { signIn } from "./auth.ts";
import { adminUser, resetDb, seedAdmin, seedAlice } from "./db.ts";

test.beforeEach(async () => {
  await resetDb();
});

test("a guest can see the app shell", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
  await expect(page.getByText("LabradorRecruit")).toBeVisible();
  await expect(page.getByText("Home")).toBeVisible();
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
