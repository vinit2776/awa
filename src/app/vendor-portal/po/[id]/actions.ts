"use server";

import { revalidatePath } from "next/cache";
import { getCurrentVendorUser } from "@/db/vendorSession";
import { withTenant } from "@/db/withTenant";
import { confirmVendorPo } from "@/db/vendorPortal";

export async function confirmPo(formData: FormData) {
  const poId = String(formData.get("poId") ?? "");
  if (!poId) return;

  const vendorUser = await getCurrentVendorUser();
  await withTenant(vendorUser.tenantId, (tx) =>
    confirmVendorPo(tx, vendorUser.tenantId, poId, vendorUser.vendorUserId, vendorUser.vendorUserEmail),
  );

  revalidatePath(`/vendor-portal/po/${poId}`);
  revalidatePath("/vendor-portal");
}
