// https://orm.drizzle.team/docs/get-started/postgresql-new#step-5---setup-drizzle-config-file
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle",
  schema: "./src/schema",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env["DATABASE_URL"] as string,
    // SSL must be `require` since Railway uses self-signed certificates.
    ssl: "require",
  },
});
