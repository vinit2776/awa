"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import { logAction } from "@/db/audit";
import { issuePurchaseOrder } from "@/db/po";
import { rfqs, rfqVendorInvitations, vendorQuotations } from "@/db/schema";

export async function createRfq(formData: FormData) {
  const requisitionId = String(formData.get("requisitionId") ?? "");
  if (!requisitionId) return;

  const { user, tenant } = await getCurrentUserAndTenant();

  await withTenant(tenant.id, async (tx) => {
    const [created] = await tx.insert(rfqs).values({ tenantId: tenant.id, requisitionId }).returning();
    await logAction(tx, {
      tenantId: tenant.id,
      actorUserId: user.id,
      action: "rfq.created",
      entityType: "rfq",
      entityId: created.id,
      metadata: { requisitionId },
    });
  });

  revalidatePath(`/dashboard/sourcing/${requisitionId}`);
}

export async function inviteVendor(formData: FormData) {
  const rfqId = String(formData.get("rfqId") ?? "");
  const vendorId = String(formData.get("vendorId") ?? "");
  const requisitionId = String(formData.get("requisitionId") ?? "");
  if (!rfqId || !vendorId) return;

  const { user, tenant } = await getCurrentUserAndTenant();

  await withTenant(tenant.id, async (tx) => {
    const [created] = await tx.insert(rfqVendorInvitations).values({ tenantId: tenant.id, rfqId, vendorId }).returning();
    await logAction(tx, {
      tenantId: tenant.id,
      actorUserId: user.id,
      action: "rfq_vendor_invitation.created",
      entityType: "rfq_vendor_invitation",
      entityId: created.id,
      metadata: { rfqId, vendorId },
    });
  });

  revalidatePath(`/dashboard/sourcing/${requisitionId}`);
}

export async function submitQuotation(formData: FormData) {
  const rfqId = String(formData.get("rfqId") ?? "");
  const vendorId = String(formData.get("vendorId") ?? "");
  const requisitionId = String(formData.get("requisitionId") ?? "");
  const totalAmount = String(formData.get("totalAmount") ?? "").trim();
  const validUntil = String(formData.get("validUntil") ?? "").trim() || null;
  if (!rfqId || !vendorId || !totalAmount) return;

  const { user, tenant } = await getCurrentUserAndTenant();

  await withTenant(tenant.id, async (tx) => {
    const [quotation] = await tx.insert(vendorQuotations).values({ tenantId: tenant.id, rfqId, vendorId, totalAmount, validUntil }).returning();
    await tx
      .update(rfqVendorInvitations)
      .set({ status: "quoted" })
      .where(and(eq(rfqVendorInvitations.rfqId, rfqId), eq(rfqVendorInvitations.vendorId, vendorId)));
    await logAction(tx, {
      tenantId: tenant.id,
      actorUserId: user.id,
      action: "vendor_quotation.submitted",
      entityType: "vendor_quotation",
      entityId: quotation.id,
      metadata: { rfqId, vendorId, totalAmount },
    });
  });

  revalidatePath(`/dashboard/sourcing/${requisitionId}`);
}

export async function selectQuotationAndIssuePo(formData: FormData) {
  const requisitionId = String(formData.get("requisitionId") ?? "");
  const vendorId = String(formData.get("vendorId") ?? "");
  const quotationId = String(formData.get("quotationId") ?? "");
  if (!requisitionId || !vendorId || !quotationId) return;

  const { user, tenant } = await getCurrentUserAndTenant();

  await withTenant(tenant.id, (tx) => issuePurchaseOrder(tx, tenant.id, user.id, requisitionId, vendorId, quotationId));

  revalidatePath(`/dashboard/sourcing/${requisitionId}`);
  revalidatePath("/dashboard/sourcing");
}
