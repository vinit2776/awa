"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import { logAction } from "@/db/audit";
import { paymentInstructions, invoices } from "@/db/schema";

// The deliberate human step (§05) — never automated. No CFO/controller
// role gating yet, matching every other admin/finance action in this
// app so far (a real gap, tracked consistently rather than enforced
// inconsistently in just this one place).
//
// Requires a reference/UTR number — "released" should mean something
// reconcilable against a bank statement, not just an internal click.
export async function releasePayment(formData: FormData) {
  const paymentId = String(formData.get("paymentId") ?? "");
  const referenceNumber = String(formData.get("referenceNumber") ?? "").trim();
  if (!paymentId || !referenceNumber) return;

  const { user, tenant } = await getCurrentUserAndTenant();

  await withTenant(tenant.id, async (tx) => {
    const [payment] = await tx
      .select()
      .from(paymentInstructions)
      .where(and(eq(paymentInstructions.id, paymentId), eq(paymentInstructions.status, "queued")));
    if (!payment) return;

    await tx
      .update(paymentInstructions)
      .set({ status: "released", releasedBy: user.id, releasedAt: new Date(), referenceNumber, failureReason: null })
      .where(eq(paymentInstructions.id, paymentId));
    await tx.update(invoices).set({ status: "paid" }).where(eq(invoices.id, payment.invoiceId));

    await logAction(tx, {
      tenantId: tenant.id,
      actorUserId: user.id,
      action: "payment.released",
      entityType: "payment_instruction",
      entityId: paymentId,
      metadata: { invoiceId: payment.invoiceId, amount: payment.amount, referenceNumber },
    });
  });

  revalidatePath("/dashboard/payments");
  revalidatePath("/dashboard/invoices");
}

// The other exit from "queued" — the bank/gateway rejected it. Leaves
// the invoice at approved_for_payment (not reverted) so retryPayment
// can put the same instruction straight back in the queue rather than
// re-running approval to get a second payment instruction.
export async function markPaymentFailed(formData: FormData) {
  const paymentId = String(formData.get("paymentId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!paymentId || !reason) return;

  const { user, tenant } = await getCurrentUserAndTenant();

  await withTenant(tenant.id, async (tx) => {
    const [payment] = await tx
      .select()
      .from(paymentInstructions)
      .where(and(eq(paymentInstructions.id, paymentId), eq(paymentInstructions.status, "queued")));
    if (!payment) return;

    await tx.update(paymentInstructions).set({ status: "failed", failureReason: reason }).where(eq(paymentInstructions.id, paymentId));

    await logAction(tx, {
      tenantId: tenant.id,
      actorUserId: user.id,
      action: "payment.failed",
      entityType: "payment_instruction",
      entityId: paymentId,
      metadata: { invoiceId: payment.invoiceId, amount: payment.amount, reason },
    });
  });

  revalidatePath("/dashboard/payments");
  revalidatePath("/dashboard/invoices");
}

export async function retryPayment(formData: FormData) {
  const paymentId = String(formData.get("paymentId") ?? "");
  if (!paymentId) return;

  const { user, tenant } = await getCurrentUserAndTenant();

  await withTenant(tenant.id, async (tx) => {
    const [payment] = await tx
      .select()
      .from(paymentInstructions)
      .where(and(eq(paymentInstructions.id, paymentId), eq(paymentInstructions.status, "failed")));
    if (!payment) return;

    await tx.update(paymentInstructions).set({ status: "queued", failureReason: null }).where(eq(paymentInstructions.id, paymentId));

    await logAction(tx, {
      tenantId: tenant.id,
      actorUserId: user.id,
      action: "payment.retry_queued",
      entityType: "payment_instruction",
      entityId: paymentId,
      metadata: { invoiceId: payment.invoiceId },
    });
  });

  revalidatePath("/dashboard/payments");
}
