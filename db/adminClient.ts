import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// The table-OWNER connection. RLS does NOT apply to it — use only for the
// one case where that's inherent to the operation, not a shortcut: JIT
// identity linking (db/tenant.ts), which by definition runs before we know
// which tenant's RLS scope even applies. Nothing else in application code
// should import this. Everything post-authentication uses db/client.ts.
if (!process.env.DATABASE_URL_MIGRATIONS) {
  throw new Error("DATABASE_URL_MIGRATIONS is not set");
}

const client = postgres(process.env.DATABASE_URL_MIGRATIONS, { prepare: false });

export const adminDb = drizzle(client, { schema });
