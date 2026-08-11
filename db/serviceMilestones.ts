import { and, eq } from "drizzle-orm";
import type { db } from "./client";
import { logAction } from "./audit";
import { purchaseOrders, serviceMilestones } from "./schema";

export type MilestoneInput = {
  milestoneNo: number;
  description: string;
  percentOfValue: string | null;
  fixedValue: string | null;
  dueDate: string | null;
};

/**
 * Defines a billing checkpoint on a service PO — service_milestones has
 * existed in the schema since the phase-1 migration but nothing ever
 * wrote to it (acceptance was always full_completion, S8). Scoped to
 * the PO, not a specific PO line, matching the column the table
 * actually has (po_id, no po_line_id) — for the common case of one
 * service line per PO this is unambiguous; a PO with more than one
 * service line would need every milestone accepted under whichever
 * line it's recorded against, a simplification documented in
 * db/fulfillment.ts#recordServiceAcceptance rather than solved here.
 */
export async function createMilestone(
  tx: typeof db,
  tenantId: string,
  actorUserId: string,
  poId: string,
  input: MilestoneInput,
): Promise<{ error?: string; milestoneId?: string }> {
  const [po] = await tx.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, poId), eq(purchaseOrders.tenantId, tenantId)));
  if (!po) return { error: "PO not found." };
  if (!input.description.trim()) return { error: "A description is required." };
  if (!Number.isInteger(input.milestoneNo) || input.milestoneNo <= 0) return { error: "Milestone number must be a positive integer." };

  const hasPercent = input.percentOfValue !== null && input.percentOfValue !== "";
  const hasFixed = input.fixedValue !== null && input.fixedValue !== "";
  if (hasPercent === hasFixed) {
    return { error: "Set exactly one of percent of value or a fixed value, not both or neither." };
  }
  if (hasPercent && (Number(input.percentOfValue) <= 0 || Number(input.percentOfValue) > 100)) {
    return { error: "Percent of value must be between 0 and 100." };
  }
  if (hasFixed && Number(input.fixedValue) <= 0) {
    return { error: "Fixed value must be greater than zero." };
  }

  const existing = await tx.select().from(serviceMilestones).where(eq(serviceMilestones.poId, poId));
  if (existing.some((m) => m.milestoneNo === input.milestoneNo)) {
    return { error: `Milestone ${input.milestoneNo} already exists for this PO.` };
  }

  const [created] = await tx
    .insert(serviceMilestones)
    .values({
      tenantId,
      poId,
      milestoneNo: input.milestoneNo,
      description: input.description.trim(),
      percentOfValue: hasPercent ? input.percentOfValue : null,
      fixedValue: hasFixed ? input.fixedValue : null,
      dueDate: input.dueDate,
    })
    .returning();

  await logAction(tx, {
    tenantId,
    actorUserId,
    action: "service_milestone.created",
    entityType: "service_milestone",
    entityId: created.id,
    metadata: { poId, milestoneNo: input.milestoneNo },
  });

  return { milestoneId: created.id };
}

/** percent_of_value is relative to the PO's total, not any one line's value — the only total service_milestones has anything to be "percent of." */
export function resolveMilestoneValue(milestone: typeof serviceMilestones.$inferSelect, poTotalAmount: string): number {
  if (milestone.percentOfValue !== null) return (Number(milestone.percentOfValue) / 100) * Number(poTotalAmount);
  return Number(milestone.fixedValue ?? 0);
}
