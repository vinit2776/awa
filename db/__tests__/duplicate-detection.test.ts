import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "../adminClient";
import { withTenant } from "../withTenant";
import { findPossibleDuplicates, recordDuplicateAcknowledgements, getDuplicateAcknowledgements } from "../duplicateDetection";
import {
  tenants,
  users,
  vendors,
  catalogItems,
  purchaseRequisitions,
  purchaseRequisitionLines,
  purchaseOrders,
  requisitionDuplicateAcknowledgements,
  auditLog,
} from "../schema";

let tenant: typeof tenants.$inferSelect;
let requestorA: typeof users.$inferSelect;
let requestorB: typeof users.$inferSelect;
let vendor: typeof vendors.$inferSelect;
let item: typeof catalogItems.$inferSelect;
let otherItem: typeof catalogItems.$inferSelect;

async function makeRequisitionWithLine(
  status: "draft" | "submitted" | "pending_approval" | "approved" | "converted_to_po" | "cancelled" | "rejected_closed" | "rejected_revisable",
  opts: { catalogItemId?: string | null; freeTextDescription?: string | null } = {},
) {
  return withTenant(tenant.id, async (tx) => {
    const [requisition] = await tx
      .insert(purchaseRequisitions)
      .values({ tenantId: tenant.id, requestorId: requestorB.id, status, totalEstimatedValue: "500", submittedAt: status === "draft" ? null : new Date() })
      .returning();
    await tx.insert(purchaseRequisitionLines).values({
      tenantId: tenant.id,
      requisitionId: requisition.id,
      catalogItemId: opts.freeTextDescription ? null : (opts.catalogItemId ?? item.id),
      freeTextDescription: opts.freeTextDescription ?? null,
      fulfillmentType: "goods",
      quantity: "3",
      uom: "each",
      estimatedUnitPrice: "100",
      lineTotal: "300",
    });
    return requisition;
  });
}

async function makePoForRequisition(requisitionId: string, status: "issued" | "partially_fulfilled" | "fulfilled" | "cancelled") {
  return withTenant(tenant.id, async (tx) => {
    const [po] = await tx
      .insert(purchaseOrders)
      .values({
        tenantId: tenant.id,
        requisitionId,
        vendorId: vendor.id,
        poNumber: `PO-DUP-${Math.random().toString(36).slice(2, 8)}`,
        status,
        totalAmount: "300",
      })
      .returning();
    return po;
  });
}

beforeAll(async () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  [tenant] = await adminDb.insert(tenants).values({ name: "Duplicate Detection Co", slug: `duplicate-detection-co-${suffix}` }).returning();
  [requestorA] = await adminDb.insert(users).values({ tenantId: tenant.id, email: "dd-requestor-a@example.com", fullName: "Asha Requestor", status: "active" }).returning();
  [requestorB] = await adminDb.insert(users).values({ tenantId: tenant.id, email: "dd-requestor-b@example.com", fullName: "Bala Requestor", status: "active" }).returning();
  await withTenant(tenant.id, async (tx) => {
    [vendor] = await tx.insert(vendors).values({ tenantId: tenant.id, name: "Duplicate Detection Vendor" }).returning();
    [item] = await tx.insert(catalogItems).values({ tenantId: tenant.id, name: "SKF 6205 bearing" }).returning();
    [otherItem] = await tx.insert(catalogItems).values({ tenantId: tenant.id, name: "Copier paper A4 75g" }).returning();
  });
});

afterAll(async () => {
  // Delete order follows the FK graph, matching the house convention
  // (auditLog first — see decision-support.test.ts's siblings): everything
  // that references purchase_requisitions or users must go before them,
  // and users goes last since audit_log, purchase_requisitions,
  // requisition_duplicate_acknowledgements and catalog_items.created_by
  // all reference it.
  const tables = [
    auditLog,
    requisitionDuplicateAcknowledgements,
    purchaseOrders,
    purchaseRequisitionLines,
    purchaseRequisitions,
    catalogItems,
    vendors,
    users,
  ];
  for (const table of tables) {
    await adminDb.delete(table).where(sql`tenant_id = ${tenant.id}`);
  }
  await adminDb.delete(tenants).where(eq(tenants.id, tenant.id));
});

describe("findPossibleDuplicates", () => {
  it("finds a submitted requisition sharing an item", async () => {
    const requisition = await makeRequisitionWithLine("submitted");

    const results = await withTenant(tenant.id, (tx) =>
      findPossibleDuplicates(tx, { catalogItemIds: [item.id], excludeRequisitionId: null }),
    );
    expect(results.some((r) => r.requisitionId === requisition.id)).toBe(true);
    const match = results.find((r) => r.requisitionId === requisition.id);
    expect(match?.requestorName).toBe("Bala Requestor");
    expect(match?.status).toBe("submitted");
    expect(match?.matchedItems).toEqual([{ catalogItemId: item.id, quantity: "3.000", uom: "each" }]);
  });

  it("does not find draft, cancelled, rejected_closed or rejected_revisable requisitions", async () => {
    const draft = await makeRequisitionWithLine("draft");
    const cancelled = await makeRequisitionWithLine("cancelled");
    const rejectedClosed = await makeRequisitionWithLine("rejected_closed");
    const rejectedRevisable = await makeRequisitionWithLine("rejected_revisable");

    const results = await withTenant(tenant.id, (tx) =>
      findPossibleDuplicates(tx, { catalogItemIds: [item.id], excludeRequisitionId: null }),
    );
    const ids = new Set(results.map((r) => r.requisitionId));
    expect(ids.has(draft.id)).toBe(false);
    expect(ids.has(cancelled.id)).toBe(false);
    expect(ids.has(rejectedClosed.id)).toBe(false);
    expect(ids.has(rejectedRevisable.id)).toBe(false);
  });

  it("finds a converted_to_po requisition whose PO is still issued — the case most easily got wrong", async () => {
    const requisition = await makeRequisitionWithLine("converted_to_po");
    await makePoForRequisition(requisition.id, "issued");

    const results = await withTenant(tenant.id, (tx) =>
      findPossibleDuplicates(tx, { catalogItemIds: [item.id], excludeRequisitionId: null }),
    );
    expect(results.some((r) => r.requisitionId === requisition.id)).toBe(true);
  });

  it("does not find a converted_to_po requisition whose PO is fulfilled", async () => {
    const requisition = await makeRequisitionWithLine("converted_to_po");
    await makePoForRequisition(requisition.id, "fulfilled");

    const results = await withTenant(tenant.id, (tx) =>
      findPossibleDuplicates(tx, { catalogItemIds: [item.id], excludeRequisitionId: null }),
    );
    expect(results.some((r) => r.requisitionId === requisition.id)).toBe(false);
  });

  it("excludes the requisition itself via excludeRequisitionId", async () => {
    const requisition = await makeRequisitionWithLine("submitted");

    const results = await withTenant(tenant.id, (tx) =>
      findPossibleDuplicates(tx, { catalogItemIds: [item.id], excludeRequisitionId: requisition.id }),
    );
    expect(results.some((r) => r.requisitionId === requisition.id)).toBe(false);
  });

  it("does not find a requisition sharing no items", async () => {
    const requisition = await makeRequisitionWithLine("submitted", { catalogItemId: otherItem.id });

    const results = await withTenant(tenant.id, (tx) =>
      findPossibleDuplicates(tx, { catalogItemIds: [item.id], excludeRequisitionId: null }),
    );
    expect(results.some((r) => r.requisitionId === requisition.id)).toBe(false);
  });

  it("does not match a free-text line by wording alone — no fuzzy matching", async () => {
    // Same wording as the catalogue item, but never given a catalogue
    // identity — this is the deliberate no-fuzzy-matching decision, not a
    // gap: see the module docblock and commit a95cd63.
    const requisition = await makeRequisitionWithLine("submitted", { freeTextDescription: "SKF 6205 bearing" });

    const results = await withTenant(tenant.id, (tx) =>
      findPossibleDuplicates(tx, { catalogItemIds: [item.id], excludeRequisitionId: null }),
    );
    expect(results.some((r) => r.requisitionId === requisition.id)).toBe(false);
  });
});

describe("recordDuplicateAcknowledgements", () => {
  it("inserts acknowledgement rows and reads them back", async () => {
    const original = await makeRequisitionWithLine("submitted");
    const newOne = await makeRequisitionWithLine("draft");

    await withTenant(tenant.id, (tx) =>
      recordDuplicateAcknowledgements(tx, {
        tenantId: tenant.id,
        requisitionId: newOne.id,
        acknowledgedByUserId: requestorA.id,
        acknowledgements: [{ duplicateOfRequisitionId: original.id, reason: "Different project, separate cost centre." }],
      }),
    );

    const rows = await withTenant(tenant.id, (tx) =>
      tx.select().from(requisitionDuplicateAcknowledgements).where(eq(requisitionDuplicateAcknowledgements.requisitionId, newOne.id)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].duplicateOfRequisitionId).toBe(original.id);
    expect(rows[0].acknowledgedByUserId).toBe(requestorA.id);
    expect(rows[0].reason).toBe("Different project, separate cost centre.");
  });
});

describe("getDuplicateAcknowledgements", () => {
  it("reads back what was recorded, with the other requisition and acknowledging user resolved to names", async () => {
    const original = await makeRequisitionWithLine("submitted");
    const newOne = await makeRequisitionWithLine("draft");

    await withTenant(tenant.id, (tx) =>
      recordDuplicateAcknowledgements(tx, {
        tenantId: tenant.id,
        requisitionId: newOne.id,
        acknowledgedByUserId: requestorA.id,
        acknowledgements: [{ duplicateOfRequisitionId: original.id, reason: "Replaces a damaged unit, not a repeat order." }],
      }),
    );

    const results = await withTenant(tenant.id, (tx) => getDuplicateAcknowledgements(tx, newOne.id));

    expect(results).toHaveLength(1);
    expect(results[0].duplicateOfRequisitionId).toBe(original.id);
    // original's line was created via requestorB in makeRequisitionWithLine.
    expect(results[0].duplicateOfRequestorName).toBe("Bala Requestor");
    expect(results[0].duplicateOfStatus).toBe("submitted");
    expect(results[0].acknowledgedByName).toBe("Asha Requestor");
    expect(results[0].reason).toBe("Replaces a damaged unit, not a repeat order.");
  });

  it("returns nothing for a requisition with no acknowledgements", async () => {
    const requisition = await makeRequisitionWithLine("draft");

    const results = await withTenant(tenant.id, (tx) => getDuplicateAcknowledgements(tx, requisition.id));

    expect(results).toEqual([]);
  });
});
