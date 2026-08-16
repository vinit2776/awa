import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "../adminClient";
import { db } from "../client";
import { withTenant } from "../withTenant";
import { failureFrom } from "./dbFailure";
import {
  platformAdmins,
  supportTicketEvents,
  supportTicketMessages,
  supportTickets,
  tenants,
  users,
} from "../schema";

/**
 * Support desk invariants that must hold regardless of what any server action
 * or UI does. The highest-consequence one has its own named test: a
 * support_only note must never be visible to a customer, and a customer must
 * never be able to author one.
 *
 * Deliberately exercises the tables and constraints directly rather than the
 * db/supportDesk.ts functions — those all begin with getCurrentUserAndTenant(),
 * which needs a WorkOS session that doesn't exist in a vitest process. The
 * rules being tested live in the database, which is the point: they hold even
 * if a server action forgets them.
 */

let tenant: typeof tenants.$inferSelect;
let reporter: typeof users.$inferSelect;
let agent: typeof platformAdmins.$inferSelect;
let ticket: typeof supportTickets.$inferSelect;

beforeAll(async () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  [tenant] = await adminDb
    .insert(tenants)
    .values({ name: "Support Test", slug: `support-test-${suffix}` })
    .returning();

  [agent] = await adminDb
    .insert(platformAdmins)
    .values({ email: `agent-${suffix}@awa.test`, fullName: "Test Agent", role: "support" })
    .returning();

  await withTenant(tenant.id, async (tx) => {
    [reporter] = await tx
      .insert(users)
      .values({ tenantId: tenant.id, email: `reporter-${suffix}@example.com`, fullName: "Reporter", status: "active" })
      .returning();

    [ticket] = await tx
      .insert(supportTickets)
      .values({
        tenantId: tenant.id,
        type: "bug",
        subject: "Match flags a variance on a part-delivered line",
        description: "700 of 1200 arrived; vendor invoiced the full quantity.",
        reportedByUserId: reporter.id,
      })
      .returning();
  });
});

afterAll(async () => {
  await adminDb.delete(supportTicketEvents).where(eq(supportTicketEvents.tenantId, tenant.id));
  await adminDb.delete(supportTicketMessages).where(eq(supportTicketMessages.tenantId, tenant.id));
  await adminDb.delete(supportTickets).where(eq(supportTickets.tenantId, tenant.id));
  await adminDb.delete(users).where(eq(users.tenantId, tenant.id));
  await adminDb.delete(tenants).where(eq(tenants.id, tenant.id));
  await adminDb.delete(platformAdmins).where(eq(platformAdmins.id, agent.id));
});

describe("support desk — the two message lanes", () => {
  it("a support_only note is never returned by the customer-side query", async () => {
    await withTenant(tenant.id, async (tx) => {
      await tx.insert(supportTicketMessages).values({
        tenantId: tenant.id,
        ticketId: ticket.id,
        visibility: "customer",
        body: "Was the second shipment receipted before the invoice was captured?",
        isQuestion: true,
        authorPlatformAdminId: agent.id,
      });
      await tx.insert(supportTicketMessages).values({
        tenantId: tenant.id,
        ticketId: ticket.id,
        visibility: "support_only",
        body: "Probably the same class of bug we fixed on the service side.",
        authorPlatformAdminId: agent.id,
      });
    });

    // Exactly the filter getTicketForCustomer applies.
    const customerVisible = await withTenant(tenant.id, (tx) =>
      tx
        .select()
        .from(supportTicketMessages)
        .where(
          and(
            eq(supportTicketMessages.ticketId, ticket.id),
            eq(supportTicketMessages.visibility, "customer"),
          ),
        ),
    );

    expect(customerVisible).toHaveLength(1);
    expect(customerVisible.every((m) => m.visibility === "customer")).toBe(true);
    expect(customerVisible.some((m) => m.body.includes("same class of bug"))).toBe(false);
  });

  it("the check constraint rejects a customer-authored support_only note", async () => {
    const failure = await failureFrom(() =>
      withTenant(tenant.id, (tx) =>
        tx.insert(supportTicketMessages).values({
          tenantId: tenant.id,
          ticketId: ticket.id,
          visibility: "support_only",
          body: "A customer should not be able to write this.",
          authorUserId: reporter.id,
        }),
      ),
    );
    expect(failure.code).toBe("23514");
    expect(failure.constraint).toBe("support_message_support_only_authorship");
  });

  it("a message must have exactly one author, not two and not zero", async () => {
    // Separate withTenant calls on purpose: the first rejection aborts its
    // transaction, so a second probe inside it would report 25P02 instead of
    // the constraint under test.
    const noAuthor = await failureFrom(() =>
      withTenant(tenant.id, (tx) =>
        tx.insert(supportTicketMessages).values({
          tenantId: tenant.id,
          ticketId: ticket.id,
          body: "No author at all",
        }),
      ),
    );
    expect(noAuthor.constraint).toBe("support_message_single_author");

    const twoAuthors = await failureFrom(() =>
      withTenant(tenant.id, (tx) =>
        tx.insert(supportTicketMessages).values({
          tenantId: tenant.id,
          ticketId: ticket.id,
          body: "Two authors",
          authorUserId: reporter.id,
          authorPlatformAdminId: agent.id,
        }),
      ),
    );
    expect(twoAuthors.constraint).toBe("support_message_single_author");
  });
});

describe("support desk — ticket invariants", () => {
  it("assigns a unique global reference without application code choosing one", async () => {
    const [second] = await withTenant(tenant.id, (tx) =>
      tx
        .insert(supportTickets)
        .values({
          tenantId: tenant.id,
          type: "feedback",
          subject: "Second ticket",
          description: "…",
          reportedByUserId: reporter.id,
        })
        .returning(),
    );

    expect(ticket.reference).toMatch(/^SUP-\d{5}$/);
    expect(second.reference).toMatch(/^SUP-\d{5}$/);
    expect(second.reference).not.toEqual(ticket.reference);
  });

  it("refuses to mark a ticket resolved without an outcome and a summary", async () => {
    const failure = await failureFrom(() =>
      withTenant(tenant.id, (tx) =>
        tx.update(supportTickets).set({ status: "resolved" }).where(eq(supportTickets.id, ticket.id)),
      ),
    );
    expect(failure.constraint).toBe("support_tickets_resolution_complete");
  });

  it("accepts a resolution that carries both", async () => {
    await withTenant(tenant.id, (tx) =>
      tx
        .update(supportTickets)
        .set({
          status: "resolved",
          resolvedAt: new Date(),
          resolutionOutcome: "fixed",
          resolutionSummary: "invoiceMatch now sums across every receipt on the line.",
        })
        .where(eq(supportTickets.id, ticket.id)),
    );

    const [row] = await withTenant(tenant.id, (tx) =>
      tx.select().from(supportTickets).where(eq(supportTickets.id, ticket.id)),
    );
    expect(row.status).toBe("resolved");
    expect(row.resolutionSummary).toContain("sums across every receipt");
  });
});

describe("support desk — the audit trail is append-only", () => {
  it("app_runtime can insert an event but cannot update or delete one", async () => {
    const [event] = await withTenant(tenant.id, (tx) =>
      tx
        .insert(supportTicketEvents)
        .values({
          tenantId: tenant.id,
          ticketId: ticket.id,
          event: "created",
          actorKind: "customer",
          actorUserId: reporter.id,
        })
        .returning(),
    );
    expect(event.id).toBeDefined();

    const onUpdate = await failureFrom(() =>
      withTenant(tenant.id, (tx) =>
        tx.update(supportTicketEvents).set({ event: "rewritten" }).where(eq(supportTicketEvents.id, event.id)),
      ),
    );
    expect(onUpdate.code).toBe("42501");
    expect(onUpdate.message).toMatch(/permission denied/i);

    const onDelete = await failureFrom(() =>
      withTenant(tenant.id, (tx) => tx.delete(supportTicketEvents).where(eq(supportTicketEvents.id, event.id))),
    );
    expect(onDelete.code).toBe("42501");
    expect(onDelete.message).toMatch(/permission denied/i);
  });

  it("a system event carries no actor, and a support event carries a platform admin", async () => {
    await withTenant(tenant.id, (tx) =>
      tx.insert(supportTicketEvents).values({
        tenantId: tenant.id,
        ticketId: ticket.id,
        event: "status_changed",
        actorKind: "system",
        fromValue: "awaiting_customer",
        toValue: "in_progress",
      }),
    );

    // A 'system' event with an actor is a contradiction the DB rejects.
    const systemWithActor = await failureFrom(() =>
      withTenant(tenant.id, (tx) =>
        tx.insert(supportTicketEvents).values({
          tenantId: tenant.id,
          ticketId: ticket.id,
          event: "status_changed",
          actorKind: "system",
          actorUserId: reporter.id,
        }),
      ),
    );
    expect(systemWithActor.constraint).toBe("support_event_actor_matches_kind");

    // So is a 'support' event attributed to a tenant user.
    const supportAsCustomer = await failureFrom(() =>
      withTenant(tenant.id, (tx) =>
        tx.insert(supportTicketEvents).values({
          tenantId: tenant.id,
          ticketId: ticket.id,
          event: "assigned",
          actorKind: "support",
          actorUserId: reporter.id,
        }),
      ),
    );
    expect(supportAsCustomer.constraint).toBe("support_event_actor_matches_kind");
  });
});

describe("support desk — cross-tenant queue", () => {
  it("only the owner connection can see the queue unscoped — app_runtime sees nothing", async () => {
    // This is precisely why listQueue() is allowed to use adminDb: the support
    // console has no app.tenant_id to set, so the same query on the normal
    // application connection returns nothing at all.
    const viaOwner = await adminDb
      .select({ id: supportTickets.id })
      .from(supportTickets)
      .where(eq(supportTickets.tenantId, tenant.id));
    expect(viaOwner.length).toBeGreaterThan(0);

    const viaAppRuntime = await db
      .select({ id: supportTickets.id })
      .from(supportTickets)
      .where(eq(supportTickets.tenantId, tenant.id));
    expect(viaAppRuntime).toHaveLength(0);
  });
});
