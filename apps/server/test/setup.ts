import { beforeEach, vi } from "vitest";

/**
 * Seeds the environment before any module that validates it is imported.
 *
 * `src/env.ts` parses `process.env` at module load and throws on a missing
 * variable, so a suite that imports the app transitively needs these present
 * before the first import rather than before the first test.
 */
process.env["ADMIN_GROUP"] ??= "test-admins";
process.env["ALLOWED_ORIGINS_REGEX"] ??= ".*";
process.env["AUTH_ISSUER"] ??= "https://auth.example.com";
process.env["AUTH_CLIENT_ID"] ??= "test-client-id";
process.env["AUTH_CLIENT_SECRET"] ??= "test-client-secret";
process.env["AUTH_JWKS_URI"] ??= "https://auth.example.com/.well-known/jwks.json";
process.env["BETTER_AUTH_URL"] ??= "https://auth.example.com";
process.env["BETTER_AUTH_SECRET"] ??= "test-secret-not-used-outside-this-suite";
process.env["DATABASE_URL"] ??= "postgres://localhost:5432/test";
process.env["SERVER_URL"] ??= "https://api.example.com";

/**
 * Points the server's db at the in-process one.
 *
 * Mocked rather than injected, because `lib/db.ts` is imported for its side
 * effect of creating a pool from `DATABASE_URL`, and a test suite should not
 * open a socket to discover that.
 */
vi.mock("../src/lib/db.ts", async () => {
  const { testDb } = await import("./harness.ts");
  return { db: testDb };
});

/**
 * Serves the suite's own public key instead of reaching the identity provider.
 *
 * `AUTH_JWKS_URI` points at a host that does not resolve, so without this every
 * authenticated request would hang until the HTTP client gave up. The tokens the
 * suite mints are genuinely signed and genuinely verified — only the key
 * delivery is local.
 */
vi.mock("jwks-rsa", async () => {
  const { publicKeyPem } = await import("./keys.ts");
  return {
    default: () => ({
      getSigningKey: (
        _kid: string | undefined,
        cb: (err: Error | null, key?: { getPublicKey: () => string }) => void,
      ) => {
        cb(null, { getPublicKey: () => publicKeyPem });
      },
    }),
  };
});

beforeEach(async () => {
  const { resetDb } = await import("./harness.ts");
  await resetDb();
});
