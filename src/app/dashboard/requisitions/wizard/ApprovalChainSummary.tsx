import { Avatar } from "@/components/ui/avatar";
import { Info } from "@/components/ui/help";
import type { ApprovalPreview } from "@/db/approvalPreview";

/**
 * "Who this goes to" — extracted from Step4Review so the persistent
 * consequences rail (visible on every wizard step) and Step4Review's own
 * review copy render the identical chain from the identical preview,
 * rather than two renderers that could drift.
 */
export function ApprovalChainSummary({ preview }: { preview: ApprovalPreview | null }) {
  if (!preview) {
    return <p className="text-sm text-muted-foreground">Working out who this goes to…</p>;
  }

  if (preview.autoApproves) {
    return (
      <div className="rounded-lg border border-warning/50 bg-warning/5 p-3 text-sm">
        <p className="font-medium">Nobody will review this</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          No approval rule covers a request of this value and category, so submitting approves it immediately
          and it goes straight to sourcing.
          <Info title="Why no approver?" next="An admin can add a rule from Admin › Approval rules.">
            When no rule matches there is nobody to route the requisition to, so AWA approves it rather than
            leaving it stuck with nobody able to act.
          </Info>
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {preview.steps.map((step, i) => (
        <div key={step.groupNo}>
          {i > 0 && (
            <p className="py-1 pl-1.5 text-[11px] text-muted-foreground/80">then, only if they agree →</p>
          )}
          <div className="flex items-center gap-2.5 rounded-lg border border-border bg-card p-2.5">
            <Avatar name={step.approvers[0]} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{step.approvers.join(" and ")}</p>
              <p className="truncate text-xs text-muted-foreground">{step.roleName}</p>
            </div>
          </div>
        </div>
      ))}
      {preview.ruleNames.length > 0 && (
        <p className="mt-0.5 text-xs text-muted-foreground">Rule: &ldquo;{preview.ruleNames.join("”, “")}&rdquo;</p>
      )}
    </div>
  );
}
