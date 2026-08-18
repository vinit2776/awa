import { and, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import { auditLog as auditLogTable, users as usersTable } from "@/db/schema";
import { ListControls, ListFilter } from "@/components/ui/list-controls";

const PAGE_SIZE = 100;

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; entityType?: string; q?: string; from?: string; to?: string }>;
}) {
  const { action, entityType, q: rawQ, from, to } = await searchParams;
  const q = typeof rawQ === "string" ? rawQ.trim() : "";
  const { tenant } = await getCurrentUserAndTenant();

  const [entries, tenantUsers, actions, entityTypes] = await withTenant(tenant.id, async (tx) => {
    // Search has to happen in SQL here, unlike the other admin lists: this
    // query is capped at PAGE_SIZE, so filtering the returned rows would
    // silently search only the most recent hundred and report "no matches"
    // for something that is plainly in the log.
    const actorIds = q
      ? (await tx.select({ id: usersTable.id }).from(usersTable).where(ilike(usersTable.fullName, `%${q}%`))).map((u) => u.id)
      : [];

    const searchCondition = q
      ? or(
          ...(actorIds.length ? [inArray(auditLogTable.actorUserId, actorIds)] : []),
          // The other thing anybody has to hand is the id of the record
          // they are asking about, so match that as text.
          sql`${auditLogTable.entityId}::text ilike ${`%${q}%`}`,
        )
      : undefined;

    return [
    await tx
      .select()
      .from(auditLogTable)
      .where(
        and(
          action ? eq(auditLogTable.action, action) : undefined,
          entityType ? eq(auditLogTable.entityType, entityType) : undefined,
          from ? gte(auditLogTable.occurredAt, new Date(from)) : undefined,
          // Inclusive of the whole "to" day, not midnight at its start —
          // a date range that silently excludes today is worse than none.
          to ? lte(auditLogTable.occurredAt, new Date(`${to}T23:59:59.999Z`)) : undefined,
          searchCondition,
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
    ] as const;
  });

  const actorName = (userId: string | null) => {
    if (!userId) return "System";
    return tenantUsers.find((u) => u.id === userId)?.fullName ?? userId;
  };

  const filtered = Boolean(action || entityType || q || from || to);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-serif text-lg text-foreground">Audit log</h1>
        <p className="text-sm text-muted-foreground">
          Every action taken in {tenant.name}, newest first — who did it, to what, and when.
          {entries.length === PAGE_SIZE && " Showing the most recent 100; narrow the filters to see further back."}
        </p>
      </div>

      <ListControls
        q={q}
        searchPlaceholder="Who did it, or a record ID…"
        searchMatches="the name of whoever performed the action, and the ID of the record it was performed on"
        clearHref={filtered ? "/dashboard/admin/audit" : undefined}
        count={entries.length}
      >
        <ListFilter
          name="action"
          label="Action"
          value={action ?? ""}
          options={[{ value: "", label: "All actions" }, ...actions.map((a) => ({ value: a.action, label: a.action }))]}
        />
        <ListFilter
          name="entityType"
          label="Entity type"
          value={entityType ?? ""}
          options={[
            { value: "", label: "All entity types" },
            ...entityTypes.map((e) => ({ value: e.entityType, label: e.entityType })),
          ]}
        />
        <div className="flex flex-col gap-1">
          <label htmlFor="from" className="text-xs text-muted-foreground">From</label>
          <input id="from" name="from" type="date" defaultValue={from ?? ""} className="h-8 rounded-md border px-2 text-sm" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="to" className="text-xs text-muted-foreground">To</label>
          <input id="to" name="to" type="date" defaultValue={to ?? ""} className="h-8 rounded-md border px-2 text-sm" />
        </div>
      </ListControls>

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
