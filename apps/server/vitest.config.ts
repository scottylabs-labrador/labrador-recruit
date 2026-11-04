import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    // PGlite boots and migrates once per worker where a suite needs it, and
    // Windows needs the room.
    hookTimeout: 30_000,
  },
});
