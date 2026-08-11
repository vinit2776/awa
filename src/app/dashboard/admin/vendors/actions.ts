"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import { logAction } from "@/db/audit";
import { vendors, vendorUsers } from "@/db/schema";

export async function createVendor(formData: FormData) {
  const { user, tenant } = await getCurrentUserAndTenant();
  const name = String(formData.get("name") ?? "").trim();
  const taxId = String(formData.get("taxId") ?? "").trim() || null;
  if (!name) return;

  await withTenant(tenant.id, async (tx) => {
    const [created] = await tx.insert(vendors).values({ tenantId: tenant.id, name, taxId }).returning();
    await logAction(tx, {
      tenantId: tenant.id,
      actorUserId: user.id,
      action: "vendor.created",
      entityType: "vendor",
      entityId: created.id,
      metadata: { name },
    });
  });

  revalidatePath("/dashboard/admin/vendors");
}

export async function setVendorStatus(formData: FormData) {
  const { user, tenant } = await getCurrentUserAndTenant();
  const vendorId = String(formData.get("vendorId") ?? "");
  const status = String(formData.get("status") ?? "") as "pending" | "active" | "blacklisted";
  if (!vendorId || !status) return;

  await withTenant(tenant.id, async (tx) => {
    await tx.update(vendors).set({ status, updatedAt: new Date() }).where(eq(vendors.id, vendorId));
    await logAction(tx, {
      tenantId: tenant.id,
      actorUserId: user.id,
      action: "vendor.status_changed",
      entityType: "vendor",
      entityId: vendorId,
      metadata: { status },
    });
  });

  revalidatePath("/dashboard/admin/vendors");
}

export async function addVendorContact(formData: FormData) {
  const { user, tenant } = await getCurrentUserAndTenant();
  const vendorId = String(formData.get("vendorId") ?? "");
  const email = String(formData.get("email") ?? "").trim();
  const fullName = String(formData.get("fullName") ?? "").trim();
  if (!vendorId || !email || !fullName) return;

  await withTenant(tenant.id, async (tx) => {
    const [created] = await tx.insert(vendorUsers).values({ tenantId: tenant.id, vendorId, email, fullName }).returning();
    await logAction(tx, {
      tenantId: tenant.id,
      actorUserId: user.id,
      action: "vendor_contact.created",
      entityType: "vendor_user",
      entityId: created.id,
      metadata: { vendorId, email },
    });
  });

  revalidatePath("/dashboard/admin/vendors");
}
