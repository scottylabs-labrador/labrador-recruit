/**
 * Runs the development seed against whatever `DATABASE_URL` points at.
 *
 * Deliberately a script rather than an endpoint. It truncates every table, and
 * a deployment that could be made to do that over HTTP would be one
 * misconfiguration away from erasing a live cycle.
 */
import process from "node:process";

import { createDb } from "./index.ts";
import { seedDevelopmentData } from "./seed.ts";

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

if (/\b(prod|production)\b/.test(databaseUrl)) {
  // A refusal rather than a prompt: this is run from a terminal, often from
  // muscle memory, and the cost of being wrong is every row in the cycle.
  throw new Error(
    "DATABASE_URL looks like a production database. The seed truncates every table; refusing.",
  );
}

const db = createDb(databaseUrl);
await seedDevelopmentData(db);
console.log("Seeded one open cycle, 2 committees, 12 applicants, and their reviews.");
await db.$client.end();
