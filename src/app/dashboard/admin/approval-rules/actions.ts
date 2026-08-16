"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { requireTenantAdmin } from "@/db/permissions";
import { withTenant } from "@/db/withTenant";
import { logAction } from "@/db/audit";
import { approvalRules, approvalRuleRequirements, tenants } from "@/db/schema";

export async function updateEscalationSla(formData: FormData) {
  const { user, tenant } = await requireTenantAdmin();
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

export type WizardStepInput = { approverRoleId: string; minApprovalsInGroup: number }[];

export type CreateRuleWithRequirementsInput = {
  name: string;
  categoryId: string | null;
  departmentId: string | null;
  costCenterId: string | null;
  minValue: string;
  maxValue: string | null;
  combinationMode: "additive" | "exclusive";
  priority: number;
  steps: WizardStepInput[];
};

/**
 * The wizard's single save point (§08 rule creator). Creates the rule
 * and every requirement row in one transaction — the two-separate-forms
 * flow it replaces let a rule exist with no requirements at all,
 * silently approving nothing. Called directly from the client wizard
 * (not a <form action>), since its payload is nested, not flat fields.
 */
export async function createRuleWithRequirements(input: CreateRuleWithRequirementsInput): Promise<{ error?: string }> {
  const { user, tenant } = await requireTenantAdmin();

  const name = input.name.trim();
  if (!name) return { error: "Give this rule a name." };
  const steps = input.steps.filter((step) => step.length > 0);
  if (steps.length === 0) return { error: "Add at least one approval step." };

  await withTenant(tenant.id, async (tx) => {
    const [rule] = await tx
      .insert(approvalRules)
      .values({
        tenantId: tenant.id,
        name,
        categoryId: input.categoryId,
        departmentId: input.departmentId,
        costCenterId: input.costCenterId,
        minValue: input.minValue || "0",
        maxValue: input.maxValue,
        combinationMode: input.combinationMode,
        priority: input.priority,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();

    await tx.insert(approvalRuleRequirements).values(
      steps.flatMap((step, i) =>
        step.map((req) => ({
          tenantId: tenant.id,
          ruleId: rule.id,
          approverRoleId: req.approverRoleId,
          groupNo: i + 1,
          groupSequence: i + 1,
          minApprovalsInGroup: req.minApprovalsInGroup,
        })),
      ),
    );

    await logAction(tx, {
      tenantId: tenant.id,
      actorUserId: user.id,
      action: "approval_rule.created",
      entityType: "approval_rule",
      entityId: rule.id,
      metadata: { name, stepCount: steps.length, combinationMode: input.combinationMode, priority: input.priority },
    });
  });

  revalidatePath("/dashboard/admin/approval-rules");
  return {};
}

export async function toggleRuleActive(formData: FormData) {
  const { user, tenant } = await requireTenantAdmin();
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
