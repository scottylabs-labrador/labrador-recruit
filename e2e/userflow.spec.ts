import { expect, test } from "@playwright/test";

import { signIn } from "./auth.ts";
import { adminUser, alice, resetDb, seedAdmin, seedAlice } from "./db.ts";

test.beforeEach(async () => {
  await resetDb();
});

test("a guest is told what the platform is and how to get in", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
  await expect(page.getByText("LabradorRecruit")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Labrador Recruit" })).toBeVisible();
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
