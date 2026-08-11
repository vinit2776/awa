import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "../adminClient";
import { withTenant } from "../withTenant";
import {
  activateVendorUserIfInvited,
  findVendorLoginMatches,
  makeMagicLinkToken,
  makeVendorSessionToken,
  resolveVendorSession,
  verifyMagicLinkToken,
} from "../vendorAuth";
import { confirmVendorPo, getVendorPoDetail, listVendorPos } from "../vendorPortal";
import {
  auditLog,
  purchaseOrders,
  purchaseRequisitions,
  tenants,
  users,
  vendorUsers,
  vendors,
} from "../schema";

let tenantA: typeof tenants.$inferSelect;
let tenantB: typeof tenants.$inferSelect;
let vendorA: typeof vendors.$inferSelect;
let vendorB: typeof vendors.$inferSelect;
let requestor: typeof users.$inferSelect;

beforeAll(async () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  [tenantA] = await adminDb.insert(tenants).values({ name: "Vendor Portal Co A", slug: `vendor-portal-co-a-${suffix}` }).returning();
  [tenantB] = await adminDb.insert(tenants).values({ name: "Vendor Portal Co B", slug: `vendor-portal-co-b-${suffix}` }).returning();
  [vendorA] = await withTenant(tenantA.id, (tx) => tx.insert(vendors).values({ tenantId: tenantA.id, name: "Acme Supplies" }).returning());
  [vendorB] = await withTenant(tenantB.id, (tx) => tx.insert(vendors).values({ tenantId: tenantB.id, name: "Acme Supplies (other buyer)" }).returning());
  [requestor] = await withTenant(tenantA.id, (tx) =>
    tx.insert(users).values({ tenantId: tenantA.id, email: "requestor@a.example.com", fullName: "Req Uestor", status: "active" }).returning(),
  );
});

afterAll(async () => {
  await adminDb.delete(auditLog).where(eq(auditLog.tenantId, tenantA.id));
  await adminDb.delete(auditLog).where(eq(auditLog.tenantId, tenantB.id));
  for (const tenant of [tenantA, tenantB]) {
    for (const table of [purchaseOrders, purchaseRequisitions, vendorUsers, vendors, users]) {
      await adminDb.delete(table).where(sql`tenant_id = ${tenant.id}`);
    }
  }
  await adminDb.delete(tenants).where(eq(tenants.id, tenantA.id));
  await adminDb.delete(tenants).where(eq(tenants.id, tenantB.id));
});

describe("magic link / session tokens", () => {
  it("round-trips a valid token", () => {
    const token = makeMagicLinkToken("Contact@Example.com");
    expect(verifyMagicLinkToken(token)).toBe("contact@example.com");
  });

  it("rejects a tampered token", () => {
    const token = makeMagicLinkToken("contact@example.com");
    const tampered = token.slice(0, -2) + (token.slice(-2) === "aa" ? "bb" : "aa");
    expect(verifyMagicLinkToken(tampered)).toBeNull();
  });

  it("rejects garbage input without throwing", () => {
    expect(verifyMagicLinkToken("not-a-real-token")).toBeNull();
  });
});

describe("findVendorLoginMatches", () => {
  it("returns no matches for an email with no vendor_users row", async () => {
    const matches = await findVendorLoginMatches("nobody@example.com");
    expect(matches).toHaveLength(0);
  });

  it("returns every tenant a vendor contact's email is registered under", async () => {
    await withTenant(tenantA.id, (tx) =>
      tx.insert(vendorUsers).values({ tenantId: tenantA.id, vendorId: vendorA.id, email: "shared@example.com", fullName: "Shared Contact", status: "active" }),
    );
    await withTenant(tenantB.id, (tx) =>
      tx.insert(vendorUsers).values({ tenantId: tenantB.id, vendorId: vendorB.id, email: "shared@example.com", fullName: "Shared Contact", status: "active" }),
    );

    const matches = await findVendorLoginMatches("shared@example.com");
    expect(matches).toHaveLength(2);
    expect(matches.map((m) => m.tenantName).sort()).toEqual(["Vendor Portal Co A", "Vendor Portal Co B"]);
  });

  it("excludes a disabled vendor contact", async () => {
    await withTenant(tenantA.id, (tx) =>
      tx.insert(vendorUsers).values({ tenantId: tenantA.id, vendorId: vendorA.id, email: "disabled@example.com", fullName: "Disabled Contact", status: "disabled" }),
    );

    const matches = await findVendorLoginMatches("disabled@example.com");
    expect(matches).toHaveLength(0);
  });
});

describe("vendor session lifecycle", () => {
  it("activates an invited contact on first session resolution and resolves their session", async () => {
    const [invited] = await withTenant(tenantA.id, (tx) =>
      tx.insert(vendorUsers).values({ tenantId: tenantA.id, vendorId: vendorA.id, email: "invitee@example.com", fullName: "Invitee Contact" }).returning(),
    );
    expect(invited.status).toBe("invited");

    await activateVendorUserIfInvited(invited.id);

    const [activated] = await withTenant(tenantA.id, (tx) => tx.select().from(vendorUsers).where(eq(vendorUsers.id, invited.id)));
    expect(activated.status).toBe("active");

    const session = await resolveVendorSession(makeVendorSessionToken(invited.id));
    expect(session).not.toBeNull();
    expect(session!.vendorId).toBe(vendorA.id);
    expect(session!.tenantId).toBe(tenantA.id);
  });

  it("resolves no session for a disabled vendor contact even with a validly signed token", async () => {
    const [disabled] = await withTenant(tenantA.id, (tx) =>
      tx.insert(vendorUsers).values({ tenantId: tenantA.id, vendorId: vendorA.id, email: "revoked@example.com", fullName: "Revoked Contact", status: "disabled" }).returning(),
    );

    const session = await resolveVendorSession(makeVendorSessionToken(disabled.id));
    expect(session).toBeNull();
  });

  it("resolves no session for a tampered token", async () => {
    const [active] = await withTenant(tenantA.id, (tx) =>
      tx.insert(vendorUsers).values({ tenantId: tenantA.id, vendorId: vendorA.id, email: "active@example.com", fullName: "Active Contact", status: "active" }).returning(),
    );
    const token = makeVendorSessionToken(active.id);
    const tampered = token.slice(0, -2) + (token.slice(-2) === "aa" ? "bb" : "aa");
    expect(await resolveVendorSession(tampered)).toBeNull();
  });
});

describe("vendor PO confirmation", () => {
  it("lists issued POs but not drafts, confirms exactly once, and logs it", async () => {
    const [vendorUser] = await withTenant(tenantA.id, (tx) =>
      tx.insert(vendorUsers).values({ tenantId: tenantA.id, vendorId: vendorA.id, email: "poconfirm@example.com", fullName: "PO Confirm Contact", status: "active" }).returning(),
    );

    const { draftPoId, issuedPoId } = await withTenant(tenantA.id, async (tx) => {
      const [requisition] = await tx
        .insert(purchaseRequisitions)
        .values({ tenantId: tenantA.id, requestorId: requestor.id, status: "converted_to_po", totalEstimatedValue: "1000" })
        .returning();
      const [draft] = await tx
        .insert(purchaseOrders)
        .values({ tenantId: tenantA.id, requisitionId: requisition.id, vendorId: vendorA.id, poNumber: "PO-VP-DRAFT", status: "draft", totalAmount: "1000" })
        .returning();
      const [issued] = await tx
        .insert(purchaseOrders)
        .values({ tenantId: tenantA.id, requisitionId: requisition.id, vendorId: vendorA.id, poNumber: "PO-VP-ISSUED", status: "issued", totalAmount: "1000" })
        .returning();
      return { draftPoId: draft.id, issuedPoId: issued.id };
    });

    const listed = await withTenant(tenantA.id, (tx) => listVendorPos(tx, vendorA.id));
    expect(listed.map((p) => p.id)).toContain(issuedPoId);
    expect(listed.map((p) => p.id)).not.toContain(draftPoId);

    expect(await withTenant(tenantA.id, (tx) => getVendorPoDetail(tx, vendorA.id, draftPoId))).toBeNull();

    await withTenant(tenantA.id, (tx) => confirmVendorPo(tx, tenantA.id, issuedPoId, vendorUser.id, vendorUser.email));
    // Second confirmation attempt (double-click, second tab) must not
    // clobber the first one's timestamp/actor or log a second entry.
    await withTenant(tenantA.id, (tx) => confirmVendorPo(tx, tenantA.id, issuedPoId, vendorUser.id, vendorUser.email));

    const detail = await withTenant(tenantA.id, (tx) => getVendorPoDetail(tx, vendorA.id, issuedPoId));
    expect(detail!.po.vendorConfirmedAt).not.toBeNull();
    expect(detail!.po.vendorConfirmedBy).toBe(vendorUser.id);

    const confirmations = await withTenant(tenantA.id, (tx) =>
      tx.select().from(auditLog).where(eq(auditLog.action, "po.vendor_confirmed")),
    );
    expect(confirmations.filter((c) => c.entityId === issuedPoId)).toHaveLength(1);
  });
});
