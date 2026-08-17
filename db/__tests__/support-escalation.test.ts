import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { adminDb } from "../adminClient";
import { withTenant } from "../withTenant";
import { sweepTenant } from "../supportEscalation";
import { platformAdmins, supportTicketEvents, supportTickets, tenants, users } from "../schema";

/**
 * The SLA sweep. The property that matters most is idempotency: a cron can
 * fire twice, be replayed, or be poked by hand, and none of those may
 * re-escalate a ticket or re-email anyone.
 */

let tenant: typeof tenants.$inferSelect;
let reporter: typeof users.$inferSelect;
let agent: typeof platformAdmins.$inferSelect;

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

beforeAll(async () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  [tenant] = await adminDb
    .insert(tenants)
    .values({ name: "Escalation Test", slug: `esc-test-${suffix}` })
    .returning();
  [agent] = await adminDb
    .insert(platformAdmins)
    .values({ email: `esc-agent-${suffix}@awa.test`, fullName: "Esc Agent", role: "support" })
    .returning();
  [reporter] = await withTenant(tenant.id, (tx) =>
    tx
      .insert(users)
      .values({ tenantId: tenant.id, email: `esc-${suffix}@example.com`, fullName: "Reporter", status: "active" })
      .returning(),
  );
});

afterEachCleanup();
function afterEachCleanup() {
  beforeEach(async () => {
    await adminDb.delete(supportTicketEvents).where(eq(supportTicketEvents.tenantId, tenant?.id ?? ""));
    await adminDb.delete(supportTickets).where(eq(supportTickets.tenantId, tenant?.id ?? ""));
  });
}

afterAll(async () => {
  await adminDb.delete(supportTicketEvents).where(eq(supportTicketEvents.tenantId, tenant.id));
  await adminDb.delete(supportTickets).where(eq(supportTickets.tenantId, tenant.id));
  await adminDb.delete(users).where(eq(users.tenantId, tenant.id));
  await adminDb.delete(tenants).where(eq(tenants.id, tenant.id));
  await adminDb.delete(platformAdmins).where(eq(platformAdmins.id, agent.id));
});

async function makeTicket(overrides: Partial<typeof supportTickets.$inferInsert> = {}) {
  const [ticket] = await withTenant(tenant.id, (tx) =>
    tx
      .insert(supportTickets)
      .values({
        tenantId: tenant.id,
        type: "bug",
        subject: "Something broke",
        description: "…",
        reportedByUserId: reporter.id,
        assignedToAdminId: agent.id,
        status: "in_progress",
        ...overrides,
      })
      .returning(),
  );
  return ticket;
}

const sweep = (now?: Date) => withTenant(tenant.id, (tx) => sweepTenant(tx, tenant.id, now));
const reload = async (id: string) =>
  (await withTenant(tenant.id, (tx) => tx.select().from(supportTickets).where(eq(supportTickets.id, id))))[0];
const eventsFor = async (id: string) =>
  withTenant(tenant.id, (tx) => tx.select().from(supportTicketEvents).where(eq(supportTicketEvents.ticketId, id)));

describe("sweep — escalation to L1", () => {
  it("escalates a ticket whose resolution deadline has passed", async () => {
    const ticket = await makeTicket({ resolutionDueAt: new Date(Date.now() - HOUR) });

    const result = await sweep();
    expect(result.escalatedToL1).toBe(1);

    const after = await reload(ticket.id);
    expect(after.escalationLevel).toBe(1);
    expect(after.escalatedAt).not.toBeNull();

    // Both the level change and the breach itself are recorded — the timeline
    // should say what happened, not just that a number moved.
    const events = await eventsFor(ticket.id);
    expect(events.map((e) => e.event).sort()).toEqual(["escalated", "sla_breached"]);
  });

  it("escalates on a missed first response even when resolution is fine", async () => {
    const ticket = await makeTicket({
      firstResponseDueAt: new Date(Date.now() - HOUR),
      resolutionDueAt: new Date(Date.now() + 5 * DAY),
    });

    await sweep();
    const events = await eventsFor(ticket.id);
    const breach = events.find((e) => e.event === "sla_breached");
    expect(breach?.toValue).toBe("first_response_breach");
  });

  it("does NOT escalate a ticket whose clock is paused on the customer", async () => {
    // The whole reason the clock pauses: escalating support for the customer's
    // delay is exactly the noise the pause exists to prevent.
    const ticket = await makeTicket({
      status: "awaiting_customer",
      awaitingCustomerSince: new Date(Date.now() - DAY),
      resolutionDueAt: new Date(Date.now() - HOUR),
    });

    const result = await sweep();
    expect(result.escalatedToL1).toBe(0);
    expect((await reload(ticket.id)).escalationLevel).toBe(0);
  });

  it("does NOT escalate a ticket with no resolution target", async () => {
    // Feature requests: no target means no breach, ever.
    const ticket = await makeTicket({ type: "feature_request", resolutionDueAt: null, firstResponseDueAt: null });
    await sweep();
    expect((await reload(ticket.id)).escalationLevel).toBe(0);
  });

  it("does NOT escalate a ticket that responded in time", async () => {
    const ticket = await makeTicket({
      firstResponseDueAt: new Date(Date.now() - HOUR),
      firstRespondedAt: new Date(Date.now() - 2 * HOUR),
      resolutionDueAt: new Date(Date.now() + DAY),
    });
    await sweep();
    expect((await reload(ticket.id)).escalationLevel).toBe(0);
  });
});

describe("sweep — idempotency", () => {
  it("running twice escalates once and writes no second set of events", async () => {
    const ticket = await makeTicket({ resolutionDueAt: new Date(Date.now() - HOUR) });

    const first = await sweep();
    const second = await sweep();

    expect(first.escalatedToL1).toBe(1);
    // The one that would page an on-call twice for the same breach.
    expect(second.escalatedToL1).toBe(0);

    const events = await eventsFor(ticket.id);
    expect(events.filter((e) => e.event === "escalated")).toHaveLength(1);
    expect(events.filter((e) => e.event === "sla_breached")).toHaveLength(1);
  });
});

describe("sweep — escalation to L2", () => {
  it("goes straight to L2 when already past the grace, not one rung per sweep", async () => {
    // A ticket a day past its deadline should reach L2 now — not an hour from
    // now — and should produce one escalation, not an L1 and an L2 email about
    // the same breach seconds apart.
    const ticket = await makeTicket({ resolutionDueAt: new Date(Date.now() - 2 * DAY) });

    const first = await sweep();
    expect(first.escalatedToL1).toBe(0);
    expect(first.escalatedToL2).toBe(1);
    expect((await reload(ticket.id)).escalationLevel).toBe(2);

    const events = await eventsFor(ticket.id);
    expect(events.filter((e) => e.event === "escalated")).toHaveLength(1);

    // …and stops there.
    expect((await sweep()).escalatedToL2).toBe(0);
  });

  it("does not reach L2 while still inside the grace window", async () => {
    const ticket = await makeTicket({ resolutionDueAt: new Date(Date.now() - HOUR) });
    await sweep();
    await sweep();
    expect((await reload(ticket.id)).escalationLevel).toBe(1);
  });

  it("takes a customer escalation straight to L2", async () => {
    const ticket = await makeTicket({
      resolutionDueAt: new Date(Date.now() + 5 * DAY),
      customerEscalatedAt: new Date(),
    });

    const result = await sweep();
    expect(result.escalatedToL2).toBe(1);

    const after = await reload(ticket.id);
    expect(after.escalationLevel).toBe(2);
    // Priority is support's triage call — a customer must not be able to
    // reprice their own ticket by escalating it.
    expect(after.priority).toBe("normal");

    expect((await sweep()).escalatedToL2).toBe(0);
  });
});

describe("sweep — auto-close", () => {
  it("closes a resolution the customer never confirmed, keeping the outcome", async () => {
    const ticket = await makeTicket({
      status: "resolved",
      resolvedAt: new Date(Date.now() - 8 * DAY),
      resolutionOutcome: "fixed",
      resolutionSummary: "Shipped in 2026.8.2.",
    });

    const result = await sweep();
    expect(result.autoClosed).toBe(1);

    const after = await reload(ticket.id);
    expect(after.status).toBe("closed");
    // The ticket was resolved on its merits; only the confirmation window
    // expired, so the outcome must survive.
    expect(after.resolutionOutcome).toBe("fixed");
    expect(after.resolutionSummary).toContain("2026.8.2");

    const closed = (await eventsFor(ticket.id)).find((e) => e.event === "closed");
    expect(closed?.actorKind).toBe("system");
    expect(closed?.metadata).toMatchObject({ reason: "auto_closed_after_confirmation_window" });
  });

  it("leaves a recent resolution alone", async () => {
    await makeTicket({
      status: "resolved",
      resolvedAt: new Date(Date.now() - 2 * DAY),
      resolutionOutcome: "fixed",
      resolutionSummary: "…",
    });
    expect((await sweep()).autoClosed).toBe(0);
  });

  it("is idempotent — a closed ticket isn't closed again", async () => {
    await makeTicket({
      status: "resolved",
      resolvedAt: new Date(Date.now() - 8 * DAY),
      resolutionOutcome: "fixed",
      resolutionSummary: "…",
    });
    await sweep();
    expect((await sweep()).autoClosed).toBe(0);
  });
});

describe("sweep — tenant isolation", () => {
  it("only touches the tenant it was given", async () => {
    const other = await adminDb
      .insert(tenants)
      .values({ name: "Other", slug: `esc-other-${crypto.randomUUID().slice(0, 8)}` })
      .returning();
    const otherTenant = other[0];
    const [otherUser] = await withTenant(otherTenant.id, (tx) =>
      tx
        .insert(users)
        .values({ tenantId: otherTenant.id, email: `o-${crypto.randomUUID().slice(0, 8)}@example.com`, fullName: "O", status: "active" })
        .returning(),
    );
    const [otherTicket] = await withTenant(otherTenant.id, (tx) =>
      tx
        .insert(supportTickets)
        .values({
          tenantId: otherTenant.id,
          type: "bug",
          subject: "theirs",
          description: "…",
          reportedByUserId: otherUser.id,
          status: "in_progress",
          resolutionDueAt: new Date(Date.now() - DAY),
        })
        .returning(),
    );

    // Sweeping our tenant must not escalate theirs.
    await sweep();
    const [after] = await withTenant(otherTenant.id, (tx) =>
      tx.select().from(supportTickets).where(and(eq(supportTickets.id, otherTicket.id))),
    );
    expect(after.escalationLevel).toBe(0);

    await adminDb.delete(supportTicketEvents).where(eq(supportTicketEvents.tenantId, otherTenant.id));
    await adminDb.delete(supportTickets).where(eq(supportTickets.tenantId, otherTenant.id));
    await adminDb.delete(users).where(eq(users.tenantId, otherTenant.id));
    await adminDb.delete(tenants).where(eq(tenants.id, otherTenant.id));
  });
});
