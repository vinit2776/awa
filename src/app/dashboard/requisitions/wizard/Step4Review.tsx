import { buttonVariants } from "@/components/ui/button";
import { Info } from "@/components/ui/help";
import { cn } from "@/lib/utils";
import type { ApprovalPreview } from "@/db/approvalPreview";
import type { PossibleDuplicate } from "@/db/duplicateDetection";
import { DuplicateWarningPanel } from "./DuplicateWarningPanel";

export function Step4Review({
  justification,
  setJustification,
  preview,
  revision,
  isPending,
  error,
  onSave,
  onSubmit,
  duplicates,
  itemName,
  duplicateReasons,
  onDuplicateReasonChange,
  onEditLines,
}: {
  justification: string;
  setJustification: (v: string) => void;
  preview: ApprovalPreview | null;
  revision: boolean;
  isPending: boolean;
  error: string | null;
  onSave: () => void;
  onSubmit: () => void;
  duplicates: PossibleDuplicate[];
  itemName: (catalogItemId: string) => string | null;
  duplicateReasons: Record<string, string>;
  onDuplicateReasonChange: (duplicateOfRequisitionId: string, reason: string) => void;
  onEditLines: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-serif text-base text-foreground">Review &amp; submit</h2>
        <p className="text-sm text-muted-foreground">What submitting will actually do, before you do it.</p>
      </div>

      {preview && (
        <div
          className={cn(
            "max-w-2xl rounded-lg border p-3 text-sm",
            preview.autoApproves ? "border-warning/50 bg-warning/5" : "border-border",
          )}
        >
          {preview.autoApproves ? (
            <>
              <p className="font-medium">Nobody will review this</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                No approval rule covers a request of this value and category, so submitting approves it
                immediately and it goes straight to sourcing.
                <Info title="Why no approver?" next="An admin can add a rule from Admin › Approval rules.">
                  When no rule matches there is nobody to route the requisition to, so AWA approves it rather
                  than leaving it stuck with nobody able to act.
                </Info>
              </p>
            </>
          ) : (
            <>
              <p className="font-medium">
                When you submit, this goes to{" "}
                {preview.steps.map((step, i) => (
                  <span key={step.groupNo}>
                    {i > 0 && ", then "}
                    {step.approvers.join(" and ")}
                  </span>
                ))}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {preview.steps.map((s) => s.roleName).join(", then ")}
                {preview.ruleNames.length > 0 && ` · via “${preview.ruleNames.join("”, “")}”`}
              </p>
            </>
          )}
        </div>
      )}

      <DuplicateWarningPanel
        duplicates={duplicates}
        itemName={itemName}
        reasons={duplicateReasons}
        onReasonChange={onDuplicateReasonChange}
        onEditLines={onEditLines}
      />

      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">Justification</label>
        <textarea
          value={justification}
          onChange={(e) => setJustification(e.target.value)}
          rows={2}
          className="w-full max-w-2xl rounded-md border px-2 py-1 text-sm"
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2">
        {!revision && (
          <button type="button" disabled={isPending} onClick={onSave} className={cn(buttonVariants({ variant: "outline" }))}>
            Save draft
            <span className="font-normal opacity-70"> · only you see it</span>
          </button>
        )}
        <button type="button" disabled={isPending} onClick={onSubmit} className={cn(buttonVariants())}>
          {revision ? "Resubmit for approval" : "Submit for approval"}
          {preview && !preview.autoApproves && preview.steps[0] && (
            <span className="font-normal opacity-80"> · to {preview.steps[0].approvers.join(" and ")}</span>
          )}
        </button>
      </div>
    </div>
  );
}
