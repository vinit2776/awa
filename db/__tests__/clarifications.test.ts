import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "../adminClient";
import { withTenant } from "../withTenant";
import { isBlocked } from "../clarificationRules";
import { failureFrom } from "./dbFailure";
import {
  departments,
  purchaseRequisitions,
  tenants,
  transactionClarificationMessages,
  transactionClarifications,
  users,
} from "../schema";

/**
 * Transaction clarifications — the rules that must hold no matter what a server
 * action does. Two matter most:
 *
 *  1. Only the person who asked can resolve. If the answerer could close it,
 *     "resolved" would degrade into "someone typed something".
 *  2. A blocking query holds an approval without changing the requisition's
 *     status — proving no new requisition_status value was invented, which is
 *     what keeps the approval engine, lifecycle tracker and golden-path test
 *     untouched.
 */

let tenant: typeof tenants.$inferSelect;
let asker: typeof users.$inferSelect;
let answerer: typeof users.$inferSelect;
let requisition: typeof purchaseRequisitions.$inferSelect;

beforeAll(async () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  [tenant] = await adminDb
    .insert(tenants)
    .values({ name: "Clarification Test", slug: `clar-test-${suffix}` })
    .returning();

  await withTenant(tenant.id, async (tx) => {
    const [dept] = await tx.insert(departments).values({ tenantId: tenant.id, name: "Ops" }).returning();
    [asker] = await tx
      .insert(users)
      .values({ tenantId: tenant.id, email: `asker-${suffix}@example.com`, fullName: "Approver", status: "active" })
      .returning();
    [answerer] = await tx
      .insert(users)
      .values({ tenantId: tenant.id, email: `answerer-${suffix}@example.com`, fullName: "Requester", status: "active" })
      .returning();
    [requisition] = await tx
      .insert(purchaseRequisitions)
      .values({
        tenantId: tenant.id,
        requestorId: answerer.id,
        departmentId: dept.id,
        status: "pending_approval",
        totalEstimatedValue: "484000",
      })
      .returning();
  });
});

afterAll(async () => {
  await adminDb.delete(transactionClarificationMessages).where(eq(transactionClarificationMessages.tenantId, tenant.id));
  await adminDb.delete(transactionClarifications).where(eq(transactionClarifications.tenantId, tenant.id));
  await adminDb.delete(purchaseRequisitions).where(eq(purchaseRequisitions.tenantId, tenant.id));
  await adminDb.delete(users).where(eq(users.tenantId, tenant.id));
  await adminDb.delete(departments).where(eq(departments.tenantId, tenant.id));
  await adminDb.delete(tenants).where(eq(tenants.id, tenant.id));
});

async function newQuery(opts: { blocks?: boolean } = {}) {
  return withTenant(tenant.id, async (tx) => {
    const [row] = await tx
      .insert(transactionClarifications)
      .values({
        tenantId: tenant.id,
        entityType: "requisition",
        entityId: requisition.id,
        raisedByUserId: asker.id,
        assignedToUserId: answerer.id,
        question: "Which cost centre does this hit — CC-204 Packaging, or Maintenance?",
        blocksProgress: opts.blocks ?? false,
      })
      .returning();
    return row;
  });
}

describe("clarifications — only the asker can resolve", () => {
  it("rejects a resolution recorded against the person who answered", async () => {
    const query = await newQuery();

    const failure = await failureFrom(() =>
      withTenant(tenant.id, (tx) =>
        tx
          .update(transactionClarifications)
          .set({ status: "resolved", resolvedAt: new Date(), resolvedByUserId: answerer.id })
          .where(eq(transactionClarifications.id, query.id)),
      ),
    );

    expect(failure.code).toBe("23514");
    expect(failure.constraint).toBe("clarification_resolved_by_asker");
  });

  it("rejects a resolution with no resolver recorded at all", async () => {
    const query = await newQuery();

    const failure = await failureFrom(() =>
      withTenant(tenant.id, (tx) =>
        tx
          .update(transactionClarifications)
          .set({ status: "resolved", resolvedAt: new Date() })
          .where(eq(transactionClarifications.id, query.id)),
      ),
    );
    expect(failure.constraint).toBe("clarification_resolved_by_asker");
  });

  it("accepts a resolution by the asker", async () => {
    const query = await newQuery();

    await withTenant(tenant.id, (tx) =>
      tx
        .update(transactionClarifications)
        .set({ status: "resolved", resolvedAt: new Date(), resolvedByUserId: asker.id })
        .where(eq(transactionClarifications.id, query.id)),
    );

    const [row] = await withTenant(tenant.id, (tx) =>
      tx.select().from(transactionClarifications).where(eq(transactionClarifications.id, query.id)),
    );
    expect(row.status).toBe("resolved");
    expect(row.resolvedByUserId).toBe(asker.id);
  });

  it("rejects a resolved row with no resolved_at timestamp", async () => {
    const query = await newQuery();

    const failure = await failureFrom(() =>
      withTenant(tenant.id, (tx) =>
        tx
          .update(transactionClarifications)
          .set({ status: "resolved", resolvedByUserId: asker.id })
          .where(eq(transactionClarifications.id, query.id)),
      ),
    );
    expect(failure.constraint).toBe("clarification_resolved_has_timestamp");
  });
});

describe("clarifications — blocking is derived, not stored on the record", () => {
  it("an open blocking query blocks; the requisition's own status is untouched", async () => {
    const query = await newQuery({ blocks: true });

    const blocked = await withTenant(tenant.id, (tx) => isBlocked(tx, "requisition", requisition.id));
    expect(blocked).toBe(true);

    // The point of deriving it: nothing was written to the requisition, so the
    // approval engine, lifecycle tracker and golden-path test are unaffected.
    const [row] = await withTenant(tenant.id, (tx) =>
      tx.select().from(purchaseRequisitions).where(eq(purchaseRequisitions.id, requisition.id)),
    );
    expect(row.status).toBe("pending_approval");

    // Resolving lifts the block with no separate unblock step to forget.
    await withTenant(tenant.id, (tx) =>
      tx
        .update(transactionClarifications)
        .set({ status: "resolved", resolvedAt: new Date(), resolvedByUserId: asker.id })
        .where(eq(transactionClarifications.id, query.id)),
    );

    const stillBlocked = await withTenant(tenant.id, (tx) => isBlocked(tx, "requisition", requisition.id));
    expect(stillBlocked).toBe(false);
  });

  it("a non-blocking query never blocks, however many are open", async () => {
    await newQuery();
    await newQuery();

    const blocked = await withTenant(tenant.id, (tx) => isBlocked(tx, "requisition", requisition.id));
    expect(blocked).toBe(false);
  });

  it("a withdrawn blocking query stops blocking", async () => {
    const query = await newQuery({ blocks: true });
    expect(await withTenant(tenant.id, (tx) => isBlocked(tx, "requisition", requisition.id))).toBe(true);

    await withTenant(tenant.id, (tx) =>
      tx
        .update(transactionClarifications)
        .set({ status: "withdrawn" })
        .where(eq(transactionClarifications.id, query.id)),
    );

    expect(await withTenant(tenant.id, (tx) => isBlocked(tx, "requisition", requisition.id))).toBe(false);
  });

  it("a blocking query on one requisition does not block another", async () => {
    await newQuery({ blocks: true });
    const otherId = crypto.randomUUID();
    expect(await withTenant(tenant.id, (tx) => isBlocked(tx, "requisition", otherId))).toBe(false);
  });
});

describe("clarifications — the thread", () => {
  it("has one author column and no visibility lane, unlike a support ticket", async () => {
    const query = await newQuery();

    await withTenant(tenant.id, (tx) =>
      tx.insert(transactionClarificationMessages).values({
        tenantId: tenant.id,
        clarificationId: query.id,
        authorUserId: answerer.id,
        body: "CC-204. The capex coding is a data-entry slip on my side.",
      }),
    );

    const messages = await withTenant(tenant.id, (tx) =>
      tx
        .select()
        .from(transactionClarificationMessages)
        .where(eq(transactionClarificationMessages.clarificationId, query.id)),
    );

    expect(messages).toHaveLength(1);
    expect(messages[0].authorUserId).toBe(answerer.id);
    // Everyone who can see the record sees every message — there is no private
    // lane here, because everyone in the thread is on the same side.
    expect(messages[0]).not.toHaveProperty("visibility");
  });

  it("cascades its messages when the clarification is deleted", async () => {
    const query = await newQuery();
    await withTenant(tenant.id, (tx) =>
      tx.insert(transactionClarificationMessages).values({
        tenantId: tenant.id,
        clarificationId: query.id,
        authorUserId: answerer.id,
        body: "temp",
      }),
    );

    await adminDb.delete(transactionClarifications).where(eq(transactionClarifications.id, query.id));

    const orphans = await withTenant(tenant.id, (tx) =>
      tx
        .select()
        .from(transactionClarificationMessages)
        .where(eq(transactionClarificationMessages.clarificationId, query.id)),
    );
    expect(orphans).toHaveLength(0);
  });
});
