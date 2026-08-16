import { listAssignableUsers, listForEntity } from "@/db/clarifications";
import type { ClarificationEntityType } from "@/db/clarificationRules";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatRelative, formatDateTime } from "../support/ui";
import { askQuestion, replyToQuery, resolveQuery, withdrawQuery } from "./actions";

/**
 * The Queries panel, embedded on a record page.
 *
 * This is the lightweight move an approver currently doesn't have: today the
 * only way to ask "which cost centre?" is to reject the requisition, or leave
 * for WhatsApp — the process this platform exists to replace.
 *
 * `canBlock` is decided by the host page (is this user's action what the record
 * is waiting on?) and is only a UI affordance; db/clarifications.ts re-derives
 * it server-side, so a forged checkbox buys nothing.
 */
export async function QueriesPanel({
  entityType,
  entityId,
  returnTo,
  canBlock = false,
}: {
  entityType: ClarificationEntityType;
  entityId: string;
  returnTo: string;
  canBlock?: boolean;
}) {
  const [{ rows, messagesByClarification, viewerId }, assignableUsers] = await Promise.all([
    listForEntity(entityType, entityId),
    listAssignableUsers(),
  ]);

  const live = rows.filter((r) => r.clarification.status === "open" || r.clarification.status === "answered");
  const settled = rows.filter((r) => r.clarification.status === "resolved" || r.clarification.status === "withdrawn");

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <h2 className="border-b border-border px-4 py-2.5 text-xs uppercase tracking-wide text-muted-foreground">
        Queries · {live.length} open · {settled.length} settled
      </h2>

      <div className="flex flex-col gap-4 p-4">
        {live.length === 0 && settled.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No questions raised on this record yet.
          </p>
        )}

        {live.map(({ clarification, raisedByName }) => {
          const messages = messagesByClarification[clarification.id] ?? [];
          const viewerAsked = clarification.raisedByUserId === viewerId;

          return (
            <article
              key={clarification.id}
              className="flex flex-col gap-3 rounded-lg border border-border bg-background p-3.5"
            >
              <header className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs font-medium",
                    clarification.status === "open"
                      ? "bg-warning/20 text-warning-foreground"
                      : "bg-chart-1/10 text-chart-1",
                  )}
                >
                  {clarification.status === "open" ? "Open" : "Answered"}
                </span>
                {clarification.blocksProgress && (
                  <span className="rounded border border-input px-1.5 py-0.5 text-xs text-muted-foreground">
                    Blocking
                  </span>
                )}
                <span className="ml-auto text-xs text-muted-foreground">
                  asked {formatRelative(clarification.createdAt)}
                </span>
              </header>

              <p className="text-sm font-medium whitespace-pre-wrap">{clarification.question}</p>
              <p className="text-xs text-muted-foreground">{raisedByName} asked</p>

              {messages.length > 0 && (
                <div className="flex flex-col gap-2.5 border-l-2 border-border pl-3">
                  {messages.map(({ message, authorName }) => (
                    <div key={message.id} className="flex flex-col gap-1">
                      <p className="flex items-center gap-2 text-xs">
                        <span className="font-medium">{authorName}</span>
                        <time className="ml-auto text-muted-foreground">
                          {formatDateTime(message.createdAt)}
                        </time>
                      </p>
                      <p className="text-sm whitespace-pre-wrap">{message.body}</p>
                    </div>
                  ))}
                </div>
              )}

              <form action={replyToQuery} className="flex flex-col gap-2 border-t border-border pt-3">
                <input type="hidden" name="clarificationId" value={clarification.id} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <textarea
                  name="body"
                  required
                  rows={2}
                  placeholder="Reply…"
                  className="rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <div className="flex flex-wrap items-center gap-2">
                  {/* Only the asker can resolve — the whole meaning of "held
                      open until resolved". The DB check constraint enforces it
                      regardless of what this UI renders. */}
                  {viewerAsked && (
                    <span className="text-xs text-muted-foreground">Only you can resolve this — you asked it.</span>
                  )}
                  <button type="submit" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "ml-auto")}>
                    Reply
                  </button>
                </div>
              </form>

              {viewerAsked && (
                <div className="flex flex-wrap gap-2">
                  <form action={resolveQuery}>
                    <input type="hidden" name="clarificationId" value={clarification.id} />
                    <input type="hidden" name="returnTo" value={returnTo} />
                    <button type="submit" className={cn(buttonVariants({ size: "sm" }))}>
                      {clarification.blocksProgress ? "Resolve & unblock" : "Resolve"}
                    </button>
                  </form>
                  <form action={withdrawQuery}>
                    <input type="hidden" name="clarificationId" value={clarification.id} />
                    <input type="hidden" name="returnTo" value={returnTo} />
                    <button type="submit" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
                      Withdraw
                    </button>
                  </form>
                </div>
              )}
            </article>
          );
        })}

        {/* Settled queries stay visible: a query and its answer are part of why
            the record looks the way it does — the audit value the WhatsApp
            thread never gave anyone. */}
        {settled.map(({ clarification, raisedByName }) => (
          <article
            key={clarification.id}
            className="flex flex-col gap-1.5 rounded-lg border border-border p-3.5 opacity-70"
          >
            <header className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                {clarification.status === "resolved" ? "Resolved" : "Withdrawn"}
              </span>
              <span className="ml-auto text-xs text-muted-foreground">
                {clarification.status === "resolved"
                  ? `resolved ${formatRelative(clarification.resolvedAt)}`
                  : "withdrawn"}{" "}
                · asked by {raisedByName}
              </span>
            </header>
            <p className="text-sm whitespace-pre-wrap">{clarification.question}</p>
          </article>
        ))}

        <details className="rounded-lg border border-dashed border-input">
          <summary className="cursor-pointer px-3.5 py-2.5 text-sm font-medium">Ask a question</summary>
          <form action={askQuestion} className="flex flex-col gap-3 border-t border-border p-3.5">
            <input type="hidden" name="entityType" value={entityType} />
            <input type="hidden" name="entityId" value={entityId} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <textarea
              name="question"
              required
              rows={3}
              placeholder="What do you need to know before this can move?"
              className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Ask someone in particular (optional)</span>
              <select
                name="assignedToUserId"
                defaultValue=""
                className="rounded-lg border border-input bg-background px-2 py-1.5 text-sm"
              >
                <option value="">Anyone who can see this record</option>
                {assignableUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
              </select>
            </label>
            {canBlock && (
              <label className="flex items-start gap-2 text-xs text-muted-foreground">
                <input type="checkbox" name="blocksProgress" className="mt-0.5" />
                <span>
                  Hold this record until the question is answered. Your approve and reject controls stay disabled
                  until you resolve it.
                </span>
              </label>
            )}
            <div className="flex justify-end">
              <button type="submit" className={cn(buttonVariants({ size: "sm" }))}>
                Ask
              </button>
            </div>
          </form>
        </details>
      </div>
    </section>
  );
}
