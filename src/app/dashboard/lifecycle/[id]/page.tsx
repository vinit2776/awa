import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import {
  purchaseRequisitions as purchaseRequisitionsTable,
  rfqs as rfqsTable,
  vendorQuotations as quotationsTable,
  purchaseOrders as purchaseOrdersTable,
  invoices as invoicesTable,
  paymentInstructions as paymentInstructionsTable,
  vendors as vendorsTable,
  users as usersTable,
} from "@/db/schema";
import { computeStage } from "../stage";

export default async function LifecycleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { tenant } = await getCurrentUserAndTenant();

  const data = await withTenant(tenant.id, async (tx) => {
    const [requisition] = await tx.select().from(purchaseRequisitionsTable).where(eq(purchaseRequisitionsTable.id, id));
    if (!requisition) return null;

    const rfqRows = await tx.select().from(rfqsTable).where(eq(rfqsTable.requisitionId, id));
    const rfq = rfqRows[0];
    const quotations = rfq ? await tx.select().from(quotationsTable).where(eq(quotationsTable.rfqId, rfq.id)) : [];
    const [po] = await tx.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.requisitionId, id));
    const [invoice] = po ? await tx.select().from(invoicesTable).where(eq(invoicesTable.poId, po.id)) : [];
    const [payment] = invoice ? await tx.select().from(paymentInstructionsTable).where(eq(paymentInstructionsTable.invoiceId, invoice.id)) : [];
    const users = await tx.select().from(usersTable);
    const vendors = await tx.select().from(vendorsTable);

    return { requisition, rfq, quotations, po, invoice, payment, users, vendors };
  });

  if (!data) notFound();
  const { requisition, rfq, quotations, po, invoice, payment, users, vendors } = data;

  const requestorName = users.find((u) => u.id === requisition.requestorId)?.fullName ?? "—";
  const vendorName = (id: string) => vendors.find((v) => v.id === id)?.name ?? "—";
  const stage = computeStage(requisition, rfq ? [rfq] : [], po, invoice, payment);

  const steps: { label: string; done: boolean; detail: string }[] = [
    { label: "Requisition", done: true, detail: `${requestorName} — ${requisition.totalEstimatedValue} ${requisition.currency} — ${requisition.status}` },
    { label: "Approval", done: ["approved", "converted_to_po"].includes(requisition.status), detail: requisition.status === "pending_approval" ? "In progress" : requisition.status },
    { label: "Sourcing", done: !!po, detail: quotations.length ? `${quotations.length} quotation(s)` : rfq ? "RFQ open, no quotations yet" : "Not started" },
    { label: "Purchase order", done: !!po, detail: po ? `${po.poNumber} — ${vendorName(po.vendorId)} — ${po.status}` : "Not issued" },
    { label: "Receipt / acceptance", done: po?.status === "fulfilled", detail: po?.status === "fulfilled" ? "Complete" : po ? "Awaiting receipt" : "—" },
    { label: "Invoice", done: !!invoice && invoice.status !== "exception", detail: invoice ? `${invoice.invoiceNumber} — ${invoice.status}` : "Not submitted" },
    { label: "Payment", done: payment?.status === "released", detail: payment ? payment.status : invoice?.status === "approved_for_payment" ? "Awaiting queue" : "—" },
  ];

  return (
    <div className="flex flex-col gap-6 p-8">
      <div>
        <h1 className="text-lg font-medium">Requisition lifecycle</h1>
        <p className="text-sm text-muted-foreground">Current stage: {stage}</p>
      </div>

      <ol className="flex flex-col gap-4">
        {steps.map((step) => (
          <li key={step.label} className="flex items-start gap-3">
            <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${step.done ? "bg-emerald-500" : "bg-muted-foreground/30"}`} />
            <div>
              <p className="text-sm font-medium">{step.label}</p>
              <p className="text-sm text-muted-foreground">{step.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
