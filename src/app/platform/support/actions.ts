"use server";

import { revalidatePath } from "next/cache";
import { assignTicket, postSupportReply, resolveTicket, setTicketPriority } from "@/db/supportDesk";

/**
 * Every action here re-checks the caller through getCurrentSupportAgent()
 * inside the db layer. A server action is reachable by direct POST, so the
 * fact that the nav is only rendered for platform admins proves nothing.
 */

const OUTCOMES = ["fixed", "shipped", "wont_do", "duplicate", "not_a_bug", "no_response"] as const;
const PRIORITIES = ["urgent", "high", "normal", "low"] as const;

export async function replyAsSupport(formData: FormData) {
  const ticketId = String(formData.get("ticketId") ?? "");
  const body = String(formData.get("body") ?? "");
  const visibility = formData.get("visibility") === "support_only" ? "support_only" : "customer";
  const isQuestion = formData.get("isQuestion") === "on";
  if (!ticketId) return;

  await postSupportReply(ticketId, body, { visibility, isQuestion });
  revalidatePath(`/platform/support/${ticketId}`);
  revalidatePath("/platform/support");
}

export async function assign(formData: FormData) {
  const ticketId = String(formData.get("ticketId") ?? "");
  const raw = String(formData.get("assignedToAdminId") ?? "");
  if (!ticketId) return;

  await assignTicket(ticketId, raw || null);
  revalidatePath(`/platform/support/${ticketId}`);
  revalidatePath("/platform/support");
}

export async function changePriority(formData: FormData) {
  const ticketId = String(formData.get("ticketId") ?? "");
  const raw = String(formData.get("priority") ?? "");
  if (!ticketId || !(PRIORITIES as readonly string[]).includes(raw)) return;

  await setTicketPriority(ticketId, raw as (typeof PRIORITIES)[number]);
  revalidatePath(`/platform/support/${ticketId}`);
  revalidatePath("/platform/support");
}

export async function resolve(formData: FormData) {
  const ticketId = String(formData.get("ticketId") ?? "");
  const raw = String(formData.get("outcome") ?? "");
  const summary = String(formData.get("summary") ?? "");
  if (!ticketId || !(OUTCOMES as readonly string[]).includes(raw)) return;

  await resolveTicket(ticketId, raw as (typeof OUTCOMES)[number], summary);
  revalidatePath(`/platform/support/${ticketId}`);
  revalidatePath("/platform/support");
}
