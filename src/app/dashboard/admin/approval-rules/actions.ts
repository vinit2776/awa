"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import { logAction } from "@/db/audit";
import { approvalRules, approvalRuleRequirements, tenants } from "@/db/schema";

export async function updateEscalationSla(formData: FormData) {
  const { user, tenant } = await getCurrentUserAndTenant();
  const escalationSlaHours = Math.max(0, Number(formData.get("escalationSlaHours") ?? 48) || 0);

  await withTenant(tenant.id, async (tx) => {
    await tx.update(tenants).set({ escalationSlaHours, updatedAt: new Date() }).where(eq(tenants.id, tenant.id));
    await logAction(tx, {
      tenantId: tenant.id,
      actorUserId: user.id,
      action: "tenant.escalation_sla_updated",
      entityType: "tenant",
      entityId: tenant.id,
      metadata: { escalationSlaHours },
    });
  });

  revalidatePath("/dashboard/admin/approval-rules");
}

export async function createRule(formData: FormData) {
  const { user, tenant } = await getCurrentUserAndTenant();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  const categoryId = String(formData.get("categoryId") ?? "").trim() || null;
  const departmentId = String(formData.get("departmentId") ?? "").trim() || null;
  const costCenterId = String(formData.get("costCenterId") ?? "").trim() || null;
  const minValue = String(formData.get("minValue") ?? "0").trim() || "0";
  const maxValue = String(formData.get("maxValue") ?? "").trim() || null;
  const combinationMode = String(formData.get("combinationMode") ?? "additive") as "additive" | "exclusive";
  const priority = Number(formData.get("priority") ?? 0) || 0;

  await withTenant(tenant.id, async (tx) => {
    const [created] = await tx
      .insert(approvalRules)
      .values({
        tenantId: tenant.id,
        name,
        categoryId,
        departmentId,
        costCenterId,
        minValue,
        maxValue,
        combinationMode,
        priority,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
    await logAction(tx, {
      tenantId: tenant.id,
      actorUserId: user.id,
      action: "approval_rule.created",
      entityType: "approval_rule",
      entityId: created.id,
      metadata: { name },
    });
  });

  revalidatePath("/dashboard/admin/approval-rules");
}

export async function toggleRuleActive(formData: FormData) {
  const { user, tenant } = await getCurrentUserAndTenant();
  const ruleId = String(formData.get("ruleId") ?? "");
  const active = formData.get("active") === "true";
  if (!ruleId) return;

  await withTenant(tenant.id, async (tx) => {
    await tx
      .update(approvalRules)
      .set({ active, updatedBy: user.id, updatedAt: new Date() })
      .where(eq(approvalRules.id, ruleId));
    await logAction(tx, {
      tenantId: tenant.id,
      actorUserId: user.id,
      action: active ? "approval_rule.activated" : "approval_rule.deactivated",
      entityType: "approval_rule",
      entityId: ruleId,
      metadata: {},
    });
  });

  revalidatePath("/dashboard/admin/approval-rules");
}

export async function createRuleRequirement(formData: FormData) {
  const { user, tenant } = await getCurrentUserAndTenant();
  const ruleId = String(formData.get("ruleId") ?? "");
  const approverRoleId = String(formData.get("approverRoleId") ?? "");
  const groupNo = Number(formData.get("groupNo") ?? 1) || 1;
  const groupSequence = Number(formData.get("groupSequence") ?? groupNo) || groupNo;
  const minApprovalsInGroup = Number(formData.get("minApprovalsInGroup") ?? 1) || 1;
  if (!ruleId || !approverRoleId) return;

  await withTenant(tenant.id, async (tx) => {
    const [created] = await tx
      .insert(approvalRuleRequirements)
      .values({ tenantId: tenant.id, ruleId, approverRoleId, groupNo, groupSequence, minApprovalsInGroup })
      .returning();
    await logAction(tx, {
      tenantId: tenant.id,
      actorUserId: user.id,
      action: "approval_rule_requirement.created",
      entityType: "approval_rule_requirement",
      entityId: created.id,
      metadata: { ruleId, approverRoleId, groupNo },
    });
  });

  revalidatePath("/dashboard/admin/approval-rules");
}
