import { and, eq } from "drizzle-orm";
import { adminDb } from "./adminClient";
import { purchaseOrders, tenants, vendors, users, signatories } from "./schema";

export type PoVerification = {
  poNumber: string;
  tenantName: string;
  vendorName: string;
  totalAmount: string;
  currency: string;
  status: string;
  issuedAt: Date | null;
  documentHash: string | null;
  signatory: { name: string; title: string } | null;
};

/**
 * The public QR-scan verification endpoint (§05) — a vendor with no
 * session, verifying a PO against the platform's registry rather than
 * trusting the PDF alone. Deliberately uses adminDb (bypasses RLS): the
 * qr_token itself is the credential here (128 bits of random entropy,
 * unique across the whole table, unguessable), not a tenant session —
 * there is no tenant context to scope a normal withTenant() call to.
 * This is the second legitimate adminDb bypass case in the codebase
 * (the first is JIT sign-in linking in db/tenant.ts) — both share the
 * same shape: a case where RLS's tenant-session model genuinely doesn't
 * apply yet, not a shortcut around it.
 */
export async function lookupPoByToken(qrToken: string): Promise<PoVerification | null> {
  const [po] = await adminDb.select().from(purchaseOrders).where(eq(purchaseOrders.qrToken, qrToken));
  if (!po) return null;

  const [tenant] = await adminDb.select().from(tenants).where(eq(tenants.id, po.tenantId));
  const [vendor] = await adminDb.select().from(vendors).where(eq(vendors.id, po.vendorId));

  let signatory: PoVerification["signatory"] = null;
  if (po.signedBy) {
    const [match] = await adminDb
      .select({ name: users.fullName, title: signatories.title })
      .from(signatories)
      .innerJoin(users, eq(users.id, signatories.userId))
      .where(and(eq(signatories.userId, po.signedBy), eq(signatories.tenantId, po.tenantId), eq(signatories.active, true)));
    signatory = match ?? null;
  }

  return {
    poNumber: po.poNumber,
    tenantName: tenant?.name ?? "Unknown",
    vendorName: vendor?.name ?? "Unknown",
    totalAmount: po.totalAmount,
    currency: po.currency,
    status: po.status,
    issuedAt: po.signedAt ?? po.createdAt,
    documentHash: po.documentHash,
    signatory,
  };
}
