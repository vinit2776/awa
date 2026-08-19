import Link from "next/link";
import type { PossibleDuplicate } from "@/db/duplicateDetection";

const STATUS_LABEL: Record<PossibleDuplicate["status"], string> = {
  submitted: "submitted",
  pending_approval: "pending approval",
  approved: "approved",
  converted_to_po: "already ordered — still on its way",
};

function formatShortDate(date: Date | null): string {
  if (!date) return "recently";
  const value = typeof date === "string" ? new Date(date) : date;
  return value.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/**
 * "Somebody already asked for this" — deliberately not "you're ordering
 * more of this" (see CommitmentHint, which already says that inline on
 * the line, in quantities). This panel is about identity — who raised a
 * requisition that touches the same catalogue item, and whether this one
 * duplicates it — so it leads with the person and the date, not a
 * number, or it just reads as the same warning twice and both get
 * dismissed unread.
 *
 * Never blocks: there is always a way through — explain why it's
 * different (the reason box, required, not decoration) or go fix the
 * lines instead. What it refuses is silence: an empty reason will not
 * pass createRequisition's server-side gate, which re-runs this same
 * check and does not trust anything rendered here.
 */
export function DuplicateWarningPanel({
  duplicates,
  itemName,
  reasons,
  onReasonChange,
  onEditLines,
}: {
  duplicates: PossibleDuplicate[];
  itemName: (catalogItemId: string) => string | null;
  reasons: Record<string, string>;
  onReasonChange: (duplicateOfRequisitionId: string, reason: string) => void;
  onEditLines?: () => void;
}) {
  if (duplicates.length === 0) return null;

  return (
    <div className="flex max-w-2xl flex-col gap-3 rounded-lg border border-warning/50 bg-warning/5 p-3">
      <div>
        <p className="text-sm font-medium">
          {duplicates.length === 1 ? "This may duplicate a request that's already in flight" : "These may duplicate requests already in flight"}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          This will still submit — but say why it isn&apos;t a duplicate, or go back and remove the line instead.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {duplicates.map((d) => {
          const items = [...new Set(d.matchedItems.map((m) => itemName(m.catalogItemId)).filter((n): n is string => !!n))];
          return (
            <div key={d.requisitionId} className="flex flex-col gap-1.5 rounded-md border border-border bg-background p-2.5">
              <p className="text-sm">
                <span className="font-medium">{d.requestorName}</span> raised a requisition on{" "}
                {formatShortDate(d.submittedAt)} that also asks for {items.join(", ") || "the same item"} —{" "}
                {STATUS_LABEL[d.status]}.{" "}
                <Link href={`/dashboard/requisitions/${d.requisitionId}`} target="_blank" className="underline">
                  Look at it
                </Link>
              </p>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">
                  These are different because… <span className="text-warning-foreground">(required to submit)</span>
                </span>
                <textarea
                  value={reasons[d.requisitionId] ?? ""}
                  onChange={(e) => onReasonChange(d.requisitionId, e.target.value)}
                  rows={2}
                  className="w-full rounded-md border px-2 py-1 text-sm"
                  placeholder="Different project, different vendor, replaces a damaged unit…"
                />
              </label>
            </div>
          );
        })}
      </div>

      {onEditLines && (
        <button type="button" onClick={onEditLines} className="self-start text-xs text-muted-foreground underline">
          Not sure? Go back and change the lines instead
        </button>
      )}
    </div>
  );
}
