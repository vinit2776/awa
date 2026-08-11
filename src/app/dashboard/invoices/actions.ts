"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import { logAction } from "@/db/audit";
import { matchInvoice } from "@/db/invoiceMatch";
import { invoices, invoiceLines, purchaseOrders, paymentInstructions } from "@/db/schema";

export async function createInvoice(formData: FormData) {
  const poId = String(formData.get("poId") ?? "");
  const invoiceNumber = String(formData.get("invoiceNumber") ?? "").trim();
  const invoiceDate = String(formData.get("invoiceDate") ?? "").trim();
  const currency = String(formData.get("currency") ?? "INR").trim();
  const fail = (message: string) => redirect(`/dashboard/invoices/new?poId=${poId}&error=${encodeURIComponent(message)}`);
  if (!poId || !invoiceNumber || !invoiceDate) fail("PO, invoice number, and date are required.");

  const poLineIds = formData.getAll("poLineId").map(String);
  const quantities = formData.getAll("quantity").map(String);
  const unitPrices = formData.getAll("unitPrice").map(String);
  const lineTotals = formData.getAll("lineTotal").map(String);

  const lines = poLineIds
    .map((poLineId, i) => ({
      poLineId,
      quantity: quantities[i] ?? "0",
      unitPrice: unitPrices[i] ?? "0",
      lineTotal: lineTotals[i] ?? "0",
    }))
    .filter((l) => Number(l.lineTotal) > 0);
  if (lines.length === 0) fail("Add at least one line with an amount greater than zero.");

  const { user, tenant } = await getCurrentUserAndTenant();
  const totalAmount = lines.reduce((sum, l) => sum + Number(l.lineTotal), 0).toFixed(2);

  const [po] = await withTenant(tenant.id, (tx) => tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, poId)));
  if (!po) fail("PO not found.");

  let newInvoiceId: string;
  try {
    newInvoiceId = await withTenant(tenant.id, async (tx) => {
      const [invoice] = await tx
        .insert(invoices)
        .values({ tenantId: tenant.id, vendorId: po.vendorId, poId, invoiceNumber, invoiceDate, totalAmount, currency })
        .returning();

      await tx.insert(invoiceLines).values(
        lines.map((l) => ({ tenantId: tenant.id, invoiceId: invoice.id, poLineId: l.poLineId, quantity: l.quantity, unitPrice: l.unitPrice, lineTotal: l.lineTotal })),
      );

      await logAction(tx, {
        tenantId: tenant.id,
        actorUserId: user.id,
        action: "invoice.submitted",
        entityType: "invoice",
        entityId: invoice.id,
        metadata: { invoiceNumber, totalAmount },
      });

      await matchInvoice(tx, tenant.id, invoice.id);
      return invoice.id;
    });
  } catch (err) {
    // The unique(tenant_id, vendor_id, invoice_number) constraint is the
    // phase-1 exact-duplicate-invoice baseline (§06) — this just turns
    // the raw constraint violation into a message someone can act on.
    if (err instanceof Error && "code" in err && err.code === "23505") {
      fail("This invoice number has already been submitted for this vendor.");
    }
    throw err;
  }

  revalidatePath("/dashboard/invoices");
  redirect(`/dashboard/invoices/${newInvoiceId}`);
}

export async function approveForPayment(formData: FormData) {
  const invoiceId = String(formData.get("invoiceId") ?? "");
  if (!invoiceId) return;

  const { user, tenant } = await getCurrentUserAndTenant();

  await withTenant(tenant.id, async (tx) => {
    const [invoice] = await tx.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.status, "matched")));
    if (!invoice) return;

    await tx.update(invoices).set({ status: "approved_for_payment" }).where(eq(invoices.id, invoiceId));
    await tx.insert(paymentInstructions).values({ tenantId: tenant.id, invoiceId, amount: invoice.totalAmount, currency: invoice.currency });
    await logAction(tx, {
      tenantId: tenant.id,
      actorUserId: user.id,
      action: "invoice.approved_for_payment",
      entityType: "invoice",
      entityId: invoiceId,
      metadata: {},
    });
  });

  revalidatePath("/dashboard/invoices");
  revalidatePath("/dashboard/payments");
}

export async function overrideException(formData: FormData) {
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!invoiceId || !reason) return;

  const { user, tenant } = await getCurrentUserAndTenant();

  await withTenant(tenant.id, async (tx) => {
    const [invoice] = await tx.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.status, "exception")));
    if (!invoice) return;

    await tx.update(invoices).set({ status: "approved_for_payment" }).where(eq(invoices.id, invoiceId));
    await tx.insert(paymentInstructions).values({ tenantId: tenant.id, invoiceId, amount: invoice.totalAmount, currency: invoice.currency });
    await logAction(tx, {
      tenantId: tenant.id,
      actorUserId: user.id,
      action: "invoice.exception_overridden",
      entityType: "invoice",
      entityId: invoiceId,
      metadata: { reason },
    });
  });

  revalidatePath("/dashboard/invoices");
  revalidatePath("/dashboard/payments");
}

export async function disputeInvoice(formData: FormData) {
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!invoiceId || !reason) return;

  const { user, tenant } = await getCurrentUserAndTenant();

  await withTenant(tenant.id, async (tx) => {
    await tx.update(invoices).set({ status: "disputed" }).where(eq(invoices.id, invoiceId));
    await logAction(tx, {
      tenantId: tenant.id,
      actorUserId: user.id,
      action: "invoice.disputed",
      entityType: "invoice",
      entityId: invoiceId,
      metadata: { reason },
    });
  });

  revalidatePath("/dashboard/invoices");
}
