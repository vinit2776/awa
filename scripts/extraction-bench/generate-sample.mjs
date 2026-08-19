#!/usr/bin/env node
// Generates a synthetic, realistic-looking invoice as a real searchable-text
// PDF (drawn text, not an image) so the text-layer / no-API path can be
// smoke-tested without a real vendor document. Also writes a matching
// *.truth.json so heuristicExtract's output can be scored.

import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { PDFParse } from "pdf-parse";

const OUT_DIR = path.join(process.cwd(), "sample-docs");
const FILE_BASENAME = "sample-invoice-1";

const invoice = {
  vendorName: "Acme Industrial Supplies",
  documentType: "invoice",
  documentNumber: "INV-2026-00842",
  documentDate: "2026-07-15",
  dueOrValidUntil: "2026-08-14",
  currency: "USD",
  lineItems: [
    { description: "M8 Hex Bolts, Zinc-Plated (box of 100)", quantity: 12, unitPrice: 18.5, lineTotal: 222.0 },
    { description: "Industrial Gloves, Size L (pair)", quantity: 40, unitPrice: 3.25, lineTotal: 130.0 },
    { description: "Safety Goggles, Anti-Fog", quantity: 15, unitPrice: 9.99, lineTotal: 149.85 },
  ],
};
invoice.subtotal = invoice.lineItems.reduce((s, l) => s + l.lineTotal, 0);
invoice.tax = Math.round(invoice.subtotal * 0.08 * 100) / 100;
invoice.totalAmount = Math.round((invoice.subtotal + invoice.tax) * 100) / 100;

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]); // US Letter
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let y = 740;
  const left = 50;
  const draw = (text, { x = left, size = 11, f = font, color = rgb(0, 0, 0) } = {}) => {
    page.drawText(text, { x, y, size, font: f, color });
    y -= size + 8;
  };

  draw(invoice.vendorName, { size: 18, f: bold });
  y -= 6;
  draw("123 Industrial Way, Suite 400, Columbus, OH 43215");
  y -= 10;

  draw(`INVOICE`, { size: 16, f: bold });
  draw(`Invoice Number: ${invoice.documentNumber}`);
  draw(`Invoice Date: ${invoice.documentDate}`);
  draw(`Due Date: ${invoice.dueOrValidUntil}`);
  draw(`Currency: ${invoice.currency}`);
  y -= 14;

  draw("Description", { f: bold });
  const descY = y + 8 + 11;
  page.drawText("Qty", { x: 360, y: descY, size: 11, font: bold });
  page.drawText("Unit Price", { x: 420, y: descY, size: 11, font: bold });
  page.drawText("Line Total", { x: 510, y: descY, size: 11, font: bold });
  y -= 6;

  for (const item of invoice.lineItems) {
    const rowY = y;
    page.drawText(item.description, { x: left, y: rowY, size: 10, font });
    page.drawText(String(item.quantity), { x: 360, y: rowY, size: 10, font });
    page.drawText(`$${item.unitPrice.toFixed(2)}`, { x: 420, y: rowY, size: 10, font });
    page.drawText(`$${item.lineTotal.toFixed(2)}`, { x: 510, y: rowY, size: 10, font });
    y -= 18;
  }
  y -= 14;

  draw(`Subtotal: $${invoice.subtotal.toFixed(2)}`, { x: 400 });
  draw(`Tax (8%): $${invoice.tax.toFixed(2)}`, { x: 400 });
  draw(`Total Due: $${invoice.totalAmount.toFixed(2)}`, { x: 400, size: 13, f: bold });

  const pdfBytes = await pdf.save();
  const pdfPath = path.join(OUT_DIR, `${FILE_BASENAME}.pdf`);
  await fs.writeFile(pdfPath, pdfBytes);

  const truthPath = path.join(OUT_DIR, `${FILE_BASENAME}.pdf.truth.json`);
  await fs.writeFile(truthPath, JSON.stringify(invoice, null, 2));

  console.log(`Wrote ${pdfPath}`);
  console.log(`Wrote ${truthPath}`);

  // Also render it as a flat image with no text layer, to exercise the
  // vision-API path (the searchable PDF above only exercises stage 1).
  const parser = new PDFParse({ data: pdfBytes });
  const screenshot = await parser.getScreenshot({ scale: 2, first: 1 });
  await parser.destroy();
  const imgPath = path.join(OUT_DIR, `${FILE_BASENAME}-scanned.png`);
  await fs.writeFile(imgPath, screenshot.pages[0].data);
  const imgTruthPath = path.join(OUT_DIR, `${FILE_BASENAME}-scanned.png.truth.json`);
  await fs.writeFile(imgTruthPath, JSON.stringify(invoice, null, 2));
  console.log(`Wrote ${imgPath}`);
  console.log(`Wrote ${imgTruthPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
