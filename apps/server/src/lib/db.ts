import { createDb } from "@labrador/db";

import { env } from "../env.ts";

export const db = createDb(env.DATABASE_URL);
