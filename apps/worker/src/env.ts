/** biome-ignore-all lint/style/useNamingConvention: environment variables are in SCREAMING_CASE */
import process from "node:process";

import { z } from "zod";

/**
 * Validated at module load, so a missing variable kills the process at boot
 * rather than at the moment it tries to send somebody's decision email.
 */
const envSchema = z.object({
  DATABASE_URL: z.string(),
  /**
   * Credential for the transactional email provider.
   *
   * Optional on purpose: unset means notifications are claimed and logged
   * instead of sent, which is what a local run wants. A deployment without it
   * will drain the outbox into the void, so set it there.
   */
  EMAIL_PROVIDER_API_KEY: z.string().optional(),
  EMAIL_FROM_ADDRESS: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
});

const env = envSchema.parse(process.env);

export { env };
