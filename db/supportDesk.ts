import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { db } from "./client";
import { adminDb } from "./adminClient";
import { withTenant } from "./withTenant";
import { getCurrentUserAndTenant } from "./session";
import { getCurrentPlatformAdmin } from "./platformSession";
import { isTenantAdmin } from "./permissions";
import { alertSuperAdminsOfUnassigned, pickAssignee, resolveSlaTargets } from "./supportRouting";
export { slaState, type SlaState } from "./supportRouting";
import { notifyUser } from "./notifications";
import {
  platformAdmins,
  supportTicketAttachments,
  supportTicketEvents,
  supportTicketMessages,
  supportTickets,
  tenants,
  users,
} from "./schema";

/**
 * Support desk data layer — customer ↔ AWA support.
 *
 * NOT the transaction clarification system (db/clarifications.ts). A support
 * ticket is a question about the product, asked of AWA; a clarification is a
 * question about a record, asked of a colleague. They share no table, no enum
 * and no status model. See docs/support-desk-plan.md §3.1.
 *
 * On adminDb: a platform admin connects as app_runtime with no app.tenant_id
 * set, so app.current_tenant_id() is null and every tenant-scoped policy
 * evaluates false — the support queue would come back empty. Exactly two
 * functions here read through the owner connection to cross tenants
 * (listQueue, searchTickets), plus resolveTicketTenant, which does nothing but
 * look up which tenant a ticket belongs to so the real work can run inside
 * withTenant. Every other read and every write in this file is tenant-scoped
 * like any other query in the app. Same precedent as db/session.ts and
 * db/tenant.ts: cross-tenant by nature, not by shortcut.
 */

export type SupportTicketStatus =
  | "new" | "triaged" | "in_progress" | "awaiting_customer" | "resolved" | "closed";

// The five words a customer ever sees. One internal state machine, one label
// map — two independent lifecycles would drift within a month.
const CUSTOMER_LABEL: Record<SupportTicketStatus, string> = {
  new: "Open",
  triaged: "Open",
  in_progress: "In progress",
  awaiting_customer: "Needs your input",
  resolved: "Resolved",
  closed: "Closed",
};

export function customerStatusLabel(status: SupportTicketStatus): string {
  return CUSTOMER_LABEL[status];
}

// =========================================================================
// Events — the ticket audit trail
// =========================================================================

type EventActor =
  | { kind: "customer"; userId: string }
  | { kind: "support"; platformAdminId: string }
  | { kind: "system" };

/**
 * One support_ticket_events row inside the caller's transaction — same
 * commit-or-roll-back-together guarantee as db/audit.ts#logAction, different
 * table, because audit_log.actor_user_id references users(id) and a platform
 * support admin has no users row.
 */
async function logTicketEvent(
  tx: typeof db,
  params: {
    tenantId: string;
    ticketId: string;
    event: string;
    actor: EventActor;
    fromValue?: string | null;
    toValue?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  await tx.insert(supportTicketEvents).values({
    tenantId: params.tenantId,
    ticketId: params.ticketId,
    event: params.event,
    actorKind: params.actor.kind,
    actorUserId: params.actor.kind === "customer" ? params.actor.userId : null,
    actorPlatformAdminId: params.actor.kind === "support" ? params.actor.platformAdminId : null,
    fromValue: params.fromValue ?? null,
    toValue: params.toValue ?? null,
    metadata: params.metadata ?? {},
  });
}

// =========================================================================
// Customer side
// =========================================================================

export type ReportInput = {
  type: "bug" | "feature_request" | "feedback" | "question";
  subject: string;
  description: string;
  pagePath?: string | null;
  pageUrl?: string | null;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  appVersion?: string | null;
  userAgent?: string | null;
  viewport?: string | null;
};

export async function createTicket(input: ReportInput) {
  const { user, tenant } = await getCurrentUserAndTenant();

  const subject = input.subject.trim();
  const description = input.description.trim();
  if (!subject || !description) {
    throw new Error("A report needs both a subject and a description.");
  }

  // Both of these run BEFORE the transaction opens, and neither can be moved
  // inside it: pickAssignee counts an agent's tickets across every tenant, which
  // withTenant would filter down to this one customer and get wrong.
  const now = new Date();
  const targets = await resolveSlaTargets(input.type, "normal", now);
  const assignedToAdminId = await pickAssignee(tenant.id, input.type);

  const ticket = await withTenant(tenant.id, async (tx) => {
    const [ticket] = await tx
      .insert(supportTickets)
      .values({
        tenantId: tenant.id,
        type: input.type,
        subject,
        description,
        reportedByUserId: user.id,
        firstResponseDueAt: targets.firstResponseDueAt,
        resolutionDueAt: targets.resolutionDueAt,
        assignedToAdminId,
        assignedAt: assignedToAdminId ? now : null,
        // Routed tickets skip 'new': someone owns it, so reporting it as
        // untouched would misstate the queue.
        status: assignedToAdminId ? "triaged" : "new",
        pagePath: input.pagePath ?? null,
        pageUrl: input.pageUrl ?? null,
        relatedEntityType: input.relatedEntityType ?? null,
        relatedEntityId: input.relatedEntityId ?? null,
        appVersion: input.appVersion ?? null,
        userAgent: input.userAgent ?? null,
        viewport: input.viewport ?? null,
      })
      .returning();

    await logTicketEvent(tx, {
      tenantId: tenant.id,
      ticketId: ticket.id,
      event: "created",
      actor: { kind: "customer", userId: user.id },
      toValue: assignedToAdminId ? "triaged" : "new",
      metadata: {
        type: input.type,
        pagePath: input.pagePath ?? null,
        firstResponseDueAt: targets.firstResponseDueAt?.toISOString() ?? null,
        resolutionDueAt: targets.resolutionDueAt?.toISOString() ?? null,
      },
    });

    if (assignedToAdminId) {
      await logTicketEvent(tx, {
        tenantId: tenant.id,
        ticketId: ticket.id,
        event: "assigned",
        // 'system', not the reporter: routing chose this, not a person.
        actor: { kind: "system" },
        toValue: assignedToAdminId,
        metadata: { rule: "auto" },
      });
    }

    return ticket;
  });

  // After the transaction, not inside it: this sends email, and a provider
  // stall must not hold a pooled Postgres connection open.
  if (!assignedToAdminId) {
    await alertSuperAdminsOfUnassigned(ticket.reference, tenant.name, subject);
  }

  return ticket;
}

/**
 * D3: the reporter always sees their own; a tenant admin sees everything their
 * organisation has raised. Deliberately not org-wide for everyone — a junior
 * buyer's feedback about their manager's approval flow isn't general reading.
 */
export async function listTicketsForCustomer() {
  const { user, tenant } = await getCurrentUserAndTenant();

  return withTenant(tenant.id, async (tx) => {
    const admin = await isTenantAdmin(tx, tenant.id, user.id);

    const rows = await tx
      .select({
        ticket: supportTickets,
        reporterName: users.fullName,
      })
      .from(supportTickets)
      .innerJoin(users, eq(users.id, supportTickets.reportedByUserId))
      .where(
        admin
          ? eq(supportTickets.tenantId, tenant.id)
          : and(eq(supportTickets.tenantId, tenant.id), eq(supportTickets.reportedByUserId, user.id)),
      )
      .orderBy(desc(supportTickets.updatedAt));

    return { rows, viewerIsTenantAdmin: admin };
  });
}

export async function getTicketForCustomer(ticketId: string) {
  const { user, tenant } = await getCurrentUserAndTenant();

  return withTenant(tenant.id, async (tx) => {
    const admin = await isTenantAdmin(tx, tenant.id, user.id);

    const [ticket] = await tx
      .select()
      .from(supportTickets)
      .where(and(eq(supportTickets.id, ticketId), eq(supportTickets.tenantId, tenant.id)))
      .limit(1);

    if (!ticket) return null;
    if (!admin && ticket.reportedByUserId !== user.id) return null;

    // The customer lane only. A support_only note must never reach here —
    // this filter, plus the DB check constraint that stops a customer ever
    // authoring one, is the pair that keeps the lanes apart.
    const messages = await tx
      .select({
        message: supportTicketMessages,
        authorName: users.fullName,
      })
      .from(supportTicketMessages)
      .leftJoin(users, eq(users.id, supportTicketMessages.authorUserId))
      .where(
        and(
          eq(supportTicketMessages.ticketId, ticketId),
          eq(supportTicketMessages.visibility, "customer"),
        ),
      )
      .orderBy(supportTicketMessages.createdAt);

    const attachments = await tx
      .select()
      .from(supportTicketAttachments)
      .where(eq(supportTicketAttachments.ticketId, ticketId))
      .orderBy(supportTicketAttachments.createdAt);

    const [reporter] = await tx
      .select({ fullName: users.fullName })
      .from(users)
      .where(eq(users.id, ticket.reportedByUserId))
      .limit(1);

    return { ticket, messages, attachments, reporterName: reporter?.fullName ?? "Unknown" };
  });
}

export async function postCustomerReply(ticketId: string, body: string) {
  const { user, tenant } = await getCurrentUserAndTenant();
  const text = body.trim();
  if (!text) throw new Error("A reply cannot be empty.");

  await withTenant(tenant.id, async (tx) => {
    const admin = await isTenantAdmin(tx, tenant.id, user.id);
    const [ticket] = await tx
      .select()
      .from(supportTickets)
      .where(and(eq(supportTickets.id, ticketId), eq(supportTickets.tenantId, tenant.id)))
      .limit(1);

    if (!ticket) throw new Error("Ticket not found.");
    if (!admin && ticket.reportedByUserId !== user.id) throw new Error("Ticket not found.");
    if (ticket.status === "closed") throw new Error("This ticket is closed. Raise a new one to continue.");

    await tx.insert(supportTicketMessages).values({
      tenantId: tenant.id,
      ticketId,
      visibility: "customer",
      body: text,
      authorUserId: user.id,
    });

    await logTicketEvent(tx, {
      tenantId: tenant.id,
      ticketId,
      event: "message_posted",
      actor: { kind: "customer", userId: user.id },
    });

    // A customer reply always takes the ball back off their court. Nobody has
    // to remember to flip the status by hand.
    if (ticket.status === "awaiting_customer") {
      // Push the resolution deadline out by however long we waited, so time
      // spent on the customer's side never counts against support. Without
      // this, any ticket where the customer takes a day to reply reads as
      // breached and the whole SLA display becomes noise people ignore.
      // first_response_due_at is untouched — that clock never pauses.
      const waitedMs = ticket.awaitingCustomerSince
        ? Date.now() - ticket.awaitingCustomerSince.getTime()
        : 0;
      const shiftedDueAt = ticket.resolutionDueAt && waitedMs > 0
        ? new Date(ticket.resolutionDueAt.getTime() + waitedMs)
        : ticket.resolutionDueAt;

      await tx
        .update(supportTickets)
        .set({ status: "in_progress", awaitingCustomerSince: null, resolutionDueAt: shiftedDueAt })
        .where(eq(supportTickets.id, ticketId));

      if (shiftedDueAt && waitedMs > 0) {
        await logTicketEvent(tx, {
          tenantId: tenant.id,
          ticketId,
          event: "sla_clock_resumed",
          actor: { kind: "system" },
          fromValue: ticket.resolutionDueAt?.toISOString() ?? null,
          toValue: shiftedDueAt.toISOString(),
          metadata: { pausedMinutes: Math.round(waitedMs / 60_000) },
        });
      }

      await logTicketEvent(tx, {
        tenantId: tenant.id,
        ticketId,
        event: "status_changed",
        actor: { kind: "system" },
        fromValue: "awaiting_customer",
        toValue: "in_progress",
      });
    }
  });
}

/** Customer confirms a resolution, closing the ticket for good. */
export async function confirmResolution(ticketId: string) {
  const { user, tenant } = await getCurrentUserAndTenant();

  await withTenant(tenant.id, async (tx) => {
    const [ticket] = await tx
      .select()
      .from(supportTickets)
      .where(and(eq(supportTickets.id, ticketId), eq(supportTickets.tenantId, tenant.id)))
      .limit(1);

    if (!ticket || ticket.status !== "resolved") return;
    if (ticket.reportedByUserId !== user.id) throw new Error("Only the person who raised this can confirm it.");

    await tx
      .update(supportTickets)
      .set({ status: "closed", closedAt: new Date() })
      .where(eq(supportTickets.id, ticketId));

    await logTicketEvent(tx, {
      tenantId: tenant.id,
      ticketId,
      event: "closed",
      actor: { kind: "customer", userId: user.id },
      fromValue: "resolved",
      toValue: "closed",
      metadata: { confirmedByCustomer: true },
    });
  });
}

/**
 * The customer's own escalation lever, usable once per ticket.
 *
 * Deliberately does NOT change priority. Priority is support's triage judgement
 * and it already shaped the SLA targets; letting a customer rewrite it would
 * let anyone reprice their own ticket. What this does is set a flag the sweep
 * picks up to raise the ticket to L2 and tell the super admins — the outcome
 * the customer actually wants, without handing them the dial.
 */
export async function customerEscalate(ticketId: string, reason: string) {
  const { user, tenant } = await getCurrentUserAndTenant();
  const text = reason.trim();
  if (!text) throw new Error("Say what's urgent about it, so support knows what changed.");

  await withTenant(tenant.id, async (tx) => {
    const [ticket] = await tx
      .select()
      .from(supportTickets)
      .where(and(eq(supportTickets.id, ticketId), eq(supportTickets.tenantId, tenant.id)))
      .limit(1);

    if (!ticket) throw new Error("Ticket not found.");
    if (ticket.reportedByUserId !== user.id) throw new Error("Only the person who raised this can escalate it.");
    if (ticket.customerEscalatedAt) throw new Error("You've already escalated this one — support has been told.");
    if (ticket.status === "resolved" || ticket.status === "closed") {
      throw new Error("This is already resolved. Reopen it instead if it isn't fixed.");
    }

    await tx
      .update(supportTickets)
      .set({ customerEscalatedAt: new Date() })
      .where(eq(supportTickets.id, ticketId));

    // Posted into the thread as well as flagged, so support sees the reason
    // rather than just a state change.
    await tx.insert(supportTicketMessages).values({
      tenantId: tenant.id,
      ticketId,
      visibility: "customer",
      body: text,
      authorUserId: user.id,
    });

    await logTicketEvent(tx, {
      tenantId: tenant.id,
      ticketId,
      event: "customer_escalated",
      actor: { kind: "customer", userId: user.id },
      metadata: { reason: text },
    });
  });
}

/** Reopen within 14 days of resolution; after that it's a new ticket. */
const REOPEN_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export async function reopenTicket(ticketId: string, reason: string) {
  const { user, tenant } = await getCurrentUserAndTenant();
  const text = reason.trim();
  if (!text) throw new Error("Say what's still wrong so support knows where to pick up.");

  await withTenant(tenant.id, async (tx) => {
    const [ticket] = await tx
      .select()
      .from(supportTickets)
      .where(and(eq(supportTickets.id, ticketId), eq(supportTickets.tenantId, tenant.id)))
      .limit(1);

    if (!ticket || ticket.status !== "resolved") throw new Error("Only a resolved ticket can be reopened.");
    if (ticket.reportedByUserId !== user.id) throw new Error("Only the person who raised this can reopen it.");
    if (ticket.resolvedAt && Date.now() - ticket.resolvedAt.getTime() > REOPEN_WINDOW_MS) {
      throw new Error("This was resolved more than 14 days ago — please raise a new ticket instead.");
    }

    await tx.insert(supportTicketMessages).values({
      tenantId: tenant.id,
      ticketId,
      visibility: "customer",
      body: text,
      authorUserId: user.id,
    });

    // Clearing the outcome and summary is required, not tidiness: the
    // resolution_complete check constraint only permits them to be null while
    // the ticket is not resolved/closed, and it would reject the reopen if the
    // status moved back with them still set.
    await tx
      .update(supportTickets)
      .set({ status: "in_progress", resolvedAt: null, resolutionOutcome: null, resolutionSummary: null })
      .where(eq(supportTickets.id, ticketId));

    await logTicketEvent(tx, {
      tenantId: tenant.id,
      ticketId,
      event: "reopened",
      actor: { kind: "customer", userId: user.id },
      fromValue: "resolved",
      toValue: "in_progress",
    });
  });
}

// =========================================================================
// Platform side
// =========================================================================

/**
 * Phase A: every platform admin is a support agent. Phase B introduces the
 * support_agents roster with routing config, and this is where that check
 * lands — one function to change, not every call site.
 */
export async function getCurrentSupportAgent() {
  return getCurrentPlatformAdmin();
}

export type QueueFilters = {
  status?: SupportTicketStatus[];
  tenantId?: string;
  assignedToAdminId?: string;
  unassignedOnly?: boolean;
};

const OPEN_STATUSES: SupportTicketStatus[] = ["new", "triaged", "in_progress", "awaiting_customer"];

/**
 * CROSS-TENANT READ (1 of 2). The support queue spans every customer by
 * definition, so it runs on the owner connection. Guarded by
 * getCurrentSupportAgent() at every call site — never export a path to this
 * that skips it.
 */
export async function listQueue(filters: QueueFilters = {}) {
  const statuses = filters.status ?? OPEN_STATUSES;

  const conditions = [inArray(supportTickets.status, statuses)];
  if (filters.tenantId) conditions.push(eq(supportTickets.tenantId, filters.tenantId));
  if (filters.assignedToAdminId) conditions.push(eq(supportTickets.assignedToAdminId, filters.assignedToAdminId));
  if (filters.unassignedOnly) conditions.push(sql`${supportTickets.assignedToAdminId} is null`);

  return adminDb
    .select({
      ticket: supportTickets,
      tenantName: tenants.name,
      tenantSlug: tenants.slug,
      reporterName: users.fullName,
      reporterEmail: users.email,
      assigneeName: platformAdmins.fullName,
    })
    .from(supportTickets)
    .innerJoin(tenants, eq(tenants.id, supportTickets.tenantId))
    .innerJoin(users, eq(users.id, supportTickets.reportedByUserId))
    .leftJoin(platformAdmins, eq(platformAdmins.id, supportTickets.assignedToAdminId))
    .where(and(...conditions))
    .orderBy(desc(supportTickets.createdAt));
}

/** CROSS-TENANT READ (2 of 2). */
export async function searchTickets(query: string) {
  const q = `%${query.trim()}%`;
  return adminDb
    .select({
      ticket: supportTickets,
      tenantName: tenants.name,
      tenantSlug: tenants.slug,
    })
    .from(supportTickets)
    .innerJoin(tenants, eq(tenants.id, supportTickets.tenantId))
    .where(sql`${supportTickets.subject} ilike ${q} or ${supportTickets.reference} ilike ${q}`)
    .orderBy(desc(supportTickets.createdAt))
    .limit(50);
}

/**
 * Resolves which tenant a ticket belongs to so the caller can re-enter
 * withTenant. Reads one column from one row on the owner connection; the ticket
 * body is then fetched under normal tenant scope like everything else.
 */
async function resolveTicketTenant(ticketId: string): Promise<string | null> {
  const [row] = await adminDb
    .select({ tenantId: supportTickets.tenantId })
    .from(supportTickets)
    .where(eq(supportTickets.id, ticketId))
    .limit(1);
  return row?.tenantId ?? null;
}

export async function getTicketForSupport(ticketId: string) {
  const tenantId = await resolveTicketTenant(ticketId);
  if (!tenantId) return null;

  return withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .select({
        ticket: supportTickets,
        tenantName: tenants.name,
        tenantSlug: tenants.slug,
        tenantStatus: tenants.status,
        reporterName: users.fullName,
        reporterEmail: users.email,
      })
      .from(supportTickets)
      .innerJoin(tenants, eq(tenants.id, supportTickets.tenantId))
      .innerJoin(users, eq(users.id, supportTickets.reportedByUserId))
      .where(eq(supportTickets.id, ticketId))
      .limit(1);

    if (!row) return null;

    // Support sees both lanes — that is the whole difference from
    // getTicketForCustomer, which filters to visibility = 'customer'.
    const messages = await tx
      .select({
        message: supportTicketMessages,
        customerAuthorName: users.fullName,
        supportAuthorName: platformAdmins.fullName,
      })
      .from(supportTicketMessages)
      .leftJoin(users, eq(users.id, supportTicketMessages.authorUserId))
      .leftJoin(platformAdmins, eq(platformAdmins.id, supportTicketMessages.authorPlatformAdminId))
      .where(eq(supportTicketMessages.ticketId, ticketId))
      .orderBy(supportTicketMessages.createdAt);

    const attachments = await tx
      .select()
      .from(supportTicketAttachments)
      .where(eq(supportTicketAttachments.ticketId, ticketId))
      .orderBy(supportTicketAttachments.createdAt);

    const events = await tx
      .select({
        event: supportTicketEvents,
        customerActorName: users.fullName,
        supportActorName: platformAdmins.fullName,
      })
      .from(supportTicketEvents)
      .leftJoin(users, eq(users.id, supportTicketEvents.actorUserId))
      .leftJoin(platformAdmins, eq(platformAdmins.id, supportTicketEvents.actorPlatformAdminId))
      .where(eq(supportTicketEvents.ticketId, ticketId))
      .orderBy(desc(supportTicketEvents.occurredAt));

    const assignees = await tx.select().from(platformAdmins).orderBy(platformAdmins.fullName);

    return { ...row, messages, attachments, events, assignees, tenantId };
  });
}

export async function postSupportReply(
  ticketId: string,
  body: string,
  options: { visibility: "customer" | "support_only"; isQuestion: boolean },
) {
  const admin = await getCurrentSupportAgent();
  const text = body.trim();
  if (!text) throw new Error("A reply cannot be empty.");

  const tenantId = await resolveTicketTenant(ticketId);
  if (!tenantId) throw new Error("Ticket not found.");

  // A support_only note is not a reply to anyone — flagging one as a question
  // would move the ticket to awaiting_customer while the customer has not been
  // asked anything, and the ticket would sit there forever.
  const isQuestion = options.visibility === "customer" && options.isQuestion;

  const notify = await withTenant(tenantId, async (tx) => {
    const [ticket] = await tx.select().from(supportTickets).where(eq(supportTickets.id, ticketId)).limit(1);
    if (!ticket) throw new Error("Ticket not found.");

    await tx.insert(supportTicketMessages).values({
      tenantId,
      ticketId,
      visibility: options.visibility,
      body: text,
      isQuestion,
      authorPlatformAdminId: admin.id,
    });

    await logTicketEvent(tx, {
      tenantId,
      ticketId,
      event: options.visibility === "support_only" ? "support_note_added" : "message_posted",
      actor: { kind: "support", platformAdminId: admin.id },
      metadata: { isQuestion },
    });

    const patch: Partial<typeof supportTickets.$inferInsert> = {};

    // First response is a customer-facing fact; a private note isn't one.
    if (options.visibility === "customer" && !ticket.firstRespondedAt) {
      patch.firstRespondedAt = new Date();
    }

    let statusChange: { from: string; to: string } | null = null;
    if (isQuestion && ticket.status !== "awaiting_customer" && ticket.status !== "closed") {
      patch.status = "awaiting_customer";
      // Stamp the pause start; postCustomerReply reads it to shift the due date.
      patch.awaitingCustomerSince = new Date();
      statusChange = { from: ticket.status, to: "awaiting_customer" };
    } else if (options.visibility === "customer" && (ticket.status === "new" || ticket.status === "triaged")) {
      patch.status = "in_progress";
      statusChange = { from: ticket.status, to: "in_progress" };
    }

    if (Object.keys(patch).length > 0) {
      await tx.update(supportTickets).set(patch).where(eq(supportTickets.id, ticketId));
    }
    if (statusChange) {
      await logTicketEvent(tx, {
        tenantId,
        ticketId,
        event: "status_changed",
        actor: { kind: "system" },
        fromValue: statusChange.from,
        toValue: statusChange.to,
      });
    }

    // Only a customer-visible reply is worth telling the customer about.
    if (options.visibility === "customer") {
      await notifyUser(
        tx,
        ticket.reportedByUserId,
        "support_ticket_replied",
        `AWA Support replied — ${ticket.reference}`,
        `${ticket.subject}\n\n${text}`,
      );
    }
    return null;
  });

  return notify;
}

export async function assignTicket(ticketId: string, toAdminId: string | null) {
  const admin = await getCurrentSupportAgent();
  const tenantId = await resolveTicketTenant(ticketId);
  if (!tenantId) throw new Error("Ticket not found.");

  await withTenant(tenantId, async (tx) => {
    const [ticket] = await tx.select().from(supportTickets).where(eq(supportTickets.id, ticketId)).limit(1);
    if (!ticket) throw new Error("Ticket not found.");

    await tx
      .update(supportTickets)
      .set({
        assignedToAdminId: toAdminId,
        assignedAt: toAdminId ? new Date() : null,
        // Picking a ticket up is triage; leaving it 'new' after someone owns
        // it would misreport the queue.
        status: toAdminId && ticket.status === "new" ? "triaged" : ticket.status,
      })
      .where(eq(supportTickets.id, ticketId));

    await logTicketEvent(tx, {
      tenantId,
      ticketId,
      event: ticket.assignedToAdminId ? "reassigned" : "assigned",
      actor: { kind: "support", platformAdminId: admin.id },
      fromValue: ticket.assignedToAdminId,
      toValue: toAdminId,
    });
  });
}

export async function setTicketPriority(ticketId: string, priority: "urgent" | "high" | "normal" | "low") {
  const admin = await getCurrentSupportAgent();
  const tenantId = await resolveTicketTenant(ticketId);
  if (!tenantId) throw new Error("Ticket not found.");

  await withTenant(tenantId, async (tx) => {
    const [ticket] = await tx.select().from(supportTickets).where(eq(supportTickets.id, ticketId)).limit(1);
    if (!ticket || ticket.priority === priority) return;

    await tx.update(supportTickets).set({ priority }).where(eq(supportTickets.id, ticketId));
    await logTicketEvent(tx, {
      tenantId,
      ticketId,
      event: "priority_changed",
      actor: { kind: "support", platformAdminId: admin.id },
      fromValue: ticket.priority,
      toValue: priority,
    });
  });
}

export async function resolveTicket(
  ticketId: string,
  outcome: "fixed" | "shipped" | "wont_do" | "duplicate" | "not_a_bug" | "no_response",
  summary: string,
) {
  const admin = await getCurrentSupportAgent();
  const text = summary.trim();
  // Enforced by a check constraint too — this is the friendlier of the two.
  if (!text) throw new Error("A resolution needs a summary. The customer reads it.");

  const tenantId = await resolveTicketTenant(ticketId);
  if (!tenantId) throw new Error("Ticket not found.");

  await withTenant(tenantId, async (tx) => {
    const [ticket] = await tx.select().from(supportTickets).where(eq(supportTickets.id, ticketId)).limit(1);
    if (!ticket) throw new Error("Ticket not found.");

    await tx
      .update(supportTickets)
      .set({ status: "resolved", resolvedAt: new Date(), resolutionOutcome: outcome, resolutionSummary: text })
      .where(eq(supportTickets.id, ticketId));

    await logTicketEvent(tx, {
      tenantId,
      ticketId,
      event: "resolved",
      actor: { kind: "support", platformAdminId: admin.id },
      fromValue: ticket.status,
      toValue: "resolved",
      metadata: { outcome },
    });

    await notifyUser(
      tx,
      ticket.reportedByUserId,
      "support_ticket_resolved",
      `Resolved — ${ticket.reference}`,
      `${ticket.subject}\n\n${text}`,
    );
  });
}
