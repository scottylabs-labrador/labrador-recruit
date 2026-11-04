import { createDb } from "@recruit/db";

import { env } from "../env.ts";

export const db = createDb(env.DATABASE_URL);

/**
 * A transaction handle.
 *
 * Named so services can require one in a signature. `enqueueNotification` does
 * exactly that: taking the handle is what makes it impossible to queue an email
 * outside the transaction whose success it depends on.
 */
export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
