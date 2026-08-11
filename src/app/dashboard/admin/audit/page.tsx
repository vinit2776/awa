import { desc } from "drizzle-orm";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import { auditLog as auditLogTable, users as usersTable } from "@/db/schema";

const PAGE_SIZE = 100;

export default async function AuditLogPage() {
  const { tenant } = await getCurrentUserAndTenant();

  const [entries, tenantUsers] = await withTenant(tenant.id, async (tx) => [
    await tx.select().from(auditLogTable).orderBy(desc(auditLogTable.occurredAt)).limit(PAGE_SIZE),
    await tx.select().from(usersTable),
  ]);

  const actorName = (userId: string | null) => {
    if (!userId) return "System";
    return tenantUsers.find((u) => u.id === userId)?.fullName ?? userId;
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-serif text-lg text-foreground">Audit log</h1>
        <p className="text-sm text-muted-foreground">
          Most recent {entries.length} action{entries.length === 1 ? "" : "s"} in {tenant.name}
        </p>
      </div>

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
        <p className="text-sm text-muted-foreground">No actions recorded yet.</p>
      )}

      {entries.length === PAGE_SIZE && (
        <p className="text-xs text-muted-foreground">
          Showing the {PAGE_SIZE} most recent entries only.
        </p>
      )}
    </div>
  );
}
