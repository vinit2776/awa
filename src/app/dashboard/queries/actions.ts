"use server";

import { revalidatePath } from "next/cache";
import {
  raiseClarification,
  replyToClarification,
  resolveClarification,
  withdrawClarification,
} from "@/db/clarifications";
import type { ClarificationEntityType } from "@/db/clarificationRules";

const ENTITY_TYPES = [
  "requisition",
  "purchase_order",
  "invoice",
  "goods_receipt",
  "quotation",
] as const;

function parseEntityType(raw: string): ClarificationEntityType | null {
  return (ENTITY_TYPES as readonly string[]).includes(raw) ? (raw as ClarificationEntityType) : null;
}

/**
 * `returnTo` is the record page the panel is embedded in, so the revalidation
 * lands on whichever record raised the query without this file needing to know
 * every route that hosts the panel.
 */
function revalidateBoth(returnTo: string) {
  if (returnTo.startsWith("/dashboard/")) revalidatePath(returnTo);
  revalidatePath("/dashboard/queries");
}

export async function askQuestion(formData: FormData) {
  const entityType = parseEntityType(String(formData.get("entityType") ?? ""));
  const entityId = String(formData.get("entityId") ?? "");
  const question = String(formData.get("question") ?? "");
  const assignedToUserId = String(formData.get("assignedToUserId") ?? "") || null;
  const blocksProgress = formData.get("blocksProgress") === "on";
  const returnTo = String(formData.get("returnTo") ?? "");
  if (!entityType || !entityId) return;

  await raiseClarification({ entityType, entityId, question, assignedToUserId, blocksProgress });
  revalidateBoth(returnTo);
}

export async function replyToQuery(formData: FormData) {
  const clarificationId = String(formData.get("clarificationId") ?? "");
  const body = String(formData.get("body") ?? "");
  const returnTo = String(formData.get("returnTo") ?? "");
  if (!clarificationId) return;

  await replyToClarification(clarificationId, body);
  revalidateBoth(returnTo);
}

export async function resolveQuery(formData: FormData) {
  const clarificationId = String(formData.get("clarificationId") ?? "");
  const returnTo = String(formData.get("returnTo") ?? "");
  if (!clarificationId) return;

  await resolveClarification(clarificationId);
  revalidateBoth(returnTo);
}

export async function withdrawQuery(formData: FormData) {
  const clarificationId = String(formData.get("clarificationId") ?? "");
  const returnTo = String(formData.get("returnTo") ?? "");
  if (!clarificationId) return;

  await withdrawClarification(clarificationId);
  revalidateBoth(returnTo);
}
