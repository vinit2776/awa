import { and, desc, eq } from "drizzle-orm";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import { auditLog as auditLogTable, users as usersTable } from "@/db/schema";

const PAGE_SIZE = 100;

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; entityType?: string }>;
}) {
  const { action, entityType } = await searchParams;
  const { tenant } = await getCurrentUserAndTenant();

  const [entries, tenantUsers, actions, entityTypes] = await withTenant(tenant.id, async (tx) => [
    await tx
      .select()
      .from(auditLogTable)
      .where(
        and(
          action ? eq(auditLogTable.action, action) : undefined,
          entityType ? eq(auditLogTable.entityType, entityType) : undefined,
        ),
      )
      .orderBy(desc(auditLogTable.occurredAt))
      .limit(PAGE_SIZE),
    await tx.select().from(usersTable),
    await tx.selectDistinct({ action: auditLogTable.action }).from(auditLogTable).orderBy(auditLogTable.action),
    await tx
      .selectDistinct({ entityType: auditLogTable.entityType })
      .from(auditLogTable)
      .orderBy(auditLogTable.entityType),
  ]);

  const actorName = (userId: string | null) => {
    if (!userId) return "System";
    return tenantUsers.find((u) => u.id === userId)?.fullName ?? userId;
  };

  const filtered = Boolean(action || entityType);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-serif text-lg text-foreground">Audit log</h1>
        <p className="text-sm text-muted-foreground">
          Most recent {entries.length} action{entries.length === 1 ? "" : "s"} in {tenant.name}
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-2" action="/dashboard/admin/audit">
        <div className="flex flex-col gap-1">
          <label htmlFor="action" className="text-xs text-muted-foreground">Action</label>
          <select id="action" name="action" defaultValue={action ?? ""} className="h-8 rounded-md border px-2 text-sm">
            <option value="">All actions</option>
            {actions.map((a) => (
              <option key={a.action} value={a.action}>{a.action}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="entityType" className="text-xs text-muted-foreground">Entity type</label>
          <select
            id="entityType"
            name="entityType"
            defaultValue={entityType ?? ""}
            className="h-8 rounded-md border px-2 text-sm"
          >
            <option value="">All entity types</option>
            {entityTypes.map((e) => (
              <option key={e.entityType} value={e.entityType}>{e.entityType}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="h-8 rounded-md border px-3 text-sm">Filter</button>
        {filtered && (
          <a href="/dashboard/admin/audit" className="h-8 rounded-md border px-3 text-sm leading-8">
            Clear
          </a>
        )}
      </form>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-2 font-normal">When</th>
            <th className="py-2 font-normal">Actor</th>
            <th className="py-2 font-normal">Action</th>
            <th className="py-2 font-normal">Entity</th>
            <th className="py-2 font-normal">Details</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="border-b align-top">
              <td className="py-2 whitespace-nowrap text-muted-foreground">
                {e.occurredAt.toLocaleString()}
              </td>
              <td className="py-2 whitespace-nowrap">{actorName(e.actorUserId)}</td>
              <td className="py-2 font-mono text-xs">{e.action}</td>
              <td className="py-2 whitespace-nowrap text-muted-foreground">
                {e.entityType} <span className="font-mono text-xs">{e.entityId}</span>
              </td>
              <td className="py-2 font-mono text-xs text-muted-foreground">
                {Object.keys(e.metadata as Record<string, unknown>).length > 0
                  ? JSON.stringify(e.metadata)
                  : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {entries.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {filtered ? "No actions match this filter." : "No actions recorded yet."}
        </p>
      )}

      {entries.length === PAGE_SIZE && (
        <p className="text-xs text-muted-foreground">
          Showing the {PAGE_SIZE} most recent entries only.
        </p>
      )}
    </div>
  );
}
