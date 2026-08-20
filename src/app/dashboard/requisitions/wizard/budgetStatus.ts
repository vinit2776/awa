import type { CostCenter } from "./types";

export type BudgetStatus = {
  costCenterName: string;
  budget: number;
  committed: number;
  total: number;
  remainingAfterThis: number;
  overBudget: boolean;
} | null;

/**
 * Shared by Step2Basics's inline budget bar and the request form's
 * persistent consequences rail — both need the same numbers, and a
 * budget bar that disagreed with the rail standing next to it would be
 * worse than either alone.
 */
export function computeBudgetStatus(
  costCenterId: string,
  costCenters: CostCenter[],
  committedByCostCenter: Record<string, number>,
  total: number,
): BudgetStatus {
  const costCenter = costCenters.find((c) => c.id === costCenterId);
  if (!costCenter || !costCenter.annualBudget) return null;

  const budget = Number(costCenter.annualBudget);
  const committed = committedByCostCenter[costCenterId] ?? 0;
  const remainingAfterThis = budget - committed - total;

  return {
    costCenterName: costCenter.name,
    budget,
    committed,
    total,
    remainingAfterThis,
    overBudget: remainingAfterThis < 0,
  };
}
