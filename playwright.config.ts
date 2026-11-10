import { defineConfig, devices } from "@playwright/test";

import { WEB_URL } from "./e2e/config.ts";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"] ? "github" : "list",
  use: {
    baseURL: WEB_URL,
    trace: "on-first-retry",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "bun e2e/stack.ts",
    url: WEB_URL,
    reuseExistingServer: false,
    // Longer than `waitFor`'s own 180s ceiling in `e2e/stack.ts`, or Playwright
    // kills the stack before it can report which process failed to come up.
    timeout: 240_000,
  },
});
