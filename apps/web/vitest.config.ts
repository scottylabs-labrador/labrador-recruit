import { mergeConfig } from "vite";
import { defineConfig } from "vitest/config";

import viteConfig from "./vite.config.ts";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "happy-dom",
      include: ["tests/**/*.{test,spec}.{ts,tsx}"],
      setupFiles: ["tests/setup.ts"],
      fileParallelism: false,
      // Must exceed the `asyncUtilTimeout` set in tests/setup.ts, or a test
      // dies before Testing Library has finished waiting and the failure
      // reports as a bare timeout instead of naming the element it wanted.
      testTimeout: 60_000,
      env: {
        VITE_SERVER_URL: "http://localhost:3001",
      },
    },
  }),
);
