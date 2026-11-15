// app/api/purchase-bills/export/route.js
// CSV export of APPROVED purchase bills for Barometer (one row per line item).
// The column list below is a placeholder template — when Barometer sends their exact
// import template, only BAROMETER_COLUMNS needs editing.
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// [column header, function(row)] — row = { bill, item } (item can be null for a
// bill saved without line items; those bills still get one row so nothing disappears)
const BAROMETER_COLUMNS = [
  ["Vendor Name", (r) => r.bill.vendor_name],
  ["Vendor GSTIN", (r) => r.bill.vendor_gstin],
  ["Cost Center", (r) => (r.item && r.item.cost_center) || r.bill.cost_center],
  ["Invoice Number", (r) => r.bill.invoice_number],
  ["Invoice Date", (r) => r.bill.invoice_date],
  ["Due Date", (r) => r.bill.due_date],
  ["Item Description", (r) => r.item && r.item.description],
  ["Quantity", (r) => r.item && r.item.quantity],
  ["Unit", (r) => r.item && r.item.unit],
  ["Rate", (r) => r.item && r.item.rate],
  ["Tax Rate %", (r) => r.item && r.item.tax_rate],
  ["Line Total", (r) => r.item && r.item.line_total],
  ["Subtotal", (r) => r.bill.subtotal],
  ["Tax Total", (r) => r.bill.tax_total],
  ["Discount Type", (r) => r.bill.discount_type],
  ["Discount Value", (r) => r.bill.discount_value],
  ["Other Charges", (r) => r.bill.other_charges],
  ["Freight Charges", (r) => r.bill.freight_charges],
  ["Grand Total", (r) => r.bill.computed_total],
  ["Status", (r) => r.bill.status],
  ["Zoho Bill ID", (r) => r.bill.zoho_bill_id],
];

// CSV cell: quote when it contains a comma, quote or newline
const cell = (v) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

export async function GET() {
  // approved bills, oldest approval first
  const { data: bills, error } = await sb
    .from("purchase_bills")
    .select("*")
    .eq("status", "approved")
    .order("approved_at", { ascending: true });
  if (error) return new Response(error.message, { status: 500 });

  const rows = [];
  for (const bill of bills || []) {
    const { data: items } = await sb
      .from("purchase_bill_items")
      .select("*")
      .eq("bill_id", bill.id)
      .order("position");
    const list = items && items.length > 0 ? items : [null];
    for (const item of list) rows.push({ bill, item });
  }

  const head = BAROMETER_COLUMNS.map(([h]) => h).join(",");
  const body = rows.map((r) => BAROMETER_COLUMNS.map(([, fn]) => cell(fn(r))).join(",")).join("\n");
  const csv = "\uFEFF" + head + "\n" + body + "\n"; // BOM so Excel opens it as UTF-8

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition":
        'attachment; filename="purchase_bills_' + new Date().toISOString().slice(0, 10) + '.csv"',
    },
  });
}
