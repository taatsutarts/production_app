/* Delivery challan PDF for the shipment planner (spec section 16).
 *
 * One challan per outlet: Gourmet Zone Foods Private Limited header, FSSAI number,
 * "Delivery Challan" title, the Taatsu brand, delivery + generation dates, the
 * outlet's location block, and the item table:
 *   Serial number | SKU | SKU name | Unit | Quantity | Batch | Mfg date | Expiry date
 *
 * Batch rules (hard-coded for now, spec §16): manufacturing date = yesterday
 * (the day before dispatch), batch number = the manufacturing date without slashes
 * (14112026), expiry = manufacturing date + `expiryDays` (30 by default).
 *
 * Client-side only (jsPDF in the browser), same pattern as lib/challan.js.
 */
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

const pad2 = (n) => String(n).padStart(2, "0");
const dmy = (d) => {
  const x = new Date(d);
  return `${pad2(x.getDate())}/${pad2(x.getMonth() + 1)}/${x.getFullYear()}`;
};
const dmyNoSlash = (d) => dmy(d).replace(/\//g, "");

/* items: [{ name, sku, qty, unit, category }] for ONE outlet */
export function generateDeliveryChallan({
  outletName,
  outletAddress,
  outletContact,
  items,
  dispatchDate, // YYYY-MM-DD the goods are delivered
  company = "Gourmet Zone Foods Private Limited",
  fssai = "",
  brand = "Taatsu",
  expiryDays = 30,
}) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const w = doc.internal.pageSize.getWidth();
  const m = 40;

  // manufacturing = yesterday (the day before dispatch); batch = mfg without slashes
  const mfg = new Date(dispatchDate + "T00:00");
  mfg.setDate(mfg.getDate() - 1);
  const exp = new Date(mfg);
  exp.setDate(exp.getDate() + expiryDays);
  const batch = dmyNoSlash(mfg);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(company, w / 2, 52, { align: "center" });
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(fssai ? `FSSAI: ${fssai}` : "FSSAI: —", w / 2, 68, { align: "center" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Delivery Challan", w / 2, 92, { align: "center" });
  doc.setFontSize(11);
  doc.text(`Brand: ${brand}`, w / 2, 110, { align: "center" });

  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Delivery date", m, 138);
  doc.setFont("helvetica", "normal");
  doc.text(dmy(dispatchDate), m + 78, 138);
  doc.setFont("helvetica", "bold");
  doc.text("Challan generated", m + 200, 138);
  doc.setFont("helvetica", "normal");
  doc.text(dmy(new Date()), m + 312, 138);

  doc.setFont("helvetica", "bold");
  doc.text("Deliver to", m, 160);
  doc.setFont("helvetica", "normal");
  const nameLines = doc.splitTextToSize(outletName, w - m * 2 - 80);
  doc.text(nameLines, m + 80, 160);
  const addrY = 160 + nameLines.length * 12;
  const addrLines = doc.splitTextToSize(outletAddress || "", w - m * 2 - 80);
  doc.text(addrLines, m + 80, addrY);
  if (outletContact) {
    doc.text(outletContact, m + 80, addrY + addrLines.length * 12);
  }

  const rows = (items || []).map((it, i) => [
    String(i + 1),
    it.sku || "—",
    it.name,
    it.unit || "piece",
    String(Math.round(it.qty)),
    batch,
    dmy(mfg),
    dmy(exp),
  ]);

  autoTable(doc, {
    startY: addrY + addrLines.length * 12 + (outletContact ? 14 : 2) + 10,
    margin: { left: m, right: m },
    head: [["#", "SKU", "SKU name", "Unit", "Qty", "Batch", "Mfg date", "Expiry"]],
    body: rows,
    theme: "grid",
    styles: { fontSize: 9, cellPadding: 5, lineColor: [180, 180, 180], lineWidth: 0.5 },
    headStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: 24, halign: "center" },
      3: { cellWidth: 50 },
      4: { halign: "right", cellWidth: 44 },
    },
  });

  doc.save(`Delivery_Challan_${brand}_${outletName.replace(/[^A-Za-z0-9]+/g, "_")}_${dmy(dispatchDate).replace(/\//g, "-")}.pdf`);
}
