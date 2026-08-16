"use server";

import { revalidatePath } from "next/cache";
import { getCurrentSupportAgent } from "@/db/supportDesk";
import {
  addAgent,
  setAgentActive,
  updateAgentRouting,
  type SupportTicketType,
} from "@/db/supportRouting";

/**
 * Every action re-checks the caller. A server action is reachable by direct
 * POST, so the fact that /platform's layout hides the nav from non-admins
 * proves nothing about who is calling this.
 */

const TYPES: SupportTicketType[] = ["bug", "feature_request", "feedback", "question"];

export async function addAgentAction(formData: FormData) {
  await getCurrentSupportAgent();
  const platformAdminId = String(formData.get("platformAdminId") ?? "");
  if (!platformAdminId) return;

  await addAgent(platformAdminId);
  revalidatePath("/platform/support/agents");
}

export async function toggleAgentActive(formData: FormData) {
  await getCurrentSupportAgent();
  const agentId = String(formData.get("agentId") ?? "");
  if (!agentId) return;

  await setAgentActive(agentId, formData.get("active") === "true");
  revalidatePath("/platform/support/agents");
  revalidatePath("/platform/support");
}

export async function updateRouting(formData: FormData) {
  await getCurrentSupportAgent();
  const agentId = String(formData.get("agentId") ?? "");
  if (!agentId) return;

  // getAll: an unchecked box submits nothing, so an empty result genuinely
  // means "none selected" — which for both of these fields is the wildcard
  // ("all types", "all customers"), not an empty capability.
  const handlesTypes = formData
    .getAll("handlesTypes")
    .map(String)
    .filter((t): t is SupportTicketType => (TYPES as string[]).includes(t));
  const coversTenantIds = formData.getAll("coversTenantIds").map(String).filter(Boolean);

  const rawMax = String(formData.get("maxOpen") ?? "").trim();
  const parsed = rawMax === "" ? null : Number(rawMax);
  const maxOpen = parsed !== null && Number.isFinite(parsed) ? parsed : null;

  await updateAgentRouting(agentId, { handlesTypes, coversTenantIds, maxOpen });
  revalidatePath("/platform/support/agents");
}
