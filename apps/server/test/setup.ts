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
