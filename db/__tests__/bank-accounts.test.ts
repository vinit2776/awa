import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "../adminClient";
import { withTenant } from "../withTenant";
import { addBankAccount, verifyBankAccountByCallback } from "../bankAccounts";
import { decryptBankAccountNumber } from "../crypto";
import { tenants, users, vendors, vendorBankAccounts, auditLog } from "../schema";

let tenant: typeof tenants.$inferSelect;
let officer: typeof users.$inferSelect;
let vendor: typeof vendors.$inferSelect;

beforeAll(async () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  [tenant] = await adminDb.insert(tenants).values({ name: "Bank Lock Co", slug: `bank-lock-co-${suffix}` }).returning();
  [officer] = await adminDb.insert(users).values({ tenantId: tenant.id, email: "bankofficer@example.com", fullName: "Bea Officer", status: "active" }).returning();
  [vendor] = await adminDb.insert(vendors).values({ tenantId: tenant.id, name: "Locked Vendor", registeredPhone: "+91-98765-00000" }).returning();
});

afterAll(async () => {
  await adminDb.delete(auditLog).where(sql`${auditLog.tenantId} = ${tenant.id}`);
  await adminDb.delete(vendorBankAccounts).where(eq(vendorBankAccounts.tenantId, tenant.id));
  await adminDb.delete(vendors).where(eq(vendors.tenantId, tenant.id));
  await adminDb.delete(users).where(eq(users.tenantId, tenant.id));
  await adminDb.delete(tenants).where(eq(tenants.id, tenant.id));
});

describe("bank account lock and rotation", () => {
  it("stores the account number encrypted, never in cleartext, alongside a masked last4", async () => {
    const created = await withTenant(tenant.id, (tx) =>
      addBankAccount(tx, tenant.id, officer.id, vendor.id, {
        accountHolderName: "Locked Vendor Pvt Ltd",
        accountNumber: "1111222233334444",
        bankName: "Test Bank",
        ifscOrSwift: "TEST0001234",
      }),
    );

    expect(created.status).toBe("pending_verification");
    expect(created.accountNumberLast4).toBe("4444");
    expect(created.accountNumberEnc).not.toContain("1111222233334444");
    expect(decryptBankAccountNumber(created.accountNumberEnc)).toBe("1111222233334444");
  });

  it("a pending account isn't active until verified", async () => {
    const rows = await withTenant(tenant.id, (tx) => tx.select().from(vendorBankAccounts).where(eq(vendorBankAccounts.vendorId, vendor.id)));
    expect(rows.every((r) => r.status !== "active")).toBe(true);
  });

  it("verifying promotes the account to active", async () => {
    const [pending] = await withTenant(tenant.id, (tx) =>
      tx.select().from(vendorBankAccounts).where(and(eq(vendorBankAccounts.vendorId, vendor.id), eq(vendorBankAccounts.status, "pending_verification"))),
    );
    expect(pending).toBeDefined();

    const result = await withTenant(tenant.id, (tx) => verifyBankAccountByCallback(tx, tenant.id, officer.id, pending.id));
    expect(result.error).toBeUndefined();

    const [afterVerify] = await withTenant(tenant.id, (tx) => tx.select().from(vendorBankAccounts).where(eq(vendorBankAccounts.id, pending.id)));
    expect(afterVerify.status).toBe("active");
    expect(afterVerify.verifiedBy).toBe(officer.id);
  });

  it("a second verification attempt on the same row is rejected — no double-verify", async () => {
    const [active] = await withTenant(tenant.id, (tx) => tx.select().from(vendorBankAccounts).where(and(eq(vendorBankAccounts.vendorId, vendor.id), eq(vendorBankAccounts.status, "active"))));
    const result = await withTenant(tenant.id, (tx) => verifyBankAccountByCallback(tx, tenant.id, officer.id, active.id));
    expect(result.error).toBeDefined();
  });

  it("adding and verifying a replacement account supersedes the previous active one — never two active at once, never a gap", async () => {
    const replacement = await withTenant(tenant.id, (tx) =>
      addBankAccount(tx, tenant.id, officer.id, vendor.id, {
        accountHolderName: "Locked Vendor Pvt Ltd",
        accountNumber: "5555666677778888",
        bankName: "New Bank",
        ifscOrSwift: "NEWB0005678",
      }),
    );

    // Before verification: old one still active, new one merely pending — no gap in valid bank details.
    const beforeVerify = await withTenant(tenant.id, (tx) => tx.select().from(vendorBankAccounts).where(eq(vendorBankAccounts.vendorId, vendor.id)));
    expect(beforeVerify.filter((r) => r.status === "active")).toHaveLength(1);
    expect(beforeVerify.find((r) => r.id === replacement.id)?.status).toBe("pending_verification");

    await withTenant(tenant.id, (tx) => verifyBankAccountByCallback(tx, tenant.id, officer.id, replacement.id));

    const afterVerify = await withTenant(tenant.id, (tx) => tx.select().from(vendorBankAccounts).where(eq(vendorBankAccounts.vendorId, vendor.id)));
    const activeRows = afterVerify.filter((r) => r.status === "active");
    const supersededRows = afterVerify.filter((r) => r.status === "superseded");

    expect(activeRows).toHaveLength(1);
    expect(activeRows[0].id).toBe(replacement.id);
    expect(supersededRows).toHaveLength(1);
    expect(activeRows[0].accountNumberLast4).toBe("8888");
  });
});
