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

function formatValue(value: string): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return value;
  return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * One requester can have several matching requisitions in flight at once
 * (the same "Laptop — 14in business" line raised four separate times), and
 * without grouping the panel renders four blocks whose text is identical
 * except for the totalEstimatedValue that now distinguishes them — which
 * reads as a rendering bug, not four genuine requisitions. Grouping by
 * requestorId (not requestorName — two different people can share a name;
 * PossibleDuplicate carries the id precisely so grouping doesn't rely on
 * string equality of a display field) turns that into one block with one
 * reason box.
 *
 * Different people stay in separate groups/blocks with their own reason —
 * "are you duplicating *their* request" is a per-person question, and
 * merging across people would lose that.
 */
type DuplicateGroup = {
  requestorId: string;
  requestorName: string;
  duplicates: PossibleDuplicate[];
};

function groupByRequestor(duplicates: PossibleDuplicate[]): DuplicateGroup[] {
  const byRequestor = new Map<string, DuplicateGroup>();
  for (const d of duplicates) {
    let group = byRequestor.get(d.requestorId);
    if (!group) {
      group = { requestorId: d.requestorId, requestorName: d.requestorName, duplicates: [] };
      byRequestor.set(d.requestorId, group);
    }
    group.duplicates.push(d);
  }
  return [...byRequestor.values()];
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
 *
 * `reasons` and `onReasonChange` stay keyed by duplicateOfRequisitionId —
 * grouping is purely how this panel renders and edits that same map. A
 * grouped block's single textarea calls onReasonChange once per
 * requisition in the group, so the caller's per-requisition reason state
 * (and, on submit, the one-acknowledgement-row-per-requisition it's built
 * from) never changes shape — this component just fans one keystroke out
 * to several ids instead of one.
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

  const groups = groupByRequestor(duplicates);

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
        {groups.map((group) => {
          const items = [
            ...new Set(
              group.duplicates.flatMap((d) => d.matchedItems.map((m) => itemName(m.catalogItemId))).filter((n): n is string => !!n),
            ),
          ];
          const itemsLabel = items.join(", ") || "the same item";
          const primaryRequisitionId = group.duplicates[0].requisitionId;
          const reasonValue = reasons[primaryRequisitionId] ?? "";
          const handleGroupReasonChange = (reason: string) => {
            for (const d of group.duplicates) onReasonChange(d.requisitionId, reason);
          };

          return (
            <div key={group.requestorId} className="flex flex-col gap-1.5 rounded-md border border-border bg-background p-2.5">
              {group.duplicates.length === 1 ? (
                (() => {
                  const d = group.duplicates[0];
                  return (
                    <p className="text-sm">
                      <span className="font-medium">{group.requestorName}</span> raised a requisition on{" "}
                      {formatShortDate(d.submittedAt)} that also asks for {itemsLabel} — {formatValue(d.totalEstimatedValue)} —{" "}
                      {STATUS_LABEL[d.status]}.{" "}
                      <Link href={`/dashboard/requisitions/${d.requisitionId}`} target="_blank" className="underline">
                        Look at it
                      </Link>
                    </p>
                  );
                })()
              ) : (
                <div className="flex flex-col gap-1">
                  <p className="text-sm">
                    <span className="font-medium">{group.requestorName}</span> has {group.duplicates.length} requisitions in
                    flight that also ask for {itemsLabel} —{" "}
                    {group.duplicates.map((d) => formatValue(d.totalEstimatedValue)).join(", ")}
                  </p>
                  <ul className="flex flex-col gap-0.5">
                    {group.duplicates.map((d) => (
                      <li key={d.requisitionId} className="text-xs text-muted-foreground">
                        {formatShortDate(d.submittedAt)} · {formatValue(d.totalEstimatedValue)} · {STATUS_LABEL[d.status]} —{" "}
                        <Link href={`/dashboard/requisitions/${d.requisitionId}`} target="_blank" className="underline">
                          Look at it
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">
                  These are different because… <span className="text-warning-foreground">(required to submit)</span>
                </span>
                <textarea
                  value={reasonValue}
                  onChange={(e) => handleGroupReasonChange(e.target.value)}
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
