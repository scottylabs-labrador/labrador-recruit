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
      env: {
        VITE_SERVER_URL: "http://localhost:3001",
      },
    },
  }),
);
