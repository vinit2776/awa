"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import { recordGoodsReceipt, recordServiceAcceptance, type GoodsLineInput, type ServiceLineInput } from "@/db/fulfillment";

export async function submitGoodsReceipt(formData: FormData) {
  const poId = String(formData.get("poId") ?? "");
  const receivedBy = String(formData.get("receivedBy") ?? "");
  const deliveryNoteRef = String(formData.get("deliveryNoteRef") ?? "").trim() || null;
  if (!poId || !receivedBy) return;

  const poLineIds = formData.getAll("poLineId").map(String);
  const quantitiesDelivered = formData.getAll("quantityDelivered").map(String);
  const quantitiesAccepted = formData.getAll("quantityAccepted").map(String);
  const quantitiesRejected = formData.getAll("quantityRejected").map(String);
  const conditions = formData.getAll("condition").map(String) as GoodsLineInput["condition"][];
  const rejectionReasons = formData.getAll("rejectionReason").map(String);

  const lines: GoodsLineInput[] = poLineIds
    .map((poLineId, i) => ({
      poLineId,
      quantityDelivered: quantitiesDelivered[i] ?? "0",
      quantityAccepted: quantitiesAccepted[i] ?? "0",
      quantityRejected: quantitiesRejected[i] ?? "0",
      condition: conditions[i] ?? "good",
      rejectionReason: rejectionReasons[i]?.trim() || null,
    }))
    .filter((l) => Number(l.quantityDelivered) > 0);

  const { user, tenant } = await getCurrentUserAndTenant();
  await withTenant(tenant.id, (tx) => recordGoodsReceipt(tx, tenant.id, user.id, poId, receivedBy, deliveryNoteRef, lines));

  revalidatePath(`/dashboard/fulfillment/${poId}`);
  revalidatePath("/dashboard/fulfillment");
}

export async function submitServiceAcceptance(formData: FormData) {
  const poId = String(formData.get("poId") ?? "");
  if (!poId) return;

  const poLineIds = formData.getAll("poLineId").map(String);
  const acceptedValues = formData.getAll("acceptedValue").map(String);
  const statuses = formData.getAll("status").map(String) as ServiceLineInput["status"][];
  const rejectionReasons = formData.getAll("rejectionReason").map(String);

  const lines: ServiceLineInput[] = poLineIds.map((poLineId, i) => ({
    poLineId,
    acceptedValue: acceptedValues[i] ?? "0",
    status: statuses[i] ?? "accepted",
    rejectionReason: rejectionReasons[i]?.trim() || null,
  }));

  const { user, tenant } = await getCurrentUserAndTenant();
  await withTenant(tenant.id, (tx) => recordServiceAcceptance(tx, tenant.id, user.id, poId, lines));

  revalidatePath(`/dashboard/fulfillment/${poId}`);
  revalidatePath("/dashboard/fulfillment");
}
