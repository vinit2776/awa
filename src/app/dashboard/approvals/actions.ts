"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import { logAction } from "@/db/audit";
import { isCurrentGroup, checkFullyApproved, rejectRequisition, addAdHocApprover as addAdHocApproverToRequisition } from "@/db/approvals";
import { requisitionApprovalRequirements, approvalDecisionLog } from "@/db/schema";

export async function approveRequirement(formData: FormData) {
  const requirementId = String(formData.get("requirementId") ?? "");
  const comment = String(formData.get("comment") ?? "").trim() || null;
  if (!requirementId) return;

  const { user, tenant } = await getCurrentUserAndTenant();

  await withTenant(tenant.id, async (tx) => {
    const [requirement] = await tx
      .select()
      .from(requisitionApprovalRequirements)
      .where(
        and(
          eq(requisitionApprovalRequirements.id, requirementId),
          eq(requisitionApprovalRequirements.assignedUserId, user.id),
          eq(requisitionApprovalRequirements.status, "pending"),
        ),
      );
    if (!requirement) return;
    if (!(await isCurrentGroup(tx, requirement.requisitionId, requirement.groupNo))) return;

    await tx
      .update(requisitionApprovalRequirements)
      .set({ status: "approved", decidedAt: new Date(), decisionComment: comment })
      .where(eq(requisitionApprovalRequirements.id, requirement.id));

    await tx.insert(approvalDecisionLog).values({
      tenantId: tenant.id,
      requisitionApprovalRequirementId: requirement.id,
      actorUserId: user.id,
      action: "approved",
      comment,
    });
    await logAction(tx, {
      tenantId: tenant.id,
      actorUserId: user.id,
      action: "requisition_approval.approved",
      entityType: "requisition_approval_requirement",
      entityId: requirement.id,
      metadata: { requisitionId: requirement.requisitionId },
    });

    await checkFullyApproved(tx, tenant.id, requirement.requisitionId);
  });

  revalidatePath("/dashboard/approvals");
}

async function reject(formData: FormData, closure: "revisable" | "closed") {
  const requirementId = String(formData.get("requirementId") ?? "");
  const comment = String(formData.get("comment") ?? "").trim();
  if (!requirementId || !comment) return;

  const { user, tenant } = await getCurrentUserAndTenant();
  await withTenant(tenant.id, (tx) => rejectRequisition(tx, tenant.id, user.id, requirementId, closure, comment));

  revalidatePath("/dashboard/approvals");
}

export async function requestRevision(formData: FormData) {
  await reject(formData, "revisable");
}

export async function rejectAndClose(formData: FormData) {
  await reject(formData, "closed");
}

export async function addAdHocApprover(formData: FormData) {
  const requisitionId = String(formData.get("requisitionId") ?? "");
  const assignedUserId = String(formData.get("assignedUserId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!requisitionId || !assignedUserId || !reason) return;

  const { user, tenant } = await getCurrentUserAndTenant();
  await withTenant(tenant.id, (tx) => addAdHocApproverToRequisition(tx, tenant.id, user.id, requisitionId, assignedUserId, reason));

  revalidatePath("/dashboard/approvals");
}
