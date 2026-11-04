/**
 * An in-process PostgreSQL for schema tests.
 *
 * PGlite runs real Postgres compiled to WASM, so a `CHECK`, a partial unique
 * index, and a composite foreign key all behave exactly as they will in
 * production. That is the whole point: these tests exist to prove the database
 * rejects a bad row, and a mock cannot prove that.
 *
 * Migrations are applied from `packages/db/drizzle`, so the tests run against
 * the SQL we actually ship rather than against the TypeScript schema. A
 * constraint that exists in `schema/` but was never generated into a migration
 * will fail here, which is the failure we want.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

const migrationsFolder = path.resolve(fileURLToPath(new URL("../drizzle", import.meta.url)));

const pglite = new PGlite();
export const db = drizzle({ client: pglite });

await migrate(db, { migrationsFolder });

/**
 * Empties every table between tests.
 *
 * Discovered from the catalogue rather than listed by hand. A hand-maintained
 * list is the thing somebody forgets when they add a table, and the symptom is
 * order-dependent failures in a suite nobody changed.
 */
export async function resetDb(): Promise<void> {
  const result = await db.execute<{ tablename: string }>(sql`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '__drizzle_migrations'
  `);
  const names = result.rows.map((row) => `"${row.tablename}"`).join(", ");
  if (names.length > 0) {
    await db.execute(sql.raw(`TRUNCATE TABLE ${names} CASCADE`));
  }
}

/**
 * Asserts that a write is refused by the database.
 *
 * Takes the SQLSTATE rather than a message, because messages are not a stable
 * contract and a test that matches on one breaks when Postgres rewords it.
 *
 * | code  | meaning |
 * | ----- | ------- |
 * | 23505 | unique violation |
 * | 23503 | foreign key violation (the referencing side) |
 * | 23001 | restrict violation (`ON DELETE RESTRICT` refusing a delete) |
 * | 23514 | check violation |
 * | 23502 | not-null violation |
 *
 * Note that 23503 and 23001 are not interchangeable. Inserting a child whose
 * parent is missing is 23503; deleting a parent a child still references under
 * `ON DELETE RESTRICT` is 23001. Expecting the wrong one passes for the wrong
 * reason or fails for no reason.
 */
export async function expectRejection(
  write: () => Promise<unknown>,
  sqlState: "23505" | "23503" | "23001" | "23514" | "23502",
): Promise<void> {
  try {
    await write();
  } catch (error) {
    const code =
      (error as { cause?: { code?: string }; code?: string }).cause?.code ??
      (error as { code?: string }).code;
    if (code !== sqlState) {
      throw new Error(`Expected SQLSTATE ${sqlState}, got ${String(code)}: ${String(error)}`);
    }
    return;
  }
  throw new Error(`Expected the database to reject this write with SQLSTATE ${sqlState}`);
}
