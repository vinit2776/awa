import { and, eq, sql } from "drizzle-orm";
import { db as database } from "./client";
import { adminDb } from "./adminClient";
import { logEmailResult, sendEmail } from "./email";
import { platformAdmins, supportAgents, supportSlaPolicies, supportTickets } from "./schema";

/**
 * The auth-free half of the support desk: routing and the TAT clock.
 *
 * Split out of db/supportDesk.ts for the same reason db/clarificationRules.ts
 * is split out of db/clarifications.ts — that file imports
 * getCurrentUserAndTenant, which reaches withAuth in
 * @workos-inc/authkit-nextjs and pulls next/cache in at module load. Any vitest
 * file importing it fails before a single test runs. Everything here takes
 * plain arguments, so it is directly testable.
 */

export type SupportTicketType = "bug" | "feature_request" | "feedback" | "question";
export type SupportTicketPriority = "urgent" | "high" | "normal" | "low";

// =========================================================================
// Routing & TAT (Phase B — §7, §8)
// =========================================================================

export type SlaTargets = { firstResponseDueAt: Date | null; resolutionDueAt: Date | null };

/**
 * Reads support_sla_policies, which carries no tenant_id and therefore no RLS —
 * so the ordinary app_runtime connection sees it with no tenant scope set. Every
 * (type, priority) pair is seeded, so a miss means the seed is incomplete rather
 * than "this combination has no target"; the caller treats null targets as "no
 * clock" either way, which is the safe direction: a ticket with no due date is
 * never falsely reported as breached.
 */
export async function resolveSlaTargets(
  type: SupportTicketType,
  priority: SupportTicketPriority,
  from: Date,
): Promise<SlaTargets> {
  const [policy] = await database
    .select()
    .from(supportSlaPolicies)
    .where(and(eq(supportSlaPolicies.ticketType, type), eq(supportSlaPolicies.priority, priority)))
    .limit(1);

  if (!policy) return { firstResponseDueAt: null, resolutionDueAt: null };

  return {
    firstResponseDueAt: new Date(from.getTime() + policy.firstResponseMinutes * 60_000),
    // Deliberately stays null for feature requests and feedback: a backlog item
    // has no honest resolution target, and inventing one would make every such
    // ticket a permanent breach.
    resolutionDueAt: policy.resolutionMinutes === null
      ? null
      : new Date(from.getTime() + policy.resolutionMinutes * 60_000),
  };
}

/**
 * Picks an assignee for a new ticket. Deterministic, three steps (§7).
 *
 * CROSS-TENANT BY NECESSITY: an agent's workload spans every customer, so the
 * open-ticket counts come from the owner connection. Running this inside
 * withTenant(tenantId) would silently count only the current customer's tickets
 * and hand every new ticket to whoever happens to be quiet in that one tenant.
 * That's why this runs before the transaction opens, not inside it.
 *
 * Returns null when routing has nothing to say — the ticket is still created,
 * just unassigned. Same "never get stuck" rule as isTenantAdmin's zero-admin
 * bootstrap.
 */
export async function pickAssignee(
  tenantId: string,
  type: SupportTicketType,
): Promise<string | null> {
  const roster = await database.select().from(supportAgents).where(eq(supportAgents.active, true));
  if (roster.length === 0) return null;

  // Step 1 — a named account owner beats load balancing outright.
  const owners = roster.filter((a) => a.coversTenantIds.includes(tenantId));
  // Step 2 — otherwise, agents who handle this type (empty list = all types).
  const candidates = owners.length > 0
    ? owners
    : roster.filter((a) => a.handlesTypes.length === 0 || a.handlesTypes.includes(type));
  if (candidates.length === 0) return null;

  const load = await adminDb
    .select({
      adminId: supportTickets.assignedToAdminId,
      openCount: sql<number>`count(*) filter (where ${supportTickets.status} not in ('resolved','closed'))`.mapWith(Number),
      lastAssignedAt: sql<Date | null>`max(${supportTickets.assignedAt})`,
    })
    .from(supportTickets)
    .where(sql`${supportTickets.assignedToAdminId} is not null`)
    .groupBy(supportTickets.assignedToAdminId);

  const byAdmin = new Map(load.map((r) => [r.adminId!, r]));

  const eligible = candidates.filter((a) => {
    const openCount = byAdmin.get(a.platformAdminId)?.openCount ?? 0;
    return a.maxOpen === null || openCount < a.maxOpen;
  });
  // Everyone at capacity: leave it unassigned rather than pushing a ticket onto
  // an agent who is already over their declared limit.
  if (eligible.length === 0) return null;

  eligible.sort((a, b) => {
    const aLoad = byAdmin.get(a.platformAdminId)?.openCount ?? 0;
    const bLoad = byAdmin.get(b.platformAdminId)?.openCount ?? 0;
    if (aLoad !== bLoad) return aLoad - bLoad;
    // Tie-break: longest since last assignment. Never-assigned sorts first,
    // which is what gets a newly added agent their first ticket.
    const aLast = byAdmin.get(a.platformAdminId)?.lastAssignedAt;
    const bLast = byAdmin.get(b.platformAdminId)?.lastAssignedAt;
    if (!aLast) return -1;
    if (!bLast) return 1;
    return new Date(aLast).getTime() - new Date(bLast).getTime();
  });

  return eligible[0].platformAdminId;
}

/**
 * A ticket nobody was routed to is the one case where the queue alone isn't
 * enough — nothing surfaces it to a person. Super admins get told directly.
 * Platform admins have no users row, so notifyUser() can't reach them; email is
 * the only channel they have, and it degrades to a log line when unconfigured.
 */
export async function alertSuperAdminsOfUnassigned(reference: string, tenantName: string, subject: string) {
  const admins = await database
    .select({ email: platformAdmins.email })
    .from(platformAdmins)
    .where(eq(platformAdmins.role, "super_admin"));

  const body = [
    `${reference} came in from ${tenantName} and routing had no eligible agent for it.`,
    "",
    subject,
    "",
    "It is in the queue unassigned — assign it by hand, or check the agent roster at /platform/support/agents.",
  ].join("\n");

  for (const admin of admins) {
    const result = await sendEmail({ to: admin.email, subject: `Unassigned support ticket — ${reference}`, text: body });
    logEmailResult("support:unassigned", admin.email, `Unassigned support ticket — ${reference}`, body, result);
  }
}

/** Derived SLA state for the queue. Breach is never stored (§8). */
export type SlaState = {
  firstResponseBreached: boolean;
  resolutionBreached: boolean;
  resolutionDueAt: Date | null;
  /** Null when there is no target, or the clock is paused, or it's resolved. */
  minutesToResolution: number | null;
  paused: boolean;
};

export function slaState(ticket: {
  status: string;
  firstRespondedAt: Date | null;
  firstResponseDueAt: Date | null;
  resolvedAt: Date | null;
  resolutionDueAt: Date | null;
  awaitingCustomerSince: Date | null;
}, now: Date = new Date()): SlaState {
  const paused = ticket.status === "awaiting_customer";
  const settled = ticket.status === "resolved" || ticket.status === "closed";

  return {
    firstResponseBreached:
      ticket.firstRespondedAt === null &&
      ticket.firstResponseDueAt !== null &&
      now > ticket.firstResponseDueAt,
    // A paused clock cannot breach — that is the whole point of pausing it.
    resolutionBreached:
      !settled && !paused && ticket.resolutionDueAt !== null && now > ticket.resolutionDueAt,
    resolutionDueAt: ticket.resolutionDueAt,
    minutesToResolution:
      settled || paused || ticket.resolutionDueAt === null
        ? null
        : Math.round((ticket.resolutionDueAt.getTime() - now.getTime()) / 60_000),
    paused,
  };
}

// =========================================================================
// Roster management (/platform/support/agents)
// =========================================================================

/** Everyone on the roster, plus the platform admins not yet on it. */
export async function listAgentRoster() {
  const roster = await database
    .select({ agent: supportAgents, admin: platformAdmins })
    .from(supportAgents)
    .innerJoin(platformAdmins, eq(platformAdmins.id, supportAgents.platformAdminId))
    .orderBy(platformAdmins.fullName);

  const onRoster = new Set(roster.map((r) => r.admin.id));
  const allAdmins = await database.select().from(platformAdmins).orderBy(platformAdmins.fullName);

  // Load is shown per agent for the same reason routing uses it — and from the
  // same cross-tenant source, so the number an operator sees matches the number
  // the router actually decided on.
  const load = await adminDb
    .select({
      adminId: supportTickets.assignedToAdminId,
      openCount: sql<number>`count(*) filter (where ${supportTickets.status} not in ('resolved','closed'))`.mapWith(Number),
    })
    .from(supportTickets)
    .where(sql`${supportTickets.assignedToAdminId} is not null`)
    .groupBy(supportTickets.assignedToAdminId);

  const openByAdmin = new Map(load.map((r) => [r.adminId!, r.openCount]));

  return {
    roster: roster.map((r) => ({ ...r, openCount: openByAdmin.get(r.admin.id) ?? 0 })),
    unrostered: allAdmins.filter((a) => !onRoster.has(a.id)),
  };
}

export async function addAgent(platformAdminId: string) {
  await database.insert(supportAgents).values({ platformAdminId }).onConflictDoNothing();
}

export async function setAgentActive(agentId: string, active: boolean) {
  await database.update(supportAgents).set({ active }).where(eq(supportAgents.id, agentId));
}

export async function updateAgentRouting(
  agentId: string,
  settings: { handlesTypes: SupportTicketType[]; coversTenantIds: string[]; maxOpen: number | null },
) {
  await database
    .update(supportAgents)
    .set({
      handlesTypes: settings.handlesTypes,
      coversTenantIds: settings.coversTenantIds,
      // 0 would mean "can never be assigned", which `active = false` already
      // expresses more clearly; the DB check constraint rejects it outright.
      maxOpen: settings.maxOpen && settings.maxOpen > 0 ? settings.maxOpen : null,
    })
    .where(eq(supportAgents.id, agentId));
}
