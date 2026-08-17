import { and, eq, inArray, lt, sql } from "drizzle-orm";
import type { db } from "./client";
import { db as database } from "./client";
import { logEmailResult, sendEmail } from "./email";
import {
  platformAdmins,
  supportEscalationMatrix,
  supportTicketEvents,
  supportTickets,
} from "./schema";

/**
 * The SLA sweep (docs/support-desk-plan.md §8). Phase B made breach visible in
 * the queue; this is what tells a person about it.
 *
 * Two jobs, both idempotent, both safe to run at any frequency:
 *
 *   1. Escalate newly-breached tickets straight to the level they warrant.
 *   2. Close resolved tickets the customer never confirmed.
 *
 * Idempotency is structural, not a flag: escalation only ever raises
 * `escalation_level`, and every query filters on the level being *below* the
 * one it would set. Re-running the sweep a minute later finds nothing to do.
 * That matters because a cron can fire twice, be replayed, or be poked by hand
 * while debugging, and none of those should re-notify anyone.
 *
 * Auth-free by design (same split as db/supportRouting.ts) — it runs from a
 * cron route with no session, and it needs to be testable.
 */

/** Customers get 7 days to confirm a resolution before it closes itself. */
const AUTO_CLOSE_AFTER_DAYS = 7;

type Recipient = { email: string; reason: string };

/**
 * Who hears about a ticket reaching `level`. The assigned agent is always
 * included when there is one — they own it, so they hear about it regardless of
 * what the matrix row says. The matrix adds the named contact and/or the role
 * on top.
 */
async function recipientsFor(
  level: number,
  trigger: "first_response_breach" | "resolution_breach" | "reopened_twice" | "customer_escalated",
  assignedToAdminId: string | null,
): Promise<Recipient[]> {
  const [rule] = await database
    .select()
    .from(supportEscalationMatrix)
    .where(and(eq(supportEscalationMatrix.level, level), eq(supportEscalationMatrix.trigger, trigger)))
    .limit(1);
  if (!rule) return [];

  const byId = new Map<string, Recipient>();

  if (assignedToAdminId) {
    const [agent] = await database
      .select({ id: platformAdmins.id, email: platformAdmins.email })
      .from(platformAdmins)
      .where(eq(platformAdmins.id, assignedToAdminId));
    if (agent) byId.set(agent.id, { email: agent.email, reason: "assigned agent" });
  }

  if (rule.notifyPlatformAdminId) {
    const [contact] = await database
      .select({ id: platformAdmins.id, email: platformAdmins.email })
      .from(platformAdmins)
      .where(eq(platformAdmins.id, rule.notifyPlatformAdminId));
    if (contact) byId.set(contact.id, { email: contact.email, reason: "escalation contact" });
  }

  if (rule.notifyRole) {
    const holders = await database
      .select({ id: platformAdmins.id, email: platformAdmins.email })
      .from(platformAdmins)
      .where(eq(platformAdmins.role, rule.notifyRole));
    for (const h of holders) {
      // Deduped by id, so the assigned agent who also happens to be a super
      // admin gets one email, not two.
      if (!byId.has(h.id)) byId.set(h.id, { email: h.email, reason: `role: ${rule.notifyRole}` });
    }
  }

  return [...byId.values()];
}

async function graceMinutes(level: number, trigger: "resolution_breach"): Promise<number | null> {
  const [rule] = await database
    .select({ afterMinutes: supportEscalationMatrix.afterMinutes })
    .from(supportEscalationMatrix)
    .where(and(eq(supportEscalationMatrix.level, level), eq(supportEscalationMatrix.trigger, trigger)))
    .limit(1);
  return rule?.afterMinutes ?? null;
}

export type SweepResult = {
  escalatedToL1: number;
  escalatedToL2: number;
  autoClosed: number;
};

/**
 * Runs inside one tenant's withTenant scope, like the approvals cron
 * (src/app/api/cron/escalate-approvals/route.ts) — RLS stays on rather than
 * reaching for the owner connection, and the caller iterates tenants.
 */
export async function sweepTenant(tx: typeof db, tenantId: string, now: Date = new Date()): Promise<SweepResult> {
  const result: SweepResult = { escalatedToL1: 0, escalatedToL2: 0, autoClosed: 0 };

  const OPEN = ["new", "triaged", "in_progress", "awaiting_customer"] as const;
  // A paused clock is excluded from breach entirely: awaiting_customer means the
  // ball is with the customer, and escalating support for the customer's delay
  // is exactly the noise the pause exists to prevent. A customer escalation is
  // the one thing that still counts while paused — they asked for attention.
  const ACTIVE = OPEN.filter((s) => s !== "awaiting_customer");

  const l2Grace = (await graceMinutes(2, "resolution_breach")) ?? 0;

  const candidates = await tx
    .select()
    .from(supportTickets)
    .where(
      and(
        eq(supportTickets.tenantId, tenantId),
        lt(supportTickets.escalationLevel, 2),
        inArray(supportTickets.status, [...OPEN]),
      ),
    );

  for (const ticket of candidates) {
    const active = (ACTIVE as readonly string[]).includes(ticket.status);

    const firstResponseBreached =
      active && ticket.firstRespondedAt === null && ticket.firstResponseDueAt !== null && ticket.firstResponseDueAt < now;
    const resolutionBreached =
      active && ticket.resolvedAt === null && ticket.resolutionDueAt !== null && ticket.resolutionDueAt < now;
    const pastGrace =
      resolutionBreached && ticket.resolutionDueAt!.getTime() + l2Grace * 60_000 < now.getTime();

    // Escalate straight to the level the ticket actually warrants, rather than
    // one rung per sweep. A ticket already a day past its deadline should reach
    // L2 now, not an hour from now — and going 0 → 1 → 2 across two runs would
    // also email the agent and the super admins separately about the same
    // breach seconds apart.
    let level: 1 | 2 | null = null;
    let trigger: "first_response_breach" | "resolution_breach" | "customer_escalated" | null = null;

    if (ticket.customerEscalatedAt) {
      level = 2;
      trigger = "customer_escalated";
    } else if (pastGrace) {
      level = 2;
      trigger = "resolution_breach";
    } else if (resolutionBreached) {
      level = 1;
      trigger = "resolution_breach";
    } else if (firstResponseBreached) {
      level = 1;
      trigger = "first_response_breach";
    }

    if (level === null || trigger === null || level <= ticket.escalationLevel) continue;

    await escalate(tx, tenantId, ticket, level, trigger, now);
    if (level === 1) result.escalatedToL1 += 1;
    else result.escalatedToL2 += 1;
  }

  // ---- Auto-close resolved tickets the customer never confirmed ----------
  const closeCutoff = new Date(now.getTime() - AUTO_CLOSE_AFTER_DAYS * 24 * 60 * 60_000);
  const stale = await tx
    .select()
    .from(supportTickets)
    .where(
      and(
        eq(supportTickets.tenantId, tenantId),
        eq(supportTickets.status, "resolved"),
        lt(supportTickets.resolvedAt, closeCutoff),
      ),
    );

  for (const ticket of stale) {
    await tx
      .update(supportTickets)
      // resolution_outcome and summary are deliberately left as they were: the
      // ticket was resolved on their merits, and the close is only the
      // confirmation window expiring.
      .set({ status: "closed", closedAt: now })
      .where(eq(supportTickets.id, ticket.id));

    await tx.insert(supportTicketEvents).values({
      tenantId,
      ticketId: ticket.id,
      event: "closed",
      actorKind: "system",
      fromValue: "resolved",
      toValue: "closed",
      metadata: { reason: "auto_closed_after_confirmation_window", days: AUTO_CLOSE_AFTER_DAYS },
    });
    result.autoClosed += 1;
  }

  return result;
}

async function escalate(
  tx: typeof db,
  tenantId: string,
  ticket: typeof supportTickets.$inferSelect,
  level: number,
  trigger: "first_response_breach" | "resolution_breach" | "reopened_twice" | "customer_escalated",
  now: Date,
) {
  await tx
    .update(supportTickets)
    .set({ escalationLevel: level, escalatedAt: now })
    .where(eq(supportTickets.id, ticket.id));

  await tx.insert(supportTicketEvents).values({
    tenantId,
    ticketId: ticket.id,
    event: "escalated",
    actorKind: "system",
    fromValue: String(ticket.escalationLevel),
    toValue: String(level),
    metadata: { trigger },
  });

  // Also record the breach itself, once, so the timeline shows what happened
  // rather than only that a level changed.
  if (trigger === "first_response_breach" || trigger === "resolution_breach") {
    await tx.insert(supportTicketEvents).values({
      tenantId,
      ticketId: ticket.id,
      event: "sla_breached",
      actorKind: "system",
      toValue: trigger,
      metadata: {
        dueAt:
          trigger === "first_response_breach"
            ? ticket.firstResponseDueAt?.toISOString() ?? null
            : ticket.resolutionDueAt?.toISOString() ?? null,
      },
    });
  }

  const recipients = await recipientsFor(level, trigger, ticket.assignedToAdminId);
  const subject = `L${level} escalation — ${ticket.reference}`;
  const body = [
    `${ticket.reference} has escalated to level ${level}.`,
    "",
    `Trigger: ${trigger.replace(/_/g, " ")}`,
    `Subject: ${ticket.subject}`,
    `Priority: ${ticket.priority}`,
    "",
    "Open it in the support console to pick it up.",
  ].join("\n");

  for (const recipient of recipients) {
    // Email is sent inside the sweep's transaction, the same trade-off
    // db/notifications.ts documents: sendEmail never throws, so a provider
    // failure can't roll back the escalation it was reporting.
    const sent = await sendEmail({ to: recipient.email, subject, text: body });
    logEmailResult(`support:escalation:L${level}`, recipient.email, subject, body, sent);
  }
}

/** Count of `reopened` events, used for the reopened-twice trigger. */
export async function reopenCount(tx: typeof db, ticketId: string): Promise<number> {
  const rows = await tx
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(supportTicketEvents)
    .where(and(eq(supportTicketEvents.ticketId, ticketId), eq(supportTicketEvents.event, "reopened")));
  return rows[0]?.n ?? 0;
}
