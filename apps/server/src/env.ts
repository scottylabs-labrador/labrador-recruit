/** biome-ignore-all lint/style/useNamingConvention: environment variables are in SCREAMING_CASE */
import { z } from "zod";

// Define the schema as an object with all of the env variables and their types
const envSchema = z.object({
  ADMIN_GROUP: z.string(),
  ALLOWED_ORIGINS_REGEX: z.string(),
  AUTH_ISSUER: z.url(),
  AUTH_CLIENT_ID: z.string(),
  AUTH_CLIENT_SECRET: z.string(),
  /**
   * Goldador groups whose members may sign in, comma-separated.
   *
   * `ADMIN_GROUP` is always allowed on top of this, so an administrator
   * cannot be locked out by an empty or mistyped list. Defaults to empty
   * because a deployment with no identity provider never consults it.
   */
  AUTH_ALLOWED_GROUPS: z.string().default(""),
  AUTH_JWKS_URI: z.url(),
  /**
   * Whether an Andrew ID and password can be used to sign in.
   *
   * "auto" - the default - means "only while there is no identity
   * provider", so the cutover to single sign-on needs no second variable
   * changed and cannot be half-done. "on" and "off" force it either way,
   * which is what lets the tests exercise both doors against one
   * configured client id.
   */
  PASSWORD_SIGN_IN: z.enum(["auto", "on", "off"]).default("auto"),
  BETTER_AUTH_URL: z.url(), // https://www.better-auth.com/docs/installation#set-environment-variables
  DATABASE_URL: z.string(),
  /**
   * The whole Google service-account key JSON, for reading a cycle's sheet.
   *
   * Optional: a deployment that only ever imports uploaded files needs no
   * Google credentials at all, and the sync endpoint says so rather than
   * failing at boot.
   */
  GOOGLE_SERVICE_ACCOUNT_KEY: z.string().optional(),
  /**
   * How often to pull each cycle's sheet, in minutes. Unset means never.
   *
   * The pull only ever stages a preview, so a schedule cannot change applicant
   * data on its own - an admin still commits.
   */
  SHEET_SYNC_INTERVAL_MINUTES: z.coerce.number().int().positive().optional(),
  /**
   * Whether to fetch verbatim GitHub facts for applicants who supplied a link.
   *
   * Off unless explicitly "on". Fetching an applicant-provided link at all is a
   * carve-out from `docs/product-rules.md` §1, so a deployment opts in rather
   * than inheriting it.
   */
  GITHUB_ENRICHMENT: z.enum(["on", "off"]).default("off"),
  SENTRY_DSN: z.string().optional(),
  SERVER_URL: z.url(),
  SERVER_PORT: z.coerce.number().default(80),
});

// Validate `process.env` against our schema and return the result
const env = envSchema.parse(process.env);

// Export the result so we can use it in the project
export { env };
