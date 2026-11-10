/**
 * An in-process PostgreSQL for API tests.
 *
 * Runs the real migrations from `packages/db/drizzle`, so a schema mistake
 * surfaces here rather than at deploy time, and a constraint behaves exactly as
 * it will in production.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

const migrationsFolder = path.resolve(
  fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)),
);

const pglite = new PGlite();
export const testDb = drizzle({ client: pglite });

await migrate(testDb, { migrationsFolder });

/**
 * Empties every table, discovered from the catalogue.
 *
 * A hand-maintained list is the thing somebody forgets when they add a table,
 * and the symptom is order-dependent failures in a suite nobody changed.
 */
export async function resetDb(): Promise<void> {
  const result = await testDb.execute<{ tablename: string }>(sql`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '__drizzle_migrations'
  `);
  const names = result.rows.map((row) => `"${row.tablename}"`).join(", ");
  if (names.length > 0) {
    await testDb.execute(sql.raw(`TRUNCATE TABLE ${names} CASCADE`));
  }
}
