import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { stageBadgeVariant, nextAction } from "./stage";

/** The one status+next-action treatment every transaction page should use — a stage string from computeStage()/poStage()/invoiceStage()/sourcingStage(), never a raw enum. */
export function LifecycleStatus({ stage, className }: { stage: string; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <Badge variant={stageBadgeVariant(stage)}>{stage}</Badge>
      <span className="text-xs text-muted-foreground">{nextAction(stage)}</span>
    </div>
  );
}
