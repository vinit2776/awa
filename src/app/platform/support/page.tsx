import Link from "next/link";
import { redirect } from "next/navigation";
import { PlatformAdminAccessError } from "@/db/platformSession";
import { getCurrentSupportAgent, listQueue, slaState, type SupportTicketStatus } from "@/db/supportDesk";
import { cn } from "@/lib/utils";
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
  const now = new Date();
  // SLA state is computed here, never read from a column — see the plan's §8.
  const withSla = rows.map((r) => ({ ...r, sla: slaState(r.ticket, now) }));

  // Breached first, then closest to breaching, then by priority. Time-to-breach
  // is what decides who to pick up next; priority only breaks ties, since it
  // already shaped the due date.
  const sorted = [...withSla].sort((a, b) => {
    const aBreach = a.sla.resolutionBreached || a.sla.firstResponseBreached;
    const bBreach = b.sla.resolutionBreached || b.sla.firstResponseBreached;
    if (aBreach !== bBreach) return aBreach ? -1 : 1;

    const aMins = a.sla.minutesToResolution;
    const bMins = b.sla.minutesToResolution;
    // No target (feature requests) and paused clocks sink below anything ticking.
    if (aMins === null && bMins !== null) return 1;
    if (bMins === null && aMins !== null) return -1;
    if (aMins !== null && bMins !== null && aMins !== bMins) return aMins - bMins;

    return (PRIORITY_ORDER[a.ticket.priority] ?? 9) - (PRIORITY_ORDER[b.ticket.priority] ?? 9);
  });

  const unassigned = rows.filter((r) => !r.ticket.assignedToAdminId).length;
  const breached = withSla.filter((r) => r.sla.resolutionBreached || r.sla.firstResponseBreached).length;
  const dueSoon = withSla.filter(
    (r) => !r.sla.resolutionBreached && r.sla.minutesToResolution !== null && r.sla.minutesToResolution <= 120,
  ).length;
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
        <Tile n={dueSoon} label="Due within 2h" accent={dueSoon > 0 ? "warn" : undefined} />
        <Tile n={breached} label="Breached" accent={breached > 0 ? "bad" : undefined} />
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
                <th className="px-4 py-2.5 font-normal">Resolution SLA</th>
                <th className="px-4 py-2.5 font-normal">Age</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(({ ticket, tenantName, tenantSlug, reporterName, assigneeName, sla }) => (
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
                  <td className="px-4 py-3 whitespace-nowrap">
                    <SlaCell sla={sla} />
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

function Tile({ n, label, accent }: { n: number; label: string; accent?: "bad" | "warn" }) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-border bg-card p-3.5">
      <span
        className={`absolute inset-y-0 left-0 w-[3px] ${accent === "bad" ? "bg-destructive" : accent === "warn" ? "bg-warning" : "bg-input"}`}
        aria-hidden="true"
      />
      <p className="text-2xl font-semibold tabular-nums">{n}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

/**
 * Breach reads as negative time rather than a badge: how far past tells an
 * agent who to pick up first, which a badge doesn't. A paused clock says so
 * explicitly — otherwise a ticket sitting on the customer looks neglected.
 */
function SlaCell({ sla }: { sla: ReturnType<typeof slaState> }) {
  if (sla.paused) {
    return <span className="font-mono text-xs text-muted-foreground">paused</span>;
  }
  if (sla.resolutionDueAt === null) {
    return <span className="font-mono text-xs text-muted-foreground">no target</span>;
  }

  const mins = sla.minutesToResolution ?? 0;
  const overdue = mins < 0;
  const abs = Math.abs(mins);
  const label = abs >= 1440
    ? `${Math.floor(abs / 1440)}d ${Math.floor((abs % 1440) / 60)}h`
    : abs >= 60
      ? `${Math.floor(abs / 60)}h ${abs % 60}m`
      : `${abs}m`;

  return (
    <span
      className={cn(
        "font-mono text-xs tabular-nums",
        overdue ? "font-semibold text-destructive" : abs <= 120 ? "text-warning-foreground" : "text-success",
      )}
    >
      {overdue ? `−${label}` : label}
    </span>
  );
}
