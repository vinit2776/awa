import { cn } from "@/lib/utils";

/**
 * Shared presentation for the customer-facing support views.
 *
 * The customer vocabulary is five words wide and only one of them is loud:
 * "Needs your input" is the state that stalls a ticket, so it is the only one
 * with a saturated fill. Colour-coding every status at equal weight would make
 * the row that actually needs action stop standing out.
 */
const PILL_STYLES: Record<string, string> = {
  Open: "bg-accent text-accent-foreground/80",
  "In progress": "bg-chart-1/10 text-chart-1",
  "Needs your input": "bg-warning/20 text-warning-foreground",
  Resolved: "bg-success/10 text-success",
  Closed: "border border-input text-muted-foreground",
};

export function StatusPill({ label }: { label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        PILL_STYLES[label] ?? "bg-accent text-accent-foreground",
      )}
    >
      {label}
    </span>
  );
}

const TYPE_LABELS: Record<string, string> = {
  bug: "Bug",
  feature_request: "Feature",
  feedback: "Feedback",
  question: "Question",
};

export function TypeTag({ type }: { type: string }) {
  return (
    <span className="inline-block rounded border border-input px-1.5 py-0.5 text-xs text-muted-foreground">
      {TYPE_LABELS[type] ?? type}
    </span>
  );
}

export function formatRelative(date: Date | string | null): string {
  if (!date) return "—";
  const value = typeof date === "string" ? new Date(date) : date;
  const diffMs = Date.now() - value.getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 8) return `${days} day${days === 1 ? "" : "s"} ago`;
  return value.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function formatDateTime(date: Date | string | null): string {
  if (!date) return "—";
  const value = typeof date === "string" ? new Date(date) : date;
  return value.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
