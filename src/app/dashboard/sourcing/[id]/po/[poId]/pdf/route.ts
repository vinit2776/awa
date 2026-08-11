import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import {
  purchaseOrders as purchaseOrdersTable,
  purchaseOrderLines as purchaseOrderLinesTable,
  vendors as vendorsTable,
  catalogItems as catalogItemsTable,
} from "@/db/schema";
import { generatePoPdf } from "@/db/poPdf";

export async function GET(request: Request, { params }: { params: Promise<{ id: string; poId: string }> }) {
  const { poId } = await params;
  const { tenant } = await getCurrentUserAndTenant();

  const [po, lines, catalogItems] = await withTenant(tenant.id, async (tx) => {
    const [po] = await tx.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, poId));
    if (!po) return [null, [], []] as const;
    const lines = await tx.select().from(purchaseOrderLinesTable).where(eq(purchaseOrderLinesTable.poId, poId));
    const catalogItems = await tx.select().from(catalogItemsTable);
    return [po, lines, catalogItems] as const;
  });

  if (!po) return new NextResponse("Not found", { status: 404 });

  const [vendor] = await withTenant(tenant.id, (tx) => tx.select().from(vendorsTable).where(eq(vendorsTable.id, po.vendorId)));

  const itemName = (itemId: string | null) => catalogItems.find((i) => i.id === itemId)?.name ?? null;
  const origin = new URL(request.url).origin;

  const pdfBytes = await generatePoPdf({
    poNumber: po.poNumber,
    vendorName: vendor?.name ?? "Vendor",
    totalAmount: po.totalAmount,
    currency: po.currency,
    documentHash: po.documentHash ?? "",
    qrToken: po.qrToken ?? "",
    verifyUrl: `${origin}/po-verify/${po.qrToken}`,
    issuedAt: po.signedAt ?? po.createdAt,
    lines: lines.map((l) => ({
      description: l.serviceDescription ?? itemName(l.itemId) ?? "Item",
      quantity: l.quantity,
      uom: l.uom,
      unitPrice: l.unitPrice,
      lineTotal: l.lineTotal,
    })),
  });

  return new NextResponse(Buffer.from(pdfBytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${po.poNumber}.pdf"`,
    },
  });
}
