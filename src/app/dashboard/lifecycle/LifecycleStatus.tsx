import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { stageBadgeVariant, nextAction } from "./stage";

/**
 * The one status+next-action treatment every transaction page should
 * use — a stage string from computeStage()/poStage()/invoiceStage()/
 * sourcingStage(), never a raw enum. `detail` overrides the generic
 * nextAction() caption when the caller has something more specific to
 * say — e.g. approvalStepDetail()'s "Step 1 of 2" for a requisition
 * mid-way through a multi-group approval chain.
 */
export function LifecycleStatus({ stage, detail, className }: { stage: string; detail?: string | null; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <Badge variant={stageBadgeVariant(stage)}>{stage}</Badge>
      <span className="text-xs text-muted-foreground">{detail ?? nextAction(stage)}</span>
    </div>
  );
}
