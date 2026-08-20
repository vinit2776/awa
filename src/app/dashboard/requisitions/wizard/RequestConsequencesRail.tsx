import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ApprovalPreview } from "@/db/approvalPreview";
import type { PossibleDuplicate } from "@/db/duplicateDetection";
import { ApprovalChainSummary } from "./ApprovalChainSummary";
import type { BudgetStatus } from "./budgetStatus";

/**
 * "If you send this now" — stays mounted across all four wizard steps
 * (RequisitionForm renders it outside the per-step conditional), rather
 * than only appearing at Review. Everything it shows is already computed
 * one level up: previewApprovers()/previewDuplicates()'s live results and
 * Step2Basics's budget math, not a new fetch.
 *
 * "Typical decision time" from the design handoff isn't here — there's
 * no query backing it yet (median time-to-decision by value bucket), and
 * a plausible-looking placeholder number would read as real data. Left
 * as a follow-up rather than shipped as an invented figure.
 */
export function RequestConsequencesRail({
  preview,
  duplicates,
  budgetStatus,
  revision,
  isPending,
  onSend,
  onSaveDraft,
  onLookAtDuplicates,
}: {
  preview: ApprovalPreview | null;
  duplicates: PossibleDuplicate[];
  budgetStatus: BudgetStatus;
  revision: boolean;
  isPending: boolean;
  onSend: () => void;
  onSaveDraft: () => void;
  onLookAtDuplicates: () => void;
}) {
  const sendLabel =
    preview && !preview.autoApproves && preview.steps[0]
      ? `Send to ${preview.steps[0].approvers[0]}${preview.steps[0].approvers.length > 1 ? " and others" : ""}`
      : revision
        ? "Resubmit for approval"
        : "Submit for approval";

  return (
    <aside className="flex w-full flex-col gap-3.5 border-t border-border pt-6 lg:w-[330px] lg:shrink-0 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
      <p className="text-xs font-medium tracking-[0.07em] text-muted-foreground uppercase">If you send this now</p>

      <ApprovalChainSummary preview={preview} />

      {(budgetStatus || duplicates.length > 0) && (
        <div className="flex flex-col gap-2 border-t border-border pt-3.5">
          {budgetStatus && (
            <div className="flex items-start gap-2">
              <span
                className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", budgetStatus.overBudget ? "bg-warning" : "bg-success")}
                aria-hidden="true"
              />
              <p className="text-xs leading-relaxed text-muted-foreground">
                {budgetStatus.overBudget
                  ? `${Math.abs(budgetStatus.remainingAfterThis).toFixed(2)} over the ${budgetStatus.costCenterName} budget — you can still send it.`
                  : `Within budget — ${budgetStatus.remainingAfterThis.toFixed(2)} would remain this year.`}
              </p>
            </div>
          )}
          {duplicates.length > 0 && (
            <div className="flex items-start gap-2">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-warning" aria-hidden="true" />
              <p className="text-xs leading-relaxed text-muted-foreground">
                {duplicates.length === 1
                  ? `${duplicates[0].requestorName} may have already asked for something similar.`
                  : `${duplicates.length} people may have already asked for something similar.`}{" "}
                <button type="button" onClick={onLookAtDuplicates} className="text-primary underline underline-offset-2">
                  Look
                </button>
              </p>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2 border-t border-border pt-3.5">
        <button type="button" disabled={isPending} onClick={onSend} className={cn(buttonVariants(), "h-10")}>
          {sendLabel}
        </button>
        {!revision && (
          <button
            type="button"
            disabled={isPending}
            onClick={onSaveDraft}
            className={cn(buttonVariants({ variant: "outline" }), "h-9")}
          >
            Keep as a draft
          </button>
        )}
        <p className="text-[11.5px] leading-relaxed text-muted-foreground/80">
          A draft is private to you. Sending commits nothing — it asks a person.
        </p>
      </div>
    </aside>
  );
}
