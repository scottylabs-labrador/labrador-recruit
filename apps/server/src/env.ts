/** biome-ignore-all lint/style/useNamingConvention: environment variables are in SCREAMING_CASE */
import { z } from "zod";

// Define the schema as an object with all of the env variables and their types
const envSchema = z.object({
  ADMIN_GROUP: z.string(),
  ALLOWED_ORIGINS_REGEX: z.string(),
  AUTH_ISSUER: z.url(),
  AUTH_CLIENT_ID: z.string(),
  AUTH_CLIENT_SECRET: z.string(),
  AUTH_JWKS_URI: z.url(),
  BETTER_AUTH_URL: z.url(), // https://www.better-auth.com/docs/installation#set-environment-variables
  DATABASE_URL: z.string(),
  SENTRY_DSN: z.string().optional(),
  SERVER_URL: z.url(),
  SERVER_PORT: z.coerce.number().default(80),
});

// Validate `process.env` against our schema and return the result
const env = envSchema.parse(process.env);

// Export the result so we can use it in the project
export { env };
