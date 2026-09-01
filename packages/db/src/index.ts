import { drizzle } from "drizzle-orm/node-postgres";

export function createDb(databaseUrl: string) {
  return drizzle(databaseUrl);
}

export type Database = ReturnType<typeof createDb>;
