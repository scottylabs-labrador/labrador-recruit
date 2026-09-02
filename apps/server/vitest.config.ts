import { defineConfig } from "vitest/config";

/**
 * Two projects, because most of the import layer is pure.
 *
 * `test/setup.ts` boots PGlite and runs every migration before the first hook.
 * Applying it globally made the parsing tests - which never touch a database -
 * wait on that boot, and on Windows that was enough to blow the default 10s
 * hook timeout. Splitting keeps the pure tests fast and honest about their
 * dependencies.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["test/import/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "integration",
          include: ["test/**/*.test.ts"],
          exclude: ["test/import/**"],
          setupFiles: ["test/setup.ts"],
          // PGlite boots and migrates once per worker; Windows needs the room.
          hookTimeout: 30_000,
          // Several of these drive a whole import end to end, twice, against an
          // in-process database. The 5s default was enough on an idle machine
          // and not enough on a loaded one, so the suite failed on timing
          // rather than on behaviour - the least useful kind of red.
          testTimeout: 30_000,
        },
      },
    ],
  },
});
