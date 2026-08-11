"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import { recordGoodsReceipt, recordServiceAcceptance, type GoodsLineInput, type ServiceLineInput } from "@/db/fulfillment";
import { advanceVendorReturn, initiateVendorReturn, type VendorReturnStatus } from "@/db/vendorReturns";
import { createMilestone } from "@/db/serviceMilestones";

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

export async function submitMilestoneAcceptance(formData: FormData) {
  const poId = String(formData.get("poId") ?? "");
  if (!poId) return;

  const poLineIds = formData.getAll("poLineId").map(String);
  const milestoneIds = formData.getAll("milestoneId").map(String);
  const acceptedValues = formData.getAll("acceptedValue").map(String);
  const statuses = formData.getAll("status").map(String) as ServiceLineInput["status"][];
  const rejectionReasons = formData.getAll("rejectionReason").map(String);

  const lines: ServiceLineInput[] = poLineIds.map((poLineId, i) => ({
    poLineId,
    milestoneId: milestoneIds[i] || null,
    acceptedValue: acceptedValues[i] ?? "0",
    status: statuses[i] ?? "accepted",
    rejectionReason: rejectionReasons[i]?.trim() || null,
  }));

  const { user, tenant } = await getCurrentUserAndTenant();
  await withTenant(tenant.id, (tx) => recordServiceAcceptance(tx, tenant.id, user.id, poId, lines));

  revalidatePath(`/dashboard/fulfillment/${poId}`);
  revalidatePath("/dashboard/fulfillment");
}

export async function defineMilestone(formData: FormData) {
  const poId = String(formData.get("poId") ?? "");
  const milestoneNo = Number(formData.get("milestoneNo") ?? "");
  const description = String(formData.get("description") ?? "");
  const valueType = String(formData.get("valueType") ?? "percent");
  const value = String(formData.get("value") ?? "");
  const dueDate = String(formData.get("dueDate") ?? "").trim() || null;
  if (!poId) return;

  const { user, tenant } = await getCurrentUserAndTenant();
  const result = await withTenant(tenant.id, (tx) =>
    createMilestone(tx, tenant.id, user.id, poId, {
      milestoneNo,
      description,
      percentOfValue: valueType === "percent" ? value : null,
      fixedValue: valueType === "fixed" ? value : null,
      dueDate,
    }),
  );
  if (result.error) {
    redirect(`/dashboard/fulfillment/${poId}?error=${encodeURIComponent(result.error)}`);
  }

  revalidatePath(`/dashboard/fulfillment/${poId}`);
}

export async function initiateReturn(formData: FormData) {
  const poId = String(formData.get("poId") ?? "");
  const grnLineId = String(formData.get("grnLineId") ?? "");
  const quantity = String(formData.get("quantity") ?? "");
  const reason = String(formData.get("reason") ?? "");
  if (!poId || !grnLineId) return;

  const { user, tenant } = await getCurrentUserAndTenant();
  const result = await withTenant(tenant.id, (tx) => initiateVendorReturn(tx, tenant.id, user.id, grnLineId, quantity, reason));
  if (result.error) {
    redirect(`/dashboard/fulfillment/${poId}?error=${encodeURIComponent(result.error)}`);
  }

  revalidatePath(`/dashboard/fulfillment/${poId}`);
}

export async function advanceReturn(formData: FormData) {
  const poId = String(formData.get("poId") ?? "");
  const returnId = String(formData.get("returnId") ?? "");
  const nextStatus = String(formData.get("nextStatus") ?? "") as VendorReturnStatus;
  const reference = String(formData.get("reference") ?? "").trim() || null;
  if (!poId || !returnId || !nextStatus) return;

  const { user, tenant } = await getCurrentUserAndTenant();
  const result = await withTenant(tenant.id, (tx) => advanceVendorReturn(tx, tenant.id, user.id, returnId, nextStatus, reference));
  if (result.error) {
    redirect(`/dashboard/fulfillment/${poId}?error=${encodeURIComponent(result.error)}`);
  }

  revalidatePath(`/dashboard/fulfillment/${poId}`);
}
