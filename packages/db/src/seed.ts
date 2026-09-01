/**
 * Seed a handful of users for local development.
 *
 * Run: bun run db:seed
 */
import { getGeneratorsFunctions, reset, seed } from "drizzle-seed";

import { createDb } from "./index.ts";
import { user } from "./schema/auth.ts";

const schema = { user };

const SEED = 42;
const USER_COUNT = 8;

async function main() {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const db = createDb(databaseUrl);
  await reset(db, schema);

  const emailGen = getGeneratorsFunctions().email();
  emailGen.init({ count: USER_COUNT, seed: SEED });
  const emails = Array.from({ length: USER_COUNT }, () => emailGen.generate());
  await seed(db, schema, { count: USER_COUNT, seed: SEED }).refine((f) => ({
    user: {
      count: USER_COUNT,
      columns: {
        id: f.uuid(),
        name: f.fullName(),
        email: f.valuesFromArray({ values: emails, isUnique: true }),
        emailVerified: f.default({ defaultValue: false }),
        image: f.default({ defaultValue: null }),
        createdAt: f.timestamp(),
        updatedAt: f.timestamp(),
      },
    },
  }));

  console.log(`Seeded ${USER_COUNT} users.`);
  await db.$client.end();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
