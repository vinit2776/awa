import type { db } from "./client";
import { roles } from "./schema";

// Matches §02's default role template. Tenants can rename display_name
// freely afterward — key is the stable identifier, never shown to users.
export const DEFAULT_ROLES = [
  { key: "requestor", displayName: "Requestor" },
  { key: "department_head", displayName: "Department head" },
  { key: "procurement_officer", displayName: "Procurement officer" },
  { key: "finance_approver", displayName: "Finance approver" },
  { key: "cfo_controller", displayName: "CFO / controller" },
  { key: "tenant_admin", displayName: "Tenant admin" },
] as const;

/**
 * Idempotent — safe to call on every tenant creation and safe to re-run
 * against a tenant that already has some or all of these roles (relies
 * on the unique(tenant_id, key) constraint from 0001_init.sql; ON
 * CONFLICT DO NOTHING with no target catches any unique violation).
 */
export async function seedDefaultRoles(tx: typeof db, tenantId: string) {
  await tx
    .insert(roles)
    .values(DEFAULT_ROLES.map((r) => ({ tenantId, key: r.key, displayName: r.displayName, isSystem: true })))
    .onConflictDoNothing();
}
