import { cn } from "@/lib/utils";
import { Term } from "@/components/ui/help";
import type { Department, CostCenter } from "./types";

export function Step2Basics({
  departments,
  costCenters,
  departmentId,
  costCenterId,
  setDepartmentId,
  setCostCenterId,
  total,
  committedByCostCenter,
}: {
  departments: Department[];
  costCenters: CostCenter[];
  departmentId: string;
  costCenterId: string;
  setDepartmentId: (id: string) => void;
  setCostCenterId: (id: string) => void;
  total: number;
  committedByCostCenter: Record<string, number>;
}) {
  const selectedCostCenter = costCenters.find((c) => c.id === costCenterId);
  const budget = selectedCostCenter?.annualBudget ? Number(selectedCostCenter.annualBudget) : null;
  const committed = costCenterId ? (committedByCostCenter[costCenterId] ?? 0) : 0;
  const remainingAfterThis = budget !== null ? budget - committed - total : null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-serif text-base text-foreground">Basics</h2>
        <p className="text-sm text-muted-foreground">Who this is for, and what it draws against.</p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Department</label>
          <select
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            className="h-8 rounded-md border px-2 text-sm"
          >
            <option value="">—</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Cost center</label>
          <select
            value={costCenterId}
            onChange={(e) => setCostCenterId(e.target.value)}
            className="h-8 rounded-md border px-2 text-sm"
          >
            <option value="">—</option>
            {costCenters.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      {selectedCostCenter && budget !== null && (
        <div className="max-w-2xl rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
            <span className="text-muted-foreground">
              {selectedCostCenter.name} · annual budget {budget.toFixed(2)}
            </span>
            <span className={cn("font-medium", remainingAfterThis !== null && remainingAfterThis < 0 && "text-amber-600")}>
              {remainingAfterThis !== null && remainingAfterThis < 0
                ? `${Math.abs(remainingAfterThis).toFixed(2)} over budget`
                : `${remainingAfterThis?.toFixed(2)} left after this`}
            </span>
          </div>

          {/* A bar rather than four lines of arithmetic: the question is
              "can I afford this", and a number nobody subtracts by eye
              doesn't answer it. */}
          <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-muted">
            <span
              className="bg-muted-foreground/50"
              style={{ width: `${Math.min((committed / budget) * 100, 100)}%` }}
            />
            <span
              className={cn(
                remainingAfterThis !== null && remainingAfterThis < 0 ? "bg-amber-500" : "bg-primary",
              )}
              style={{ width: `${Math.min((total / budget) * 100, Math.max(100 - (committed / budget) * 100, 0))}%` }}
            />
          </div>

          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Already committed {committed.toFixed(2)}</span>
            <span className="text-primary">This request {total.toFixed(2)}</span>
          </div>

          {remainingAfterThis !== null && remainingAfterThis < 0 && (
            <p className="mt-2 text-xs text-amber-600">
              This would take the <Term name="cost-center" sentenceCase /> over its annual budget. You can still
              submit — it is a heads-up, not a block.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
