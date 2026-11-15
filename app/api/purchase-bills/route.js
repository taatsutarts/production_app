// app/api/purchase-bills/route.js
// Purchase Bills CRUD: GET list, POST save (+ Google Drive upload), PATCH approve
// (+ first Zoho sync attempt), DELETE remove. Service-key Supabase client (same
// pattern as /api/extract) — the tables are RLS-locked so only server routes touch them.
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { uploadOriginal } from "@/lib/drive";
import { syncBill } from "@/lib/zoho";
import { norm } from "@/lib/purchaseMatch";

export const dynamic = "force-dynamic";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// small money helpers — the SAME math the page shows, so the server is the referee
const num = (v) => {
  if (v === null || v === undefined || v === "") return 0;
  const x = Number(String(v).replace(/[₹,\s]/g, ""));
  return isFinite(x) ? x : 0;
};
const r2 = (x) => Math.round(x * 100) / 100;

// subtotal = sum(qty x rate); tax = sum(qty x rate x tax%); computed_total adds the
// discount (-% or -Rs), other charges and freight. The printed grand_total is stored
// separately for review — the page shows a warning badge when the two disagree.
function computeTotals(bill, items) {
  const subtotal = r2(items.reduce((a, it) => a + num(it.quantity) * num(it.rate), 0));
  const taxTotal = r2(
    items.reduce((a, it) => a + (num(it.quantity) * num(it.rate) * num(it.tax_rate)) / 100, 0)
  );
  const discount =
    bill.discount_type === "%"
      ? r2((subtotal * num(bill.discount_value)) / 100)
      : bill.discount_type === "Rs"
        ? r2(num(bill.discount_value))
        : 0;
  const computed = r2(
    subtotal - discount + taxTotal + num(bill.other_charges) + num(bill.freight_charges)
  );
  return { subtotal, tax_total: taxTotal, computed_total: computed };
}

// server-side gate used by POST (new bill) and PUT (edit): the vendor must exist and
// EVERY line must point at a real master item + brand. Returns lookup maps for the
// inserts (brand id -> name, so cost_center keeps working for CSV/reports).
async function validateSave(bill, items) {
  const vendorId = bill.vendor_id || null;
  if (!vendorId) {
    return { error: "Resolve the vendor (match by GSTIN, pick a candidate or create one) before saving." };
  }
  const { data: vendor, error: vendorErr } = await sb
    .from("vendors")
    .select("id,vendor_name")
    .eq("id", vendorId)
    .maybeSingle();
  if (vendorErr) return { error: vendorErr.message };
  if (!vendor) return { error: "The selected vendor no longer exists — resolve the vendor again." };

  const itemIds = [...new Set(items.map((it) => it.item_id).filter(Boolean).map(String))];
  const brandIds = [...new Set(items.map((it) => it.brand_id).filter(Boolean).map(String))];
  const [itemRes, brandRes] = await Promise.all([
    itemIds.length
      ? sb.from("purchase_items").select("id").in("id", itemIds)
      : Promise.resolve({ data: [], error: null }),
    brandIds.length
      ? sb.from("brands").select("id,brand_name").in("id", brandIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const refErr = itemRes.error || brandRes.error;
  if (refErr) return { error: refErr.message };
  const itemOk = new Set((itemRes.data || []).map((r) => String(r.id)));
  const brandName = new Map((brandRes.data || []).map((r) => [String(r.id), r.brand_name]));
  const issues = [];
  items.forEach((it, i) => {
    if (!it.item_id || !itemOk.has(String(it.item_id))) issues.push(`line ${i + 1}: standard item`);
    if (!it.brand_id || !brandName.has(String(it.brand_id))) issues.push(`line ${i + 1}: brand`);
  });
  if (issues.length) {
    return { error: "Save blocked — resolve first: " + issues.slice(0, 6).join("; ") };
  }
  return { vendorId, brandName };
}

// remember the vendor's confirmed wording -> item (unique per vendor + normalized
// wording; last wording wins). A mapping failure must never lose a saved bill, so
// callers turn the return value into a warning, not an error.
async function upsertMappings(vendorId, items) {
  const mapMap = new Map();
  for (const it of items) {
    const desc = String(it.description || "").trim();
    if (!desc || !it.item_id) continue;
    mapMap.set(norm(desc), {
      vendor_id: vendorId,
      vendor_item_name: desc,
      normalized_vendor_item_name: norm(desc),
      item_id: it.item_id,
    });
  }
  const rows = [...mapMap.values()];
  if (!rows.length) return "";
  const { error } = await sb
    .from("vendor_item_mappings")
    .upsert(rows, { onConflict: "vendor_id,normalized_vendor_item_name" });
  return error ? "Mapping save failed (the bill itself is saved): " + error.message : "";
}

export async function GET(request) {
  // ?id=<uuid> -> one bill + its items (used by the Edit button)
  const id = request.nextUrl.searchParams.get("id");
  if (id) {
    // enriched: the vendor on the bill; item + brand on each line (used by the Edit screen)
    const { data: bill, error } = await sb
      .from("purchase_bills")
      .select("*, vendor:vendors(id,vendor_name,gstin)")
      .eq("id", id)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!bill) return NextResponse.json({ error: "Bill not found." }, { status: 404 });
    const { data: items, error: itemsErr } = await sb
      .from("purchase_bill_items")
      .select("*, item:purchase_items(id,item_name,brand_type), brand:brands(id,brand_name)")
      .eq("bill_id", id)
      .order("position");
    if (itemsErr) return NextResponse.json({ error: itemsErr.message }, { status: 500 });
    return NextResponse.json({ bill, items: items || [] });
  }
  const { data, error } = await sb
    .from("purchase_bills")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ bills: data || [] });
}

export async function POST(request) {
  try {
    const body = await request.json();
    const bill = body.bill || {};
    const items = Array.isArray(body.items) ? body.items : [];
    const file = body.file || null; // { name, mimeType, base64 } of the original

    // duplicate check: same vendor + same invoice number already saved?
    if (bill.vendor_name && bill.invoice_number) {
      const { data: dups } = await sb
        .from("purchase_bills")
        .select("id")
        .ilike("vendor_name", bill.vendor_name)
        .ilike("invoice_number", bill.invoice_number)
        .limit(1);
      if (dups && dups.length > 0) {
        return NextResponse.json(
          { error: "duplicate", message: "This vendor + invoice number is already saved (draft or approved)." },
          { status: 409 }
        );
      }
    }

    const totals = computeTotals(bill, items);

    // server is the referee: vendor resolved + every line has a real item + brand
    const gate = await validateSave(bill, items);
    if (gate.error) return NextResponse.json({ error: gate.error }, { status: 400 });

    // 1. save the bill first — an external failure later must never lose the invoice
    const { data: saved, error: billErr } = await sb
      .from("purchase_bills")
      .insert({
        vendor_id: gate.vendorId,
        vendor_name: bill.vendor_name || null,
        vendor_gstin: bill.vendor_gstin || null,
        cost_center: bill.cost_center || null,
        invoice_number: bill.invoice_number || null,
        invoice_date: bill.invoice_date || null,
        due_date: bill.due_date || null,
        discount_type:
          bill.discount_type === "%" || bill.discount_type === "Rs" ? bill.discount_type : null,
        discount_value:
          bill.discount_value === "" || bill.discount_value == null ? null : num(bill.discount_value),
        other_charges: num(bill.other_charges),
        freight_charges: num(bill.freight_charges),
        subtotal: totals.subtotal,
        tax_total: totals.tax_total,
        grand_total:
          bill.grand_total === "" || bill.grand_total == null ? null : num(bill.grand_total),
        computed_total: totals.computed_total,
        status: "draft",
        notes: bill.notes || null,
        drive_status: file ? "pending" : "not_configured",
        drive_error: file ? null : "no original file was attached to this save",
      })
      .select()
      .single();
    if (billErr) return NextResponse.json({ error: billErr.message }, { status: 500 });

    // 2. the line items (roll the bill back if this fails — no empty bills)
    const { error: itemsErr } = await sb.from("purchase_bill_items").insert(
      items.map((it, i) => ({
        bill_id: saved.id,
        position: i,
        description: it.description || null,
        // cost_center stays filled (= the line's brand name) for CSV/report compatibility
        cost_center: gate.brandName.get(String(it.brand_id)) || it.cost_center || null,
        item_id: it.item_id || null,
        brand_id: it.brand_id || null,
        quantity: num(it.quantity),
        unit: it.unit || null,
        rate: num(it.rate),
        tax_rate: num(it.tax_rate),
        line_total:
          it.line_total === "" || it.line_total == null ? null : num(it.line_total),
      }))
    );
    if (itemsErr) {
      await sb.from("purchase_bills").delete().eq("id", saved.id);
      return NextResponse.json({ error: itemsErr.message }, { status: 500 });
    }

    // 2b. remember the vendor's confirmed wording -> item so the next bill from this
    //     vendor matches automatically. A mapping failure must never lose the bill.
    const mappingWarning = await upsertMappings(gate.vendorId, items);

    // 3. upload the original to Drive (best effort — Drive failing never loses the bill)
    let driveError = "";
    if (file) {
      const up = await uploadOriginal({
        filename: file.name,
        mimeType: file.mimeType,
        base64: file.base64,
        costCenter: saved.cost_center,
        vendorName: saved.vendor_name,
        invoiceNumber: saved.invoice_number,
      });
      const patch = up.ok
        ? {
            drive_status: "uploaded",
            drive_file_id: up.fileId,
            drive_file_link: up.link,
            drive_path: up.path,
            drive_error: null,
          }
        : {
            drive_status: up.reason === "not_configured" ? "not_configured" : "failed",
            drive_error: up.error || "Google Drive is not configured yet",
          };
      await sb.from("purchase_bills").update(patch).eq("id", saved.id);
      driveError = patch.drive_error || "";
    }

    const { data: final } = await sb.from("purchase_bills").select("*").eq("id", saved.id).single();
    return NextResponse.json({
      bill: final,
      warning: [driveError, mappingWarning].filter(Boolean).join(" | "),
    });
  } catch (err) {
    console.error("purchase-bills save failed:", err);
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}

// PUT = edit an existing bill (the Edit button): same validation as POST, items are
// replaced wholesale (old ones restored if the insert fails), optional new original file.
export async function PUT(request) {
  try {
    const body = await request.json();
    const id = body.id;
    const bill = body.bill || {};
    const items = Array.isArray(body.items) ? body.items : [];
    const file = body.file || null;
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const { data: existing, error: exErr } = await sb
      .from("purchase_bills")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 });
    if (!existing) return NextResponse.json({ error: "Bill not found." }, { status: 404 });

    // duplicate check excluding this bill itself
    if (bill.vendor_name && bill.invoice_number) {
      const { data: dups } = await sb
        .from("purchase_bills")
        .select("id")
        .ilike("vendor_name", bill.vendor_name)
        .ilike("invoice_number", bill.invoice_number)
        .neq("id", id)
        .limit(1);
      if (dups && dups.length > 0) {
        return NextResponse.json(
          { error: "duplicate", message: "Another bill from this vendor already uses this invoice number." },
          { status: 409 }
        );
      }
    }

    const totals = computeTotals(bill, items);

    // server is the referee (same rules as a new bill)
    const gate = await validateSave(bill, items);
    if (gate.error) return NextResponse.json({ error: gate.error }, { status: 400 });

    const { error: upErr } = await sb
      .from("purchase_bills")
      .update({
        vendor_id: gate.vendorId,
        vendor_name: bill.vendor_name || null,
        vendor_gstin: bill.vendor_gstin || null,
        cost_center: bill.cost_center || null,
        invoice_number: bill.invoice_number || null,
        invoice_date: bill.invoice_date || null,
        due_date: bill.due_date || null,
        discount_type:
          bill.discount_type === "%" || bill.discount_type === "Rs" ? bill.discount_type : null,
        discount_value:
          bill.discount_value === "" || bill.discount_value == null ? null : num(bill.discount_value),
        other_charges: num(bill.other_charges),
        freight_charges: num(bill.freight_charges),
        subtotal: totals.subtotal,
        tax_total: totals.tax_total,
        grand_total:
          bill.grand_total === "" || bill.grand_total == null ? null : num(bill.grand_total),
        computed_total: totals.computed_total,
        notes: bill.notes || null,
      })
      .eq("id", id);
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    // replace the line items wholesale — but restore the old ones if the insert fails
    const { data: oldItems } = await sb
      .from("purchase_bill_items")
      .select("*")
      .eq("bill_id", id)
      .order("position");
    const { error: delErr } = await sb.from("purchase_bill_items").delete().eq("bill_id", id);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
    const { error: itemsErr } = await sb.from("purchase_bill_items").insert(
      items.map((it, i) => ({
        bill_id: id,
        position: i,
        description: it.description || null,
        cost_center: gate.brandName.get(String(it.brand_id)) || it.cost_center || null,
        item_id: it.item_id || null,
        brand_id: it.brand_id || null,
        quantity: num(it.quantity),
        unit: it.unit || null,
        rate: num(it.rate),
        tax_rate: num(it.tax_rate),
        line_total:
          it.line_total === "" || it.line_total == null ? null : num(it.line_total),
      }))
    );
    if (itemsErr) {
      if (oldItems && oldItems.length > 0) await sb.from("purchase_bill_items").insert(oldItems);
      return NextResponse.json({ error: itemsErr.message }, { status: 500 });
    }
    const mappingWarning = await upsertMappings(gate.vendorId, items);

    // optional: a (new) original file -> upload to Drive and update the drive fields
    let driveError = "";
    if (file) {
      const up = await uploadOriginal({
        filename: file.name,
        mimeType: file.mimeType,
        base64: file.base64,
        costCenter: bill.cost_center,
        vendorName: bill.vendor_name,
        invoiceNumber: bill.invoice_number,
      });
      const patch = up.ok
        ? {
            drive_status: "uploaded",
            drive_file_id: up.fileId,
            drive_file_link: up.link,
            drive_path: up.path,
            drive_error: null,
          }
        : {
            drive_status: up.reason === "not_configured" ? "not_configured" : "failed",
            drive_error: up.error || "Google Drive is not configured yet",
          };
      await sb.from("purchase_bills").update(patch).eq("id", id);
      driveError = patch.drive_error || "";
    }

    const { data: final } = await sb.from("purchase_bills").select("*").eq("id", id).single();
    return NextResponse.json({
      bill: final,
      warning: [driveError, mappingWarning].filter(Boolean).join(" | "),
    });
  } catch (err) {
    console.error("purchase-bills update failed:", err);
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}

export async function PATCH(request) {
  const body = await request.json().catch(() => ({}));
  const { id, status } = body;
  if (!id || (status !== "draft" && status !== "approved")) {
    return NextResponse.json(
      { error: "id and status ('draft' | 'approved') are required" },
      { status: 400 }
    );
  }
  const { data, error } = await sb
    .from("purchase_bills")
    .update({ status, approved_at: status === "approved" ? new Date().toISOString() : null })
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // approving also tries the Zoho sync once (best effort; the retry button re-runs it)
  let zoho = null;
  if (status === "approved") zoho = await syncBill(id);
  return NextResponse.json({ bill: data, zoho });
}

export async function DELETE(request) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id query param is required" }, { status: 400 });
  const { error } = await sb.from("purchase_bills").delete().eq("id", id); // items cascade
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
