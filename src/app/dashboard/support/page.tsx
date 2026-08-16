import Link from "next/link";
import { customerStatusLabel, listTicketsForCustomer, type SupportTicketStatus } from "@/db/supportDesk";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { StatusPill, TypeTag, formatRelative } from "./ui";

export default async function SupportPage() {
  const { rows, viewerIsTenantAdmin } = await listTicketsForCustomer();

  return (
    <div className="flex flex-1 flex-col gap-5 p-6">
      <Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Support" }]} />

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-xl">Support</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {viewerIsTenantAdmin
              ? "Everything your organisation has raised with AWA."
              : "Bugs, feature requests and feedback you've raised with AWA."}
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Nothing raised yet. Use <span className="font-medium text-foreground">Help &amp; feedback</span> in the
            sidebar to report a bug, request a feature, or send us a note — from whichever page it&apos;s about.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-4 py-2.5 font-normal">Ref</th>
                <th className="px-4 py-2.5 font-normal">Subject</th>
                <th className="px-4 py-2.5 font-normal">Type</th>
                <th className="px-4 py-2.5 font-normal">Status</th>
                {viewerIsTenantAdmin && <th className="px-4 py-2.5 font-normal">Raised by</th>}
                <th className="px-4 py-2.5 font-normal">Last update</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ ticket, reporterName }) => (
                <tr key={ticket.id} className="border-b border-border last:border-b-0 hover:bg-accent/40">
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    <Link href={`/dashboard/support/${ticket.id}`} className="hover:text-foreground">
                      {ticket.reference}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/dashboard/support/${ticket.id}`} className="font-medium hover:underline">
                      {ticket.subject}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <TypeTag type={ticket.type} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill label={customerStatusLabel(ticket.status as SupportTicketStatus)} />
                  </td>
                  {viewerIsTenantAdmin && (
                    <td className="px-4 py-3 text-xs text-muted-foreground">{reporterName}</td>
                  )}
                  <td className="px-4 py-3 text-xs tabular-nums text-muted-foreground">
                    {formatRelative(ticket.updatedAt)}
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
