"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getCurrentSupportAgent } from "@/db/supportDesk";
import { withTenant } from "@/db/withTenant";
import { supportSlaOverrides } from "@/db/schema";
import type { SupportTicketPriority, SupportTicketType } from "@/db/supportRouting";

const TYPES = ["bug", "feature_request", "feedback", "question"];
const PRIORITIES = ["urgent", "high", "normal", "low"];

/**
 * Overrides are tenant-scoped, so every write goes through withTenant for the
 * tenant being configured — even though the operator is a platform admin. That
 * keeps the RLS with-check in play rather than trusting the form's tenantId.
 */
export async function saveOverride(formData: FormData) {
  await getCurrentSupportAgent();

  const tenantId = String(formData.get("tenantId") ?? "");
  const ticketType = String(formData.get("ticketType") ?? "");
  const priority = String(formData.get("priority") ?? "");
  if (!tenantId || !TYPES.includes(ticketType) || !PRIORITIES.includes(priority)) return;

  const firstResponse = Number(String(formData.get("firstResponseMinutes") ?? "").trim());
  const rawResolution = String(formData.get("resolutionMinutes") ?? "").trim();
  if (!Number.isFinite(firstResponse) || firstResponse <= 0) return;

  // Blank resolution means "no target" — a legitimate override, not a mistake:
  // it can remove a target the global policy sets.
  const resolution = rawResolution === "" ? null : Number(rawResolution);
  if (resolution !== null && (!Number.isFinite(resolution) || resolution <= 0)) return;

  await withTenant(tenantId, (tx) =>
    tx
      .insert(supportSlaOverrides)
      .values({
        tenantId,
        ticketType: ticketType as SupportTicketType,
        priority: priority as SupportTicketPriority,
        firstResponseMinutes: firstResponse,
        resolutionMinutes: resolution,
      })
      .onConflictDoUpdate({
        target: [supportSlaOverrides.tenantId, supportSlaOverrides.ticketType, supportSlaOverrides.priority],
        set: { firstResponseMinutes: firstResponse, resolutionMinutes: resolution },
      }),
  );

  revalidatePath("/platform/support/sla");
}

export async function removeOverride(formData: FormData) {
  await getCurrentSupportAgent();
  const tenantId = String(formData.get("tenantId") ?? "");
  const overrideId = String(formData.get("overrideId") ?? "");
  if (!tenantId || !overrideId) return;

  await withTenant(tenantId, (tx) =>
    tx
      .delete(supportSlaOverrides)
      .where(and(eq(supportSlaOverrides.id, overrideId), eq(supportSlaOverrides.tenantId, tenantId))),
  );

  revalidatePath("/platform/support/sla");
}
