import { defineConfig } from "drizzle-kit";

// Deliberately the owner-role connection, not the restricted app_runtime
// DATABASE_URL — tooling like `drizzle-kit studio` needs to see everything,
// unfiltered by RLS. Never used by application code; see db/client.ts.
const migrationsUrl = process.env.DATABASE_URL_MIGRATIONS;
if (!migrationsUrl) {
  throw new Error("DATABASE_URL_MIGRATIONS is not set — copy .env.example to .env.local and fill it in.");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dbCredentials: {
    url: migrationsUrl,
  },
});
