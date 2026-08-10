import { sql } from "drizzle-orm";
import { db } from "./client";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The critical-path piece from §13/§14: every tenant-scoped query in the
 * app must run inside a transaction that has set `app.tenant_id` for that
 * transaction's duration — that's what the RLS policies from 0001_init.sql
 * actually check. Forgetting this wrapper isn't a style violation, it's
 * the isolation model not applying at all.
 *
 * `SET LOCAL` cannot take a bound parameter in Postgres's extended query
 * protocol — the value has to be a literal. The UUID regex check is what
 * makes that safe: the character set has no quotes or statement
 * terminators in it, so a string that passes the check cannot break out
 * of the literal, regardless of where tenantId originally came from.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (tx: typeof db) => Promise<T>,
): Promise<T> {
  if (!UUID_RE.test(tenantId)) {
    throw new Error(`withTenant: "${tenantId}" is not a valid tenant id`);
  }

  return db.transaction(async (tx) => {
    await tx.execute(sql.raw(`set local app.tenant_id = '${tenantId}'`));
    return fn(tx as unknown as typeof db);
  });
}
