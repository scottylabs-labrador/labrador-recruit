import { beforeEach, vi } from "vitest";

/** Seeds env vars before app modules that validate process.env are imported. */
process.env["ADMIN_GROUP"] ??= "test-admins";
process.env["ALLOWED_ORIGINS_REGEX"] ??= ".*";
process.env["AUTH_ISSUER"] ??= "https://auth.example.com";
process.env["AUTH_CLIENT_ID"] ??= "test-client-id";
process.env["AUTH_CLIENT_SECRET"] ??= "test-client-secret";
process.env["AUTH_JWKS_URI"] ??= "https://auth.example.com/.well-known/jwks.json";
process.env["BETTER_AUTH_URL"] ??= "https://auth.example.com";
process.env["DATABASE_URL"] ??= "postgres://localhost:5432/test";
process.env["SERVER_URL"] ??= "https://api.example.com";

vi.mock("../src/lib/db.ts", async () => {
  const { testDb } = await import("./harness.ts");
  return { db: testDb };
});

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
