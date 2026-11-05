import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // One PGlite instance is shared across a file; parallel files would each
    // build their own and the migration run dominates the cost.
    fileParallelism: false,
  },
});
