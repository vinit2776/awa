import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

// Pooled (Supavisor transaction-mode) connection, as the restricted
// app_runtime role — RLS applies to it in full, unlike the table-owner
// role migrations run as (DATABASE_URL_MIGRATIONS, drizzle.config.ts only).
// Safe for serverless: one connection per request, no prepared statements
// carried across invocations.
const client = postgres(process.env.DATABASE_URL, { prepare: false });

export const db = drizzle(client, { schema });
