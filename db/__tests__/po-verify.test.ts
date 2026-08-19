import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "../adminClient";
import { withTenant } from "../withTenant";
import { lookupPoByToken } from "../poVerify";
import {
  tenants,
  users,
  vendors,
  roles,
  signatories,
  purchaseRequisitions,
  purchaseOrders,
} from "../schema";

// qr_token is a GLOBAL key: lookupPoByToken() deliberately searches every
// tenant (public verification has no tenant session to scope to). The suite
// runs against the shared dev database, so a fixed token would collide with a
// concurrent run — or with an orphan left by an interrupted one — and the
// lookup would resolve the other run's PO. Same per-run suffix as the slug.
const suffix = crypto.randomUUID().slice(0, 8);
const token = (n: string) => `test-token-${n}-${suffix}`;

let tenant: typeof tenants.$inferSelect;
let signer: typeof users.$inferSelect;
let unregisteredSigner: typeof users.$inferSelect;

beforeAll(async () => {
  [tenant] = await adminDb.insert(tenants).values({ name: "PO Verify Co", slug: `po-verify-co-${suffix}` }).returning();
  [signer] = await adminDb.insert(users).values({ tenantId: tenant.id, email: "signer@example.com", fullName: "Sara Signer", status: "active" }).returning();
  [unregisteredSigner] = await adminDb.insert(users).values({ tenantId: tenant.id, email: "unregistered@example.com", fullName: "Uma Unregistered", status: "active" }).returning();
});

afterAll(async () => {
  const tables = [signatories, purchaseOrders, purchaseRequisitions, vendors, roles, users];
  for (const table of tables) {
    await adminDb.delete(table).where(sql`tenant_id = ${tenant.id}`);
  }
  await adminDb.delete(tenants).where(eq(tenants.id, tenant.id));
});

describe("PO verification lookup", () => {
  it("returns null for an unrecognized token", async () => {
    const result = await lookupPoByToken("this-token-does-not-exist");
    expect(result).toBeNull();
  });

  it("resolves a valid token, with a matched signatory", async () => {
    const result = await withTenant(tenant.id, async (tx) => {
      const [vendor] = await tx.insert(vendors).values({ tenantId: tenant.id, name: "Verify Vendor" }).returning();
      const [requisition] = await tx.insert(purchaseRequisitions).values({ tenantId: tenant.id, requestorId: signer.id, status: "converted_to_po", totalEstimatedValue: "500" }).returning();
      await tx.insert(signatories).values({ tenantId: tenant.id, userId: signer.id, title: "Director", maxAuthorizedValue: "10000" });
      const [po] = await tx.insert(purchaseOrders).values({
        tenantId: tenant.id, requisitionId: requisition.id, vendorId: vendor.id, poNumber: "PO-VERIFY-001",
        status: "issued", totalAmount: "500", documentHash: "abc123", qrToken: token("001"), signedBy: signer.id, signedAt: new Date(),
      }).returning();
      return { po, vendorName: vendor.name };
    });

    const verification = await lookupPoByToken(token("001"));
    expect(verification).not.toBeNull();
    expect(verification!.poNumber).toBe("PO-VERIFY-001");
    expect(verification!.tenantName).toBe("PO Verify Co");
    expect(verification!.vendorName).toBe(result.vendorName);
    expect(verification!.status).toBe("issued");
    expect(verification!.signatory).toEqual({ name: "Sara Signer", title: "Director" });
  });

  it("resolves a PO signed by someone with no registered signatory entry", async () => {
    await withTenant(tenant.id, async (tx) => {
      const [vendor] = await tx.insert(vendors).values({ tenantId: tenant.id, name: "Verify Vendor 2" }).returning();
      const [requisition] = await tx.insert(purchaseRequisitions).values({ tenantId: tenant.id, requestorId: unregisteredSigner.id, status: "converted_to_po", totalEstimatedValue: "300" }).returning();
      await tx.insert(purchaseOrders).values({
        tenantId: tenant.id, requisitionId: requisition.id, vendorId: vendor.id, poNumber: "PO-VERIFY-002",
        status: "issued", totalAmount: "300", qrToken: token("002"), signedBy: unregisteredSigner.id, signedAt: new Date(),
      });
    });

    const verification = await lookupPoByToken(token("002"));
    expect(verification).not.toBeNull();
    expect(verification!.signatory).toBeNull();
  });

  it("surfaces a cancelled PO's status so the verification page can warn instead of confirm", async () => {
    await withTenant(tenant.id, async (tx) => {
      const [vendor] = await tx.insert(vendors).values({ tenantId: tenant.id, name: "Verify Vendor 3" }).returning();
      const [requisition] = await tx.insert(purchaseRequisitions).values({ tenantId: tenant.id, requestorId: signer.id, status: "converted_to_po", totalEstimatedValue: "50" }).returning();
      await tx.insert(purchaseOrders).values({
        tenantId: tenant.id, requisitionId: requisition.id, vendorId: vendor.id, poNumber: "PO-VERIFY-003",
        status: "cancelled", totalAmount: "50", qrToken: token("003"),
      });
    });

    const verification = await lookupPoByToken(token("003"));
    expect(verification?.status).toBe("cancelled");
  });
});
