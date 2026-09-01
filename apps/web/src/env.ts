/** biome-ignore-all lint/style/useNamingConvention: environment variables are in SCREAMING_CASE */
import { z } from "zod";

// Define the schema as an object with all of the env
// variables and their types
const envSchema = z.object({
  VITE_SERVER_URL: z.url(),
  VITE_PUBLIC_POSTHOG_HOST: z.string().optional(),
  VITE_PUBLIC_POSTHOG_KEY: z.string().optional(),
});

// Validate `process.env` against our schema
// and return the result
const env = envSchema.parse(import.meta.env);

// Export the result so we can use it in the project
export { env };
