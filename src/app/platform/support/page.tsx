import Link from "next/link";
import { redirect } from "next/navigation";
import { PlatformAdminAccessError } from "@/db/platformSession";
import { getCurrentSupportAgent, listQueue, type SupportTicketStatus } from "@/db/supportDesk";
import { formatRelative } from "../../dashboard/support/ui";

const STATUS_LABEL: Record<SupportTicketStatus, string> = {
  new: "New",
  triaged: "Triaged",
  in_progress: "In progress",
  awaiting_customer: "Awaiting customer",
  resolved: "Resolved",
  closed: "Closed",
};

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

export default async function SupportQueuePage() {
  // Platform auth is app-managed, and the sign-in form lives on /platform —
  // so an unauthenticated visitor is sent there rather than shown an error.
  // This is the enforcement boundary, not the layout's hidden nav.
  try {
    await getCurrentSupportAgent();
  } catch (error) {
    if (error instanceof PlatformAdminAccessError) redirect("/platform");
    throw error;
  }

  const rows = await listQueue();
  const sorted = [...rows].sort(
    (a, b) => (PRIORITY_ORDER[a.ticket.priority] ?? 9) - (PRIORITY_ORDER[b.ticket.priority] ?? 9),
  );

  const unassigned = rows.filter((r) => !r.ticket.assignedToAdminId).length;
  const awaitingCustomer = rows.filter((r) => r.ticket.status === "awaiting_customer").length;
  const customers = new Set(rows.map((r) => r.ticket.tenantId)).size;

  return (
    <div className="flex flex-1 flex-col gap-5 p-6">
      <div>
        <h1 className="font-serif text-xl">Support queue</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {rows.length} open across {customers} customer{customers === 1 ? "" : "s"}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile n={rows.length} label="Open" />
        <Tile n={unassigned} label="Unassigned" accent={unassigned > 0 ? "bad" : undefined} />
        <Tile n={awaitingCustomer} label="Awaiting customer" />
        <Tile n={customers} label="Customers affected" />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
          Nothing open. Every ticket across every customer is resolved or closed.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-3xl text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-4 py-2.5 font-normal">Ref</th>
                <th className="px-4 py-2.5 font-normal">Customer</th>
                <th className="px-4 py-2.5 font-normal">Subject</th>
                <th className="px-4 py-2.5 font-normal">Type</th>
                <th className="px-4 py-2.5 font-normal">Priority</th>
                <th className="px-4 py-2.5 font-normal">Status</th>
                <th className="px-4 py-2.5 font-normal">Assignee</th>
                <th className="px-4 py-2.5 font-normal">Age</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(({ ticket, tenantName, tenantSlug, reporterName, assigneeName }) => (
                <tr key={ticket.id} className="border-b border-border last:border-b-0 hover:bg-accent/40">
                  <td className="px-4 py-3 font-mono text-xs whitespace-nowrap text-muted-foreground">
                    <Link href={`/platform/support/${ticket.id}`} className="hover:text-foreground">
                      {ticket.reference}
                    </Link>
                  </td>
                  {/* Customer is column two, never an afterthought — a support
                      agent's first question is always "who is this?" */}
                  <td className="px-4 py-3">
                    <span className="font-medium">{tenantName}</span>
                    <span className="block font-mono text-[11px] text-muted-foreground">{tenantSlug}</span>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/platform/support/${ticket.id}`} className="font-medium hover:underline">
                      {ticket.subject}
                    </Link>
                    <span className="block text-[11px] text-muted-foreground">{reporterName}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{ticket.type.replace("_", " ")}</td>
                  <td className="px-4 py-3 text-xs">
                    <span
                      className={
                        ticket.priority === "urgent"
                          ? "font-semibold text-destructive"
                          : "text-muted-foreground"
                      }
                    >
                      {ticket.priority}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs">{STATUS_LABEL[ticket.status as SupportTicketStatus]}</td>
                  <td className="px-4 py-3 text-xs">
                    {assigneeName ?? <span className="font-semibold text-destructive">Unassigned</span>}
                  </td>
                  <td className="px-4 py-3 text-xs tabular-nums whitespace-nowrap text-muted-foreground">
                    {formatRelative(ticket.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Tile({ n, label, accent }: { n: number; label: string; accent?: "bad" }) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-border bg-card p-3.5">
      <span
        className={`absolute inset-y-0 left-0 w-[3px] ${accent === "bad" ? "bg-destructive" : "bg-input"}`}
        aria-hidden="true"
      />
      <p className="text-2xl font-semibold tabular-nums">{n}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
