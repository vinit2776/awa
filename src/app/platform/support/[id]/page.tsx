import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Paperclip } from "lucide-react";
import { PlatformAdminAccessError } from "@/db/platformSession";
import { getCurrentSupportAgent, getTicketForSupport, listSavedReplies, slaState } from "@/db/supportDesk";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDateTime } from "../../../dashboard/support/ui";
import { assign, changePriority, replyAsSupport, resolve } from "../actions";
import { SavedReplyPicker } from "./SavedReplyPicker";

const OUTCOMES = [
  { value: "fixed", label: "Fixed" },
  { value: "shipped", label: "Shipped" },
  { value: "wont_do", label: "Won't do" },
  { value: "duplicate", label: "Duplicate" },
  { value: "not_a_bug", label: "Not a bug" },
  { value: "no_response", label: "No response" },
];

export default async function SupportTicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  try {
    await getCurrentSupportAgent();
  } catch (error) {
    if (error instanceof PlatformAdminAccessError) redirect("/platform");
    throw error;
  }
  const { id } = await params;
  const data = await getTicketForSupport(id);
  if (!data) notFound();

  const { ticket, tenantName, tenantSlug, tenantStatus, reporterName, reporterEmail, messages, attachments, events, assignees } =
    data;
  const sla = slaState(ticket);
  const savedReplies = await listSavedReplies(ticket.type);

  return (
    <div className="flex flex-1 flex-col gap-5 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/platform/support" className="text-xs text-muted-foreground hover:text-foreground">
            ← Support queue
          </Link>
          <h1 className="mt-1 font-serif text-xl">{ticket.subject}</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            <span className="font-mono">{ticket.reference}</span> · {ticket.type.replace("_", " ")} ·{" "}
            {ticket.priority} · raised {formatDateTime(ticket.createdAt)}
          </p>
        </div>
      </div>

      {/* Organisation and reporter are joined live, so a renamed department
          shows current truth. Environment is the snapshot taken at report time,
          because it is a historical fact about when the bug happened — joining
          it would show the browser they are using now. */}
      <div className="grid gap-0 overflow-hidden rounded-lg border border-border bg-card sm:grid-cols-3">
        <div className="flex flex-col gap-2 p-4">
          <h2 className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            Organisation <span className="text-primary">· live</span>
          </h2>
          <p className="text-sm font-semibold">{tenantName}</p>
          <p className="font-mono text-xs text-muted-foreground">{tenantSlug}</p>
          <span className="w-fit rounded border border-input px-1.5 py-0.5 text-xs text-muted-foreground">
            {tenantStatus}
          </span>
        </div>
        <div className="flex flex-col gap-2 border-border p-4 sm:border-l">
          <h2 className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            Reporter <span className="text-primary">· live</span>
          </h2>
          <p className="text-sm font-semibold">{reporterName}</p>
          <p className="text-xs text-muted-foreground">{reporterEmail}</p>
        </div>
        <div className="flex flex-col gap-2 border-border p-4 sm:border-l">
          <h2 className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            Environment · snapshot
          </h2>
          <p className="font-mono text-xs text-muted-foreground">{ticket.pagePath ?? "—"}</p>
          <p className="text-xs text-muted-foreground">{ticket.userAgent ?? "—"}</p>
          <p className="text-xs text-muted-foreground">
            {ticket.viewport ?? "—"} · {ticket.appVersion ?? "—"}
          </p>
        </div>
      </div>

      {ticket.consoleErrors && ticket.consoleErrors.length > 0 && (
        <details className="rounded-lg border border-border bg-card">
          <summary className="cursor-pointer px-4 py-2.5 text-xs uppercase tracking-wide text-muted-foreground">
            Browser errors at report time · {ticket.consoleErrors.length}
          </summary>
          <ol className="flex flex-col gap-2 border-t border-border p-4">
            {ticket.consoleErrors.map((entry, i) => (
              <li key={i} className="flex flex-col gap-0.5">
                <code className="font-mono text-xs break-words">{entry.message}</code>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {[entry.source, entry.line ? `line ${entry.line}` : null, entry.at].filter(Boolean).join(" · ")}
                </span>
              </li>
            ))}
          </ol>
        </details>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div className="flex flex-col gap-3">
          <article className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
            <header className="flex items-center gap-2 text-sm">
              <span className="font-medium">{reporterName}</span>
              <span className="text-xs text-muted-foreground">customer</span>
              <time className="ml-auto text-xs text-muted-foreground">{formatDateTime(ticket.createdAt)}</time>
            </header>
            <p className="text-sm whitespace-pre-wrap">{ticket.description}</p>
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {attachments.map((a) => (
                  <span
                    key={a.id}
                    className="flex items-center gap-1.5 rounded-md border border-input px-2 py-1 text-xs text-muted-foreground"
                  >
                    <Paperclip className="size-3" />
                    {a.fileName}
                  </span>
                ))}
              </div>
            )}
          </article>

          {messages.map(({ message, customerAuthorName, supportAuthorName }) => {
            const supportOnly = message.visibility === "support_only";
            return (
              <article
                key={message.id}
                className={cn(
                  "flex flex-col gap-2 rounded-lg border p-4",
                  supportOnly
                    ? "border-warning/40 border-l-[3px] border-l-warning bg-warning/5"
                    : "border-border bg-background",
                )}
              >
                <header className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{supportAuthorName ?? customerAuthorName ?? "Unknown"}</span>
                  {/* Names the excluded party, not a generic "internal" — with
                      three participant classes, "internal" doesn't say to whom. */}
                  {supportOnly && (
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-warning-foreground">
                      Support only — {tenantName} cannot see this
                    </span>
                  )}
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

          {ticket.status !== "closed" && (
            <div className="rounded-lg border border-input bg-card">
              <form action={replyAsSupport} className="flex flex-col gap-3 p-4">
                <input type="hidden" name="ticketId" value={ticket.id} />
                <div className="flex items-center gap-4 text-sm">
                  <label className="flex items-center gap-1.5">
                    <input type="radio" name="visibility" value="customer" defaultChecked />
                    Reply to {tenantName}
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input type="radio" name="visibility" value="support_only" />
                    Support-only note
                  </label>
                </div>
                <SavedReplyPicker
                  replies={savedReplies.map((r) => ({ id: r.id, title: r.title, body: r.body }))}
                  targetId="support-reply-body"
                />
                <textarea
                  id="support-reply-body"
                  name="body"
                  required
                  rows={4}
                  placeholder="Write a reply…"
                  className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <input type="checkbox" name="isQuestion" />
                    {/* States the consequence at the point of the decision. */}
                    Mark as a question — moves to Awaiting customer
                  </label>
                  <button type="submit" className={cn(buttonVariants({ size: "sm" }), "ml-auto")}>
                    Send
                  </button>
                </div>
              </form>
            </div>
          )}

          {ticket.status !== "resolved" && ticket.status !== "closed" && (
            <form action={resolve} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
              <input type="hidden" name="ticketId" value={ticket.id} />
              <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Resolve</h2>
              <div className="flex flex-wrap gap-2">
                <select
                  name="outcome"
                  required
                  className="rounded-lg border border-input bg-background px-2 py-1.5 text-sm"
                >
                  {OUTCOMES.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <input
                  name="summary"
                  required
                  placeholder="What was done — the customer reads this"
                  className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-1.5 text-sm"
                />
                <button type="submit" className={cn(buttonVariants({ size: "sm" }))}>
                  Resolve
                </button>
              </div>
            </form>
          )}
        </div>

        <aside className="flex flex-col gap-3">
          {/* Derived on every render from the two stored timestamps — breach is
              never a column, so it can't go stale. */}
          <div className="rounded-lg border border-border bg-card">
            <h2 className="border-b border-border px-4 py-2.5 text-xs uppercase tracking-wide text-muted-foreground">
              TAT
            </h2>
            <dl className="flex flex-col gap-3 p-4 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">First response</dt>
                <dd className={cn("font-medium", sla.firstResponseBreached && "text-destructive")}>
                  {ticket.firstRespondedAt
                    ? `Met · ${formatDateTime(ticket.firstRespondedAt)}`
                    : ticket.firstResponseDueAt
                      ? sla.firstResponseBreached
                        ? `Breached · was due ${formatDateTime(ticket.firstResponseDueAt)}`
                        : `Due ${formatDateTime(ticket.firstResponseDueAt)}`
                      : "No target"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Resolution</dt>
                <dd className={cn("font-medium", sla.resolutionBreached && "text-destructive")}>
                  {ticket.resolutionDueAt ? formatDateTime(ticket.resolutionDueAt) : "No target"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Clock</dt>
                <dd className="font-medium">
                  {sla.paused ? (
                    <span className="text-warning-foreground">Paused · awaiting customer</span>
                  ) : sla.resolutionBreached ? (
                    <span className="text-destructive">Breached</span>
                  ) : sla.minutesToResolution === null ? (
                    "Not ticking"
                  ) : (
                    `${Math.floor(sla.minutesToResolution / 60)}h ${sla.minutesToResolution % 60}m left`
                  )}
                </dd>
              </div>
            </dl>
          </div>

          {ticket.csatRating && (
            <div className="rounded-lg border border-border bg-card">
              <h2 className="border-b border-border px-4 py-2.5 text-xs uppercase tracking-wide text-muted-foreground">
                Customer rating
              </h2>
              <div className="flex flex-col gap-1 p-4">
                <p className={cn("text-sm font-medium", ticket.csatRating === "negative" && "text-destructive")}>
                  {ticket.csatRating === "positive" ? "Handled well" : "Not handled well"}
                </p>
                {ticket.csatComment && (
                  <p className="text-sm whitespace-pre-wrap text-muted-foreground">{ticket.csatComment}</p>
                )}
              </div>
            </div>
          )}

          <div className="rounded-lg border border-border bg-card">
            <h2 className="border-b border-border px-4 py-2.5 text-xs uppercase tracking-wide text-muted-foreground">
              Assignment
            </h2>
            <form action={assign} className="flex flex-col gap-2 p-4">
              <input type="hidden" name="ticketId" value={ticket.id} />
              <select
                name="assignedToAdminId"
                defaultValue={ticket.assignedToAdminId ?? ""}
                className="rounded-lg border border-input bg-background px-2 py-1.5 text-sm"
              >
                <option value="">Unassigned</option>
                {assignees.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.fullName}
                  </option>
                ))}
              </select>
              <button type="submit" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                Save assignment
              </button>
            </form>
          </div>

          <div className="rounded-lg border border-border bg-card">
            <h2 className="border-b border-border px-4 py-2.5 text-xs uppercase tracking-wide text-muted-foreground">
              Priority
            </h2>
            <form action={changePriority} className="flex flex-col gap-2 p-4">
              <input type="hidden" name="ticketId" value={ticket.id} />
              <select
                name="priority"
                defaultValue={ticket.priority}
                className="rounded-lg border border-input bg-background px-2 py-1.5 text-sm"
              >
                {["urgent", "high", "normal", "low"].map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <button type="submit" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                Save priority
              </button>
            </form>
          </div>

          {/* The events table itself, not a derived view — which is how
              "assigned automatically" stays distinguishable from "a person
              chose this". */}
          <div className="rounded-lg border border-border bg-card">
            <h2 className="border-b border-border px-4 py-2.5 text-xs uppercase tracking-wide text-muted-foreground">
              Audit trail
            </h2>
            <ol className="flex flex-col p-4">
              {events.map(({ event, customerActorName, supportActorName }) => (
                <li
                  key={event.id}
                  className="flex gap-2.5 border-b border-dashed border-border py-2 first:pt-0 last:border-b-0 last:pb-0"
                >
                  <span
                    className={cn(
                      "mt-1.5 size-1.5 shrink-0 rounded-full",
                      event.actorKind === "system" ? "bg-warning" : "bg-primary",
                    )}
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="text-xs">
                      {event.event.replace(/_/g, " ")}
                      {event.fromValue && event.toValue && (
                        <span className="text-muted-foreground">
                          {" "}
                          {event.fromValue} → {event.toValue}
                        </span>
                      )}
                    </p>
                    <p className="font-mono text-[10px] text-muted-foreground">
                      {supportActorName ?? customerActorName ?? "system"} · {formatDateTime(event.occurredAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </aside>
      </div>
    </div>
  );
}
