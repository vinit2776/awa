import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import QRCode from "qrcode";

/**
 * Single page, no flow/pagination — fine for the line counts a
 * requisition produces today; a PO with dozens of lines would need
 * real multi-page layout, which isn't built yet.
 */
export async function generatePoPdf(params: {
  poNumber: string;
  vendorName: string;
  totalAmount: string;
  currency: string;
  documentHash: string;
  qrToken: string;
  verifyUrl: string;
  issuedAt: Date;
  lines: { description: string; quantity: string; uom: string; unitPrice: string; lineTotal: string }[];
}): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let y = 800;
  const draw = (text: string, x: number, size = 10, f = font) => {
    page.drawText(text, { x, y, size, font: f, color: rgb(0, 0, 0) });
  };

  draw("Purchase Order", 40, 20, bold);
  y -= 28;
  draw(params.poNumber, 40, 14, bold);
  y -= 20;
  draw(`Vendor: ${params.vendorName}`, 40);
  y -= 16;
  draw(`Issued: ${params.issuedAt.toISOString().slice(0, 10)}`, 40);
  y -= 16;
  draw(`Total: ${params.totalAmount} ${params.currency}`, 40);
  y -= 30;

  draw("Description", 40, 9, bold);
  draw("Qty", 300, 9, bold);
  draw("UoM", 340, 9, bold);
  draw("Unit price", 390, 9, bold);
  draw("Line total", 470, 9, bold);
  y -= 14;

  for (const line of params.lines) {
    draw(line.description.slice(0, 45), 40, 9);
    draw(line.quantity, 300, 9);
    draw(line.uom, 340, 9);
    draw(line.unitPrice, 390, 9);
    draw(line.lineTotal, 470, 9);
    y -= 14;
  }

  y -= 24;
  draw(`Document hash (SHA-256): ${params.documentHash}`, 40, 7);
  y -= 12;
  draw(`Verification token: ${params.qrToken}`, 40, 7);

  const qrDataUrl = await QRCode.toDataURL(params.verifyUrl, { margin: 0 });
  const qrImageBytes = Buffer.from(qrDataUrl.split(",")[1], "base64");
  const qrImage = await pdfDoc.embedPng(qrImageBytes);
  page.drawImage(qrImage, { x: 470, y: 700, width: 80, height: 80 });

  return pdfDoc.save();
}
