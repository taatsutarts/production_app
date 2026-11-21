// app/api/purchase-bills/route.js
// Purchase Bills CRUD: GET list, POST save (original stored in Supabase Storage), PATCH approve
// (+ first Zoho sync attempt), DELETE remove. Service-key Supabase client (same
// pattern as /api/extract) — the tables are RLS-locked so only server routes touch them.
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { saveBillOriginal, relocateBillOriginal } from "@/lib/storage";
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
// Two optional switches (see supabase_migration_bill_tax_options.sql): tax_inclusive = the printed rates
// already contain GST (subtotal and tax are then split out of qty x rate); discount_before_tax = GST is
// charged on what is left after the discount. The page runs the same formula.
function computeTotals(bill, items) {
  const incl = bill.tax_inclusive === true;
  let subtotal = 0;
  let taxRaw = 0;
  for (const it of items) {
    const gross = num(it.quantity) * num(it.rate);
    const t = num(it.tax_rate) / 100;
    const base = incl ? gross / (1 + t) : gross;
    subtotal += base;
    taxRaw += base * t;
  }
  subtotal = r2(subtotal);
  const discount =
    bill.discount_type === "%"
      ? r2((subtotal * num(bill.discount_value)) / 100)
      : bill.discount_type === "Rs"
        ? r2(num(bill.discount_value))
        : 0;
  // GST charged on the extra charges (vehicle / freight / other) — e.g. "Vehicle expenses 450 + CGST/SGST"
  const chargesTax = (num(bill.other_charges) + num(bill.freight_charges)) * (num(bill.charges_tax_rate) / 100);
  const taxTotal = r2((bill.discount_before_tax === true && subtotal > 0 ? taxRaw * (1 - discount / subtotal) : taxRaw) + chargesTax);
  const computed = r2(
    subtotal - discount + taxTotal + num(bill.other_charges) + num(bill.freight_charges)
  );
  return { subtotal, tax_total: taxTotal, computed_total: computed };
}

// The Zoho bill-line fields (Account, ITC eligibility, Location) are switched on only once
// supabase_migration_zoho_bill_fields.sql has run AND the Zoho accounts are imported; until
// then bills save exactly as before and nothing here can fail.
async function zohoFieldsOn() {
  const cols = await sb.from("purchase_bill_items").select("account_id").limit(1);
  if (cols.error) return false;
  const acc = await sb.from("zoho_accounts").select("account_id", { count: "exact", head: true });
  return !acc.error && (acc.count || 0) > 0;
}
const ITC_VALUES = ["eligible", "ineligible"];

// GRN No. — internal tracking only (never sent to Zoho). Stored once supabase_migration_grn_no.sql
// has added the column; until then bills save exactly as before.
let flagsCache = { on: null, at: 0 };
async function flagsOn() {
  if (flagsCache.on === true || (flagsCache.on === false && Date.now() - flagsCache.at < 15000)) return flagsCache.on;
  const r = await sb.from("purchase_bills").select("tax_inclusive,discount_before_tax").limit(1);
  flagsCache = { on: !r.error, at: Date.now() };
  return flagsCache.on;
}
let chargeTaxCache = { on: null, at: 0 };
async function chargeTaxOn() {
  if (chargeTaxCache.on === true || (chargeTaxCache.on === false && Date.now() - chargeTaxCache.at < 15000)) return chargeTaxCache.on;
  const r = await sb.from("purchase_bills").select("charges_tax_rate").limit(1);
  chargeTaxCache = { on: !r.error, at: Date.now() };
  return chargeTaxCache.on;
}
let grnCache = { on: null, at: 0 };
async function grnOn() {
  if (grnCache.on === true || (grnCache.on === false && Date.now() - grnCache.at < 15000)) return grnCache.on;
  const r = await sb.from("purchase_bills").select("grn_no").limit(1);
  grnCache = { on: !r.error, at: Date.now() };
  return grnCache.on;
}
// The next GRN (0001, 0002, ...): the SQL counter once supabase_migration_grn_auto.sql has run, else the
// highest purely numeric GRN + 1 — the same numbers, so switching over is seamless.
async function nextGrn() {
  const r = await sb.rpc("next_grn");
  if (!r.error && r.data) return String(r.data);
  const { data } = await sb.from("purchase_bills").select("grn_no").not("grn_no", "is", null).limit(10000);
  let max = 0;
  for (const row of data || []) if (/^\d{1,9}$/.test(row.grn_no || "")) max = Math.max(max, Number(row.grn_no));
  return String(max + 1).padStart(4, "0");
}
const grnDuplicate = (e) => !!e && e.code === "23505" && /grn/i.test(e.message || "");
const GRN_DUP = { error: "duplicate_grn", message: "This GRN No. is already used by another bill." };

// the four Zoho fields of a saved line (the account name comes from the table, never the browser)
const zohoLineFields = (it, on, gate) =>
  on
    ? {
        account_id: it.account_id ? String(it.account_id) : null,
        account_name: (gate.accountName && gate.accountName.get(String(it.account_id))) || null,
        itc_eligibility: ITC_VALUES.includes(it.itc_eligibility) ? it.itc_eligibility : null,
        location: String(it.location || "").trim() || null,
      }
    : {};

// server-side gate used by POST (new bill) and PUT (edit): the vendor must exist and
// EVERY line must point at a real master item + brand. Returns lookup maps for the
// inserts (brand id -> name, so cost_center keeps working for CSV/reports).
async function validateSave(bill, items, zoho = false) {
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
  const accountIds = [...new Set(items.map((it) => it.account_id).filter(Boolean).map(String))];
  const [itemRes, brandRes, accountRes] = await Promise.all([
    itemIds.length
      ? sb.from("purchase_items").select("id").in("id", itemIds)
      : Promise.resolve({ data: [], error: null }),
    brandIds.length
      ? sb.from("brands").select("id,brand_name").in("id", brandIds)
      : Promise.resolve({ data: [], error: null }),
    zoho && accountIds.length
      ? sb.from("zoho_accounts").select("account_id,account_name").in("account_id", accountIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const refErr = itemRes.error || brandRes.error || accountRes.error;
  if (refErr) return { error: refErr.message };
  const itemOk = new Set((itemRes.data || []).map((r) => String(r.id)));
  const brandName = new Map((brandRes.data || []).map((r) => [String(r.id), r.brand_name]));
  const accountName = new Map((accountRes.data || []).map((r) => [String(r.account_id), r.account_name]));
  const issues = [];
  items.forEach((it, i) => {
    if (!it.item_id || !itemOk.has(String(it.item_id))) issues.push(`line ${i + 1}: standard item`);
    if (!it.brand_id || !brandName.has(String(it.brand_id))) issues.push(`line ${i + 1}: brand`);
    if (zoho) {
      if (!it.account_id || !accountName.has(String(it.account_id))) issues.push(`line ${i + 1}: account`);
      if (!ITC_VALUES.includes(it.itc_eligibility)) issues.push(`line ${i + 1}: ITC eligibility`);
    }
  });
  if (issues.length) {
    return { error: "Save blocked — resolve first: " + issues.slice(0, 6).join("; ") };
  }
  return { vendorId, brandName, accountName };
}

// remember the vendor's confirmed wording -> item (unique per vendor + normalized
// wording; last wording wins). A mapping failure must never lose a saved bill, so
// callers turn the return value into a warning, not an error.
//
// With the Zoho fields live it also LEARNS from every confirmed bill:
//   * an item that has no default yet gets this line's account / ITC / location as its default
//     (existing defaults are never overwritten by a single bill);
//   * this vendor's mapping stores only what DIFFERS from the item default (null = use the item's),
//     so the next bill from the same vendor with the same wording pre-fills exactly this way.
async function upsertMappings(vendorId, items, brandName = new Map(), zoho = false, accountName = new Map()) {
  const mapMap = new Map();
  for (const it of items) {
    const desc = String(it.description || "").trim();
    if (!desc || !it.item_id) continue;
    mapMap.set(norm(desc), {
      vendor_id: vendorId,
      vendor_item_name: desc,
      normalized_vendor_item_name: norm(desc),
      item_id: it.item_id,
      __line: it,
    });
  }
  const rows = [...mapMap.values()];
  if (!rows.length) return "";
  let learned = false;
  if (zoho) {
    const ids = [...new Set(rows.map((r) => r.item_id))];
    const { data: defs, error: dErr } = await sb
      .from("purchase_items")
      .select("id,brand_type,account_id,account_name,itc_eligibility,location")
      .in("id", ids);
    if (!dErr) {
      learned = true;
      const def = new Map((defs || []).map((d) => [String(d.id), { ...d }]));
      // 1. fill item defaults that are still empty (the first confirmed bill teaches the item)
      for (const r of rows) {
        const d = def.get(String(r.item_id));
        const l = r.__line;
        if (!d) continue;
        const fill = {};
        if (!d.account_id && l.account_id) {
          fill.account_id = String(l.account_id);
          fill.account_name = accountName.get(String(l.account_id)) || null;
        }
        if (!d.itc_eligibility && ITC_VALUES.includes(l.itc_eligibility)) fill.itc_eligibility = l.itc_eligibility;
        if (!d.location && String(l.location || "").trim()) fill.location = String(l.location).trim();
        if (Object.keys(fill).length) {
          const { error } = await sb.from("purchase_items").update(fill).eq("id", r.item_id);
          if (!error) Object.assign(d, fill);
        }
      }
      // 2. this vendor's exceptions to the (possibly just filled) item default
      for (const r of rows) {
        const d = def.get(String(r.item_id)) || {};
        const l = r.__line;
        const lineBrand = brandName.get(String(l.brand_id)) || null;
        const accId = l.account_id ? String(l.account_id) : null;
        r.account_id = accId && accId !== (d.account_id || null) ? accId : null;
        r.account_name = r.account_id ? accountName.get(accId) || null : null;
        r.itc_eligibility =
          ITC_VALUES.includes(l.itc_eligibility) && l.itc_eligibility !== (d.itc_eligibility || null)
            ? l.itc_eligibility
            : null;
        const loc = String(l.location || "").trim();
        r.location = loc && loc !== (d.location || null) ? loc : null;
        r.brand_type = lineBrand && lineBrand !== (d.brand_type || null) ? lineBrand : null;
      }
    }
  }
  // without the learned columns the mapping is saved exactly as before
  rows.forEach((r) => delete r.__line);
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
    // the invoice saved with this bill (if any), served by /api/purchase-bills/file
    const sp = String(bill.storage_path || "");
    const file = sp
      ? {
          url: "/api/purchase-bills/file?id=" + id,
          kind: /\.pdf$/i.test(sp) ? "pdf" : "image",
          name: sp.split("/").pop(),
        }
      : null;
    return NextResponse.json({ bill, items: items || [], file });
  }
  const { data, error } = await sb
    .from("purchase_bills")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ bills: data || [] }, { headers: { "Cache-Control": "no-store" } });
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
    const zoho = await zohoFieldsOn();
    const grn = await grnOn();
    const flags = await flagsOn();
    const chargeTax = await chargeTaxOn();
    const gate = await validateSave(bill, items, zoho);
    if (gate.error) return NextResponse.json({ error: gate.error }, { status: 400 });
    // GRN No.: what was typed, else the next automatic number
    const grnVal = grn ? await nextGrn() : null; // always automatic — a typed value is ignored

    // 1. save the bill first — an external failure later must never lose the invoice
    const { data: saved, error: billErr } = await sb
      .from("purchase_bills")
      .insert({
        vendor_id: gate.vendorId,
        vendor_name: bill.vendor_name || null,
        vendor_gstin: bill.vendor_gstin || null,
        cost_center: bill.cost_center || null,
        invoice_number: bill.invoice_number || null,
        ...(grn ? { grn_no: grnVal } : {}),
        ...(flags ? { tax_inclusive: bill.tax_inclusive === true, discount_before_tax: bill.discount_before_tax === true } : {}),
        ...(chargeTax ? { charges_tax_rate: num(bill.charges_tax_rate) } : {}),
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
      })
      .select()
      .single();
    if (grnDuplicate(billErr)) return NextResponse.json(GRN_DUP, { status: 409 });
    if (billErr) return NextResponse.json({ error: billErr.message }, { status: 500 });

    // 2. the line items (roll the bill back if this fails — no empty bills)
    const { error: itemsErr } = await sb.from("purchase_bill_items").insert(
      items.map((it, i) => ({
        bill_id: saved.id,
        position: i,
        description: it.description || null,
        // cost_center stays filled (= the line's brand name) for CSV/report compatibility
        cost_center: gate.brandName.get(String(it.brand_id)) || it.cost_center || null,
        ...zohoLineFields(it, zoho, gate),
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
    const mappingWarning = await upsertMappings(gate.vendorId, items, gate.brandName, zoho, gate.accountName);

    // 3. keep the original where the Zoho sync can attach it later (Supabase
    //    Storage, private bucket "purchase-bills" — lib/storage.js). Best effort:
    //    a storage failure never loses the bill; the sync records the attachment
    //    warning instead.
    let storageError = "";
    if (file) {
      const st = await saveBillOriginal({ file, bill: saved });
      if (st.ok) {
        const { error: spErr } = await sb
          .from("purchase_bills")
          .update({ storage_path: st.path })
          .eq("id", saved.id);
        if (spErr) {
          storageError = "the invoice original was stored but the bill could not record it: " + spErr.message;
        }
      } else {
        storageError = "the invoice original could not be stored: " + st.error;
      }
    }

    const { data: final } = await sb.from("purchase_bills").select("*").eq("id", saved.id).single();
    return NextResponse.json({
      bill: final,
      warning: [storageError, mappingWarning].filter(Boolean).join(" | "),
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
    const zoho = await zohoFieldsOn();
    const grn = await grnOn();
    const flags = await flagsOn();
    const chargeTax = await chargeTaxOn();
    const gate = await validateSave(bill, items, zoho);
    if (gate.error) return NextResponse.json({ error: gate.error }, { status: 400 });
    // GRN No.: what was typed, else the one this bill already has, else the next automatic number
    const grnVal = grn ? existing.grn_no || (await nextGrn()) : null; // keeps its number; old bills without one get the next

    const { error: upErr } = await sb
      .from("purchase_bills")
      .update({
        vendor_id: gate.vendorId,
        vendor_name: bill.vendor_name || null,
        vendor_gstin: bill.vendor_gstin || null,
        cost_center: bill.cost_center || null,
        invoice_number: bill.invoice_number || null,
        ...(grn ? { grn_no: grnVal } : {}),
        ...(flags ? { tax_inclusive: bill.tax_inclusive === true, discount_before_tax: bill.discount_before_tax === true } : {}),
        ...(chargeTax ? { charges_tax_rate: num(bill.charges_tax_rate) } : {}),
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
    if (grnDuplicate(upErr)) return NextResponse.json(GRN_DUP, { status: 409 });
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
        ...zohoLineFields(it, zoho, gate),
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
    const mappingWarning = await upsertMappings(gate.vendorId, items, gate.brandName, zoho, gate.accountName);

    // optional: a (new) original file -> store it (the stored copy is what the Zoho sync
    // attaches and what the Edit screen shows; upsert:true replaces an older copy)
    // Files live at <year>/<Month>/<Vendor>/<Invoice>.<ext>, so an edit of the
    // vendor / invoice number / date without a new file MOVES the stored copy.
    let storageError = "";
    const placed = {
      vendor_name: bill.vendor_name || null,
      invoice_number: bill.invoice_number || null,
      invoice_date: bill.invoice_date || null,
    };
    if (!file && existing.storage_path) {
      const mv = await relocateBillOriginal(existing.storage_path, placed);
      if (!mv.ok) {
        storageError = "the invoice original could not be moved to its new folder: " + mv.error;
      } else if (mv.moved) {
        const { error: spErr } = await sb
          .from("purchase_bills")
          .update({ storage_path: mv.path })
          .eq("id", id);
        if (spErr) storageError = "the invoice original was moved but the bill could not record it: " + spErr.message;
      }
    }
    if (file) {
      const st = await saveBillOriginal({ file, bill: placed, oldPath: existing.storage_path });
      if (st.ok) {
        const { error: spErr } = await sb
          .from("purchase_bills")
          .update({ storage_path: st.path })
          .eq("id", id);
        if (spErr) {
          storageError = "the invoice original was stored but the bill could not record it: " + spErr.message;
        }
      } else {
        storageError = "the invoice original could not be stored: " + st.error;
      }
    }

    const { data: final } = await sb.from("purchase_bills").select("*").eq("id", id).single();
    return NextResponse.json({
      bill: final,
      warning: [storageError, mappingWarning].filter(Boolean).join(" | "),
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
