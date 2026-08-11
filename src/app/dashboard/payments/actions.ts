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
export async function releasePayment(formData: FormData) {
  const paymentId = String(formData.get("paymentId") ?? "");
  if (!paymentId) return;

  const { user, tenant } = await getCurrentUserAndTenant();

  await withTenant(tenant.id, async (tx) => {
    const [payment] = await tx
      .select()
      .from(paymentInstructions)
      .where(and(eq(paymentInstructions.id, paymentId), eq(paymentInstructions.status, "queued")));
    if (!payment) return;

    await tx
      .update(paymentInstructions)
      .set({ status: "released", releasedBy: user.id, releasedAt: new Date() })
      .where(eq(paymentInstructions.id, paymentId));
    await tx.update(invoices).set({ status: "paid" }).where(eq(invoices.id, payment.invoiceId));

    await logAction(tx, {
      tenantId: tenant.id,
      actorUserId: user.id,
      action: "payment.released",
      entityType: "payment_instruction",
      entityId: paymentId,
      metadata: { invoiceId: payment.invoiceId, amount: payment.amount },
    });
  });

  revalidatePath("/dashboard/payments");
  revalidatePath("/dashboard/invoices");
}
