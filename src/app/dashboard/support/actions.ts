"use server";

import { revalidatePath } from "next/cache";
import {
  confirmResolution,
  createTicket,
  postCustomerReply,
  reopenTicket,
  type ReportInput,
} from "@/db/supportDesk";

const TYPES = ["bug", "feature_request", "feedback", "question"] as const;

function parseType(raw: string): ReportInput["type"] {
  return (TYPES as readonly string[]).includes(raw) ? (raw as ReportInput["type"]) : "bug";
}

/**
 * The report widget posts here from anywhere in the dashboard. Tenant and user
 * come from the session inside createTicket, never from the form — a server
 * action is reachable by direct POST, so anything identity-shaped in the
 * payload would be a claim, not a fact.
 */
export async function submitReport(formData: FormData): Promise<{ id: string; reference: string }> {
  const ticket = await createTicket({
    type: parseType(String(formData.get("type") ?? "bug")),
    subject: String(formData.get("subject") ?? ""),
    description: String(formData.get("description") ?? ""),
    pagePath: String(formData.get("pagePath") ?? "") || null,
    pageUrl: String(formData.get("pageUrl") ?? "") || null,
    appVersion: String(formData.get("appVersion") ?? "") || null,
    userAgent: String(formData.get("userAgent") ?? "") || null,
    viewport: String(formData.get("viewport") ?? "") || null,
  });

  revalidatePath("/dashboard/support");
  // Returns rather than redirects: the widget uploads any attachments against
  // this id before navigating, which it cannot do if the action redirects.
  return { id: ticket.id, reference: ticket.reference };
}

export async function replyToTicket(formData: FormData) {
  const ticketId = String(formData.get("ticketId") ?? "");
  const body = String(formData.get("body") ?? "");
  if (!ticketId) return;

  await postCustomerReply(ticketId, body);
  revalidatePath(`/dashboard/support/${ticketId}`);
  revalidatePath("/dashboard/support");
}

export async function confirmTicketResolved(formData: FormData) {
  const ticketId = String(formData.get("ticketId") ?? "");
  if (!ticketId) return;

  await confirmResolution(ticketId);
  revalidatePath(`/dashboard/support/${ticketId}`);
  revalidatePath("/dashboard/support");
}

export async function reopenTicketAction(formData: FormData) {
  const ticketId = String(formData.get("ticketId") ?? "");
  const reason = String(formData.get("reason") ?? "");
  if (!ticketId) return;

  await reopenTicket(ticketId, reason);
  revalidatePath(`/dashboard/support/${ticketId}`);
  revalidatePath("/dashboard/support");
}
