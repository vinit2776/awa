import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "../adminClient";
import { withTenant } from "../withTenant";
import { findRequisitionIdsMatching } from "../requisitionSearch";
import {
  catalogItems,
  costCenters,
  departments,
  purchaseRequisitionLines,
  purchaseRequisitions,
  tenants,
  users,
} from "../schema";

/**
 * Search has to find a requisition by any of the things a person actually
 * remembers about it. The failure mode worth testing is the quiet one:
 * a requisition that exists, matches, and doesn't come back — which is
 * what an inner join would cause for anything missing a line, a
 * department or a cost centre.
 */

let tenant: typeof tenants.$inferSelect;
let anjali: typeof users.$inferSelect;
let ravi: typeof users.$inferSelect;

let catalogued: typeof purchaseRequisitions.$inferSelect;
let freeText: typeof purchaseRequisitions.$inferSelect;
let bare: typeof purchaseRequisitions.$inferSelect;

beforeAll(async () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  [tenant] = await adminDb
    .insert(tenants)
    .values({ name: "Search Test Co", slug: `search-test-${suffix}` })
    .returning();

  await withTenant(tenant.id, async (tx) => {
    const [facilities] = await tx
      .insert(departments)
      .values({ tenantId: tenant.id, name: "Facilities" })
      .returning();
    const [costCentre] = await tx
      .insert(costCenters)
      .values({ tenantId: tenant.id, name: "Bengaluru Site", code: `BLR-${suffix}` })
      .returning();
    [anjali] = await tx
      .insert(users)
      .values({ tenantId: tenant.id, email: `anjali-${suffix}@example.com`, fullName: "Anjali Rao", status: "active" })
      .returning();
    [ravi] = await tx
      .insert(users)
      .values({ tenantId: tenant.id, email: `ravi-${suffix}@example.com`, fullName: "Ravi Menon", status: "active" })
      .returning();

    const [ups] = await tx
      .insert(catalogItems)
      .values({ tenantId: tenant.id, name: "Smart-UPS 5kVA", uom: "each" })
      .returning();

    // Named by a catalogue item, charged to a department and cost centre.
    [catalogued] = await tx
      .insert(purchaseRequisitions)
      .values({
        tenantId: tenant.id,
        requestorId: anjali.id,
        departmentId: facilities.id,
        costCenterId: costCentre.id,
        status: "pending_approval",
        totalEstimatedValue: "184000",
        justification: "Replacing the failed unit in the server room",
      })
      .returning();
    await tx.insert(purchaseRequisitionLines).values({
      tenantId: tenant.id,
      requisitionId: catalogued.id,
      catalogItemId: ups.id,
      fulfillmentType: "goods",
      quantity: "2",
      uom: "each",
    });

    // Named only by what the requester typed.
    [freeText] = await tx
      .insert(purchaseRequisitions)
      .values({ tenantId: tenant.id, requestorId: ravi.id, status: "draft", totalEstimatedValue: "4200" })
      .returning();
    await tx.insert(purchaseRequisitionLines).values({
      tenantId: tenant.id,
      requisitionId: freeText.id,
      freeTextDescription: "Anti-fatigue floor matting",
      fulfillmentType: "goods",
      quantity: "10",
      uom: "each",
    });

    // No lines, no department, no cost centre — the row an inner join loses.
    [bare] = await tx
      .insert(purchaseRequisitions)
      .values({
        tenantId: tenant.id,
        requestorId: ravi.id,
        status: "draft",
        totalEstimatedValue: "0",
        justification: "Placeholder for the switchgear quote",
      })
      .returning();
  });
});

afterAll(async () => {
  await adminDb.delete(purchaseRequisitionLines).where(eq(purchaseRequisitionLines.tenantId, tenant.id));
  await adminDb.delete(purchaseRequisitions).where(eq(purchaseRequisitions.tenantId, tenant.id));
  await adminDb.delete(catalogItems).where(eq(catalogItems.tenantId, tenant.id));
  await adminDb.delete(costCenters).where(eq(costCenters.tenantId, tenant.id));
  await adminDb.delete(departments).where(eq(departments.tenantId, tenant.id));
  await adminDb.delete(users).where(eq(users.tenantId, tenant.id));
  await adminDb.delete(tenants).where(eq(tenants.id, tenant.id));
});

const search = (q: string) => withTenant(tenant.id, (tx) => findRequisitionIdsMatching(tx, q));

describe("requisition search", () => {
  it("finds one by its catalogue item", async () => {
    expect(await search("Smart-UPS")).toContain(catalogued.id);
  });

  it("finds one by free-text the requester typed", async () => {
    expect(await search("floor matting")).toContain(freeText.id);
  });

  it("finds one by who raised it", async () => {
    expect(await search("Anjali")).toContain(catalogued.id);
  });

  it("finds one by department", async () => {
    expect(await search("Facilities")).toContain(catalogued.id);
  });

  it("finds one by cost centre name", async () => {
    expect(await search("Bengaluru")).toContain(catalogued.id);
  });

  it("finds one by a phrase in the justification notes", async () => {
    expect(await search("server room")).toContain(catalogued.id);
  });

  it("is case-insensitive", async () => {
    expect(await search("smart-ups")).toContain(catalogued.id);
  });

  it("still finds a requisition with no lines, department or cost centre", async () => {
    // The left-join case. An inner join anywhere in the chain would drop
    // this silently, and search would just quietly under-report.
    expect(await search("switchgear")).toContain(bare.id);
  });

  it("excludes requisitions that don't match", async () => {
    const hits = await search("Smart-UPS");
    expect(hits).not.toContain(freeText.id);
    expect(hits).not.toContain(bare.id);
  });

  it("returns nothing for an empty or whitespace query rather than everything", async () => {
    expect(await search("")).toEqual([]);
    expect(await search("   ")).toEqual([]);
  });

  it("treats LIKE wildcards as literal characters", async () => {
    // Unescaped, "%" would match every requisition in the tenant.
    expect(await search("%")).toEqual([]);
  });
});
