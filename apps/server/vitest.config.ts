import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],

    /*
     * One file at a time, in one worker.
     *
     * Every file that touches the database boots its own PGlite and runs every
     * migration. Five of those in parallel workers exhausted the machine and the
     * workers died with "Worker exited unexpectedly" — which reports as five
     * errors and no tests, so it reads like the suite is broken rather than
     * starved.
     *
     * Serialising costs wall-clock and buys a suite that does not fall over as
     * it grows, which matters because it is still growing.
     */
    fileParallelism: false,

    // PGlite boots and migrates once per file, and Windows needs the room.
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
