export default {
  // https://stackoverflow.com/questions/79470698/with-syncpack-on-a-turborepo-how-to-set-app-version-dependencies-through-a-packa/79477388#79477388
  versionGroups: [
    {
      label: "use workspace protocol for local dependencies",
      packages: ["**"],
      dependencies: ["$LOCAL"],
      dependencyTypes: ["!local"],
      pinVersion: "workspace:*",
    },
  ],
  // https://jamiemason.github.io/syncpack/semver-groups/
  semverGroups: [
    {
      // We would not want new errors to appear in our codebase from unintended Oxlint upgrades.
      // Reference: https://oxc.rs/docs/guide/usage/linter/versioning.html#what-to-expect-from-new-versions
      dependencies: ["oxlint"],
      dependencyTypes: ["dev"],
      range: "~",
    },
    {
      // "highly recommended to save the exact version" - https://biomejs.dev/internals/versioning/
      dependencies: ["@biomejs/biome"],
      dependencyTypes: ["dev"],
      range: "",
    },
    {
      dependencyTypes: ["prod", "resolutions", "overrides", "pnpmOverrides", "local"],
      range: "^",
    },
    {
      dependencyTypes: ["dev"],
      range: "^",
    },
    {
      dependencyTypes: ["peer"],
      range: "^",
    },
  ],
} satisfies import("syncpack").RcFile;
