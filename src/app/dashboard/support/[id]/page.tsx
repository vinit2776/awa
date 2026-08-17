import Link from "next/link";
import { notFound } from "next/navigation";
import { Paperclip } from "lucide-react";
import { customerStatusLabel, getTicketForCustomer, type SupportTicketStatus } from "@/db/supportDesk";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { StatusPill, TypeTag, formatDateTime } from "../ui";
import { confirmTicketResolved, escalateTicket, reopenTicketAction, replyToTicket } from "../actions";

export default async function SupportTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getTicketForCustomer(id);
  if (!data) notFound();

  const { ticket, messages, attachments, reporterName } = data;
  const label = customerStatusLabel(ticket.status as SupportTicketStatus);
  const isClosed = ticket.status === "closed";

  return (
    <div className="flex flex-1 flex-col gap-5 p-6">
      <Breadcrumbs
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Support", href: "/dashboard/support" },
          { label: ticket.reference },
        ]}
      />

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-xl">{ticket.subject}</h1>
          <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono">{ticket.reference}</span>
            <TypeTag type={ticket.type} />
            <span>raised {formatDateTime(ticket.createdAt)}</span>
          </p>
        </div>
        <StatusPill label={label} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
        <div className="flex flex-col gap-3">
          {/* The opening report, then the thread. Only visibility='customer'
              messages reach this page — a support_only note is filtered out in
              getTicketForCustomer and cannot be authored by a customer at all. */}
          <article className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
            <header className="flex items-center gap-2 text-sm">
              <span className="font-medium">{reporterName}</span>
              <time className="ml-auto text-xs text-muted-foreground">{formatDateTime(ticket.createdAt)}</time>
            </header>
            <p className="text-sm whitespace-pre-wrap">{ticket.description}</p>
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {attachments.map((a) => (
                  <a
                    key={a.id}
                    href={`/api/support/attachments/${a.id}`}
                    className="flex items-center gap-1.5 rounded-md border border-input px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <Paperclip className="size-3" />
                    {a.fileName}
                  </a>
                ))}
              </div>
            )}
          </article>

          {messages.map(({ message, authorName }) => {
            const fromSupport = message.authorPlatformAdminId !== null;
            return (
              <article
                key={message.id}
                className={cn(
                  "flex flex-col gap-2 rounded-lg border border-border p-4",
                  fromSupport ? "bg-background" : "bg-card",
                )}
              >
                <header className="flex items-center gap-2 text-sm">
                  {/* Deliberately not the agent's name. Reassignment is routine
                      on the platform side and shouldn't read to a customer as
                      being passed around. */}
                  <span className="font-medium">{fromSupport ? "AWA Support" : (authorName ?? "You")}</span>
                  {message.isQuestion && (
                    <span className="rounded bg-warning/20 px-1.5 py-0.5 text-xs text-warning-foreground">
                      Question
                    </span>
                  )}
                  <time className="ml-auto text-xs text-muted-foreground">
                    {formatDateTime(message.createdAt)}
                  </time>
                </header>
                <p className="text-sm whitespace-pre-wrap">{message.body}</p>
              </article>
            );
          })}

          {ticket.status === "resolved" && (
            <div className="flex flex-col gap-3 rounded-lg border border-success/40 bg-success/5 p-4">
              <div>
                <p className="text-sm font-medium">Support marked this resolved</p>
                {ticket.resolutionSummary && (
                  <p className="mt-1 text-sm whitespace-pre-wrap text-muted-foreground">
                    {ticket.resolutionSummary}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <form action={confirmTicketResolved}>
                  <input type="hidden" name="ticketId" value={ticket.id} />
                  <button type="submit" className={cn(buttonVariants({ size: "sm" }))}>
                    That&apos;s sorted — close it
                  </button>
                </form>
                <form action={reopenTicketAction} className="flex flex-1 items-center gap-2">
                  <input type="hidden" name="ticketId" value={ticket.id} />
                  <input
                    name="reason"
                    required
                    placeholder="Still not right? Say what's outstanding"
                    className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <button type="submit" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                    Reopen
                  </button>
                </form>
              </div>
            </div>
          )}

          {!isClosed && ticket.status !== "resolved" && (
            <form action={replyToTicket} className="flex flex-col gap-2 rounded-lg border border-input bg-card p-4">
              <input type="hidden" name="ticketId" value={ticket.id} />
              <textarea
                name="body"
                required
                rows={3}
                placeholder="Write a reply…"
                className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <div className="flex justify-end">
                <button type="submit" className={cn(buttonVariants({ size: "sm" }))}>
                  Send reply
                </button>
              </div>
            </form>
          )}

          {!isClosed && ticket.status !== "resolved" && (
            ticket.customerEscalatedAt ? (
              <p className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs text-muted-foreground">
                You escalated this on {formatDateTime(ticket.customerEscalatedAt)}. AWA&apos;s senior support has
                been notified.
              </p>
            ) : (
              <details className="rounded-lg border border-dashed border-input">
                <summary className="cursor-pointer px-3.5 py-2.5 text-sm font-medium">
                  Not moving fast enough? Escalate it
                </summary>
                <form action={escalateTicket} className="flex flex-col gap-2 border-t border-border p-3.5">
                  <input type="hidden" name="ticketId" value={ticket.id} />
                  <p className="text-xs text-muted-foreground">
                    This flags the ticket to AWA&apos;s senior support. You can do it once.
                  </p>
                  <input
                    name="reason"
                    required
                    placeholder="What's changed — why is this urgent now?"
                    className="rounded-lg border border-input bg-background px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <div className="flex justify-end">
                    <button type="submit" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                      Escalate
                    </button>
                  </div>
                </form>
              </details>
            )
          )}

          {isClosed && (
            <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
              This ticket is closed. If it comes back, raise a new one and mention {ticket.reference}.
            </p>
          )}
        </div>

        <aside className="flex flex-col gap-3">
          <div className="rounded-lg border border-border bg-card">
            <h2 className="border-b border-border px-4 py-2.5 text-xs uppercase tracking-wide text-muted-foreground">
              Details
            </h2>
            <dl className="flex flex-col gap-3 p-4 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Status</dt>
                <dd className="font-medium">{label}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Raised by</dt>
                <dd className="font-medium">{reporterName}</dd>
              </div>
              {ticket.pagePath && (
                <div>
                  <dt className="text-xs text-muted-foreground">Reported from</dt>
                  <dd>
                    <Link href={ticket.pagePath} className="font-medium text-primary hover:underline">
                      {ticket.pagePath}
                    </Link>
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-muted-foreground">Handled by</dt>
                <dd className="font-medium">AWA Support</dd>
              </div>
            </dl>
          </div>
        </aside>
      </div>
    </div>
  );
}
