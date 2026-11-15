import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

export function generateChallanPdf({ store, items, dateInput, challanNo }) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 40;
  const [y, m, d] = dateInput.split("-");
  const dmy = `${d}/${m}/${y}`;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("TAATSU Consumables & Supplies", pageW / 2, 56, { align: "center" });
  doc.setFontSize(14);
  doc.text("Challan", pageW / 2, 78, { align: "center" });

  doc.setFontSize(10);
  doc.text("Delivery date", margin, 112);
  doc.setFont("helvetica", "normal");
  doc.text(dmy, margin + 70, 112);
  doc.text(String(store.poc_contact || ""), pageW - margin, 112, { align: "right" });

  doc.setFont("helvetica", "bold");
  doc.text("Store Location", margin, 132);
  doc.setFont("helvetica", "normal");
  const addr = doc.splitTextToSize(store.address || "", pageW - margin * 2 - 80);
  doc.text(addr, margin + 80, 132);

  const yy = 132 + addr.length * 12 + 6;
  doc.setFont("helvetica", "bold");
  doc.text("Challan No", margin, yy);
  doc.setFont("helvetica", "normal");
  doc.text(challanNo, margin + 80, yy);

  autoTable(doc, {
    startY: yy + 16,
    margin: { left: margin, right: margin },
    head: [["Sub-Category", "Product-Title", "Quantity", "Base-Unit"]],
    body: items.map((i) => ["Consumable", i.product_title, String(i.qty), i.base_unit]),
    theme: "grid",
    styles: { fontSize: 10, cellPadding: 6, lineColor: [180, 180, 180], lineWidth: 0.5 },
    headStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: "bold" },
    columnStyles: { 2: { halign: "right", cellWidth: 70 }, 3: { cellWidth: 80 } },
  });

  doc.save(`Consumables_Challan_TAATSU__${store.name}_${dmy.replace(/\//g, "_")}.pdf`);
}