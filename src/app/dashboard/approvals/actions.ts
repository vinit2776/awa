"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import { logAction } from "@/db/audit";
import { isCurrentGroup, checkFullyApproved } from "@/db/approvals";
import { purchaseRequisitions, requisitionApprovalRequirements, approvalDecisionLog } from "@/db/schema";

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

export async function rejectRequirement(formData: FormData) {
  const requirementId = String(formData.get("requirementId") ?? "");
  const comment = String(formData.get("comment") ?? "").trim();
  if (!requirementId || !comment) return;

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
      .set({ status: "rejected", decidedAt: new Date(), decisionComment: comment })
      .where(eq(requisitionApprovalRequirements.id, requirement.id));

    await tx.insert(approvalDecisionLog).values({
      tenantId: tenant.id,
      requisitionApprovalRequirementId: requirement.id,
      actorUserId: user.id,
      action: "rejected",
      comment,
    });

    // Rejected-with-defects: the requisition can be revised and resubmitted
    // (that flow is Sprint 6). Other approvers' pending rows are left as-is
    // rather than cancelled — they just stop being actionable, since the
    // inbox only surfaces rows for requisitions still pending_approval.
    await tx
      .update(purchaseRequisitions)
      .set({ status: "rejected_revisable" })
      .where(eq(purchaseRequisitions.id, requirement.requisitionId));

    await logAction(tx, {
      tenantId: tenant.id,
      actorUserId: user.id,
      action: "requisition_approval.rejected",
      entityType: "requisition_approval_requirement",
      entityId: requirement.id,
      metadata: { requisitionId: requirement.requisitionId, comment },
    });
  });

  revalidatePath("/dashboard/approvals");
}

export async function addAdHocApprover(formData: FormData) {
  const requisitionId = String(formData.get("requisitionId") ?? "");
  const assignedUserId = String(formData.get("assignedUserId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!requisitionId || !assignedUserId || !reason) return;

  const { user, tenant } = await getCurrentUserAndTenant();

  await withTenant(tenant.id, async (tx) => {
    // Guardrail: only someone who currently has an actionable pending row
    // on this requisition can pull in another approver.
    const [actingRequirement] = await tx
      .select()
      .from(requisitionApprovalRequirements)
      .where(
        and(
          eq(requisitionApprovalRequirements.requisitionId, requisitionId),
          eq(requisitionApprovalRequirements.assignedUserId, user.id),
          eq(requisitionApprovalRequirements.status, "pending"),
        ),
      );
    if (!actingRequirement) return;
    if (!(await isCurrentGroup(tx, requisitionId, actingRequirement.groupNo))) return;

    const [created] = await tx
      .insert(requisitionApprovalRequirements)
      .values({
        tenantId: tenant.id,
        requisitionId,
        source: "ad_hoc",
        assignedUserId,
        groupNo: actingRequirement.groupNo,
        groupSequence: actingRequirement.groupSequence,
        addedByUserId: user.id,
        reason,
        status: "pending",
      })
      .returning();

    await tx.insert(approvalDecisionLog).values({
      tenantId: tenant.id,
      requisitionApprovalRequirementId: created.id,
      actorUserId: user.id,
      action: "approver_added",
      comment: reason,
    });
    await logAction(tx, {
      tenantId: tenant.id,
      actorUserId: user.id,
      action: "requisition_approval.ad_hoc_added",
      entityType: "requisition_approval_requirement",
      entityId: created.id,
      metadata: { requisitionId, assignedUserId, reason },
    });
  });

  revalidatePath("/dashboard/approvals");
}
