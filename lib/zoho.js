// app/lib/zoho.js
// Zoho Books integration for approved Purchase Bills.
//
// STATUS: LIVE-TESTED against the real org (2026-11-14): token refresh, vendor match
// (contact_name/search_text filters), tax list, chart of accounts, and bill creation.
// Setup below is still the reference for a fresh machine.
//
// SETUP (one time):
//   1. Zoho Books -> note the Organization ID (click the org name, top right ->
//      "Manage Organizations" -> the ID is listed there)
//   2. api-console.zoho.com -> your org -> "Self Client" -> Generate Code with scope
//      "ZohoBooks.fullaccess.all" (or the narrower bills/contacts scopes) and an expiry
//   3. Exchange that grant code once for a refresh token (browser or curl):
//        POST https://accounts.zoho.in/oauth/v2/token
//          grant_type=authorization_code&client_id=...&client_secret=...&code=...
//      (use the .com domain instead if your Zoho account is not on the India DC)
//   4. Add to .env.local and restart the dev server:
//        ZOHO_BOOKS_ORG_ID=...
//        ZOHO_BOOKS_CLIENT_ID=...
//        ZOHO_BOOKS_CLIENT_SECRET=...
//        ZOHO_BOOKS_REFRESH_TOKEN=...
//      India data centre is the default; for another DC also set:
//        ZOHO_ACCOUNTS_BASE=https://accounts.zoho.com
//        ZOHO_BOOKS_API_BASE=https://www.zohoapis.com/books/v3
//
// What syncBill(billId) does:
//   - refuses unless the bill is approved and not already synced (duplicate prevention)
//   - matches the vendor by name in Zoho (it must already exist there — we never create vendors)
//   - matches line items to Zoho items by name; no exact match -> ad-hoc name+rate line
//   - every line is charged to a purchase expense account (ZOHO_BOOKS_EXPENSE_ACCOUNT
//     env override, default "Cost of Goods Sold") and gets the matching GST/IGST tax
//   - creates the bill (freight -> shipping_charge, other charges -> adjustment,
//     discount -> the bill's discount field)
//   - if Zoho already has a bill with the same number + vendor (it was entered manually
//     before), links to it when the totals match, or fails with a clear explanation
//   - attaches the original file from Supabase Storage (best effort — failure does not fail the sync)
//   - saves zoho_bill_id / zoho_sync_status back to Supabase
// Every failure is recorded on the bill (zoho_sync_status 'failed' + message);
// nothing here throws — callers always get a plain result object.

import { createClient } from "@supabase/supabase-js";
import { readBillOriginal } from "./storage";
import dns from "dns";

// IPv6-first DNS hangs on this machine (broken IPv6 routing) — force IPv4-first.
dns.setDefaultResultOrder("ipv4first");

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

let cachedToken = null; // { value, expiresAt } — access tokens last ~1 h

export function zohoConfigured() {
  return !!(
    process.env.ZOHO_BOOKS_ORG_ID &&
    process.env.ZOHO_BOOKS_CLIENT_ID &&
    process.env.ZOHO_BOOKS_CLIENT_SECRET &&
    process.env.ZOHO_BOOKS_REFRESH_TOKEN
  );
}

async function accessToken() {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;
  const base = process.env.ZOHO_ACCOUNTS_BASE || "https://accounts.zoho.in";
  const res = await fetch(base + "/oauth/v2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: process.env.ZOHO_BOOKS_REFRESH_TOKEN,
      client_id: process.env.ZOHO_BOOKS_CLIENT_ID,
      client_secret: process.env.ZOHO_BOOKS_CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.access_token) {
    throw new Error("Zoho token refresh failed: " + JSON.stringify(data).slice(0, 200));
  }
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + ((Number(data.expires_in) || 3600) - 120) * 1000,
  };
  return cachedToken.value;
}

// One Zoho Books API call. Adds the org id; throws a readable error on failure.
async function api(path, options = {}) {
  const t = await accessToken();
  const base = process.env.ZOHO_BOOKS_API_BASE || "https://www.zohoapis.in/books/v3";
  const url =
    base + path + (path.includes("?") ? "&" : "?") + "organization_id=" + process.env.ZOHO_BOOKS_ORG_ID;
  const res = await fetch(url, {
    ...options,
    headers: { Authorization: "Zoho-oauthtoken " + t, ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  // Zoho answers { code: 0 } on success; anything else is an error.
  // The numeric Zoho code is attached to the error so callers can react to specific codes.
  if (!res.ok || (data.code !== undefined && data.code !== 0)) {
    const err = new Error(
      "Zoho " + path.split("?")[0] + " failed (" + (data.code ?? res.status) + "): " +
        (data.message || res.statusText || "unknown error")
    );
    err.code = data.code;
    throw err;
  }
  return data;
}

// exact (case-insensitive) name match preferred; a single search hit is accepted too.
// NOTE (verified against the live API 2026-11-14): combining contact_type=vendor with
// search_text makes Zoho IGNORE the search and return the whole vendor list (so the
// vendor was "not found" even though it existed), and contact_name_starts_with is
// ignored too. The reliable filters are contact_name=<name> and search_text=<name>
// WITHOUT the type filter. Returns the whole contact (id + gst_no etc.).
async function findVendor(name) {
  const wanted = String(name || "").trim().toLowerCase();
  if (!wanted) throw new Error("The bill has no vendor name to match in Zoho Books.");

  let candidate = null;
  for (const path of [
    "/contacts?contact_name=" + encodeURIComponent(name.trim()),
    "/contacts?search_text=" + encodeURIComponent(name.trim()),
  ]) {
    const d = await api(path);
    const hits = d.contacts || [];
    const exact = hits.find((c) => (c.contact_name || "").trim().toLowerCase() === wanted);
    if (exact) { candidate = exact; break; }
    if (hits.length === 1) { candidate = hits[0]; break; }
    const vendors = hits.filter((c) => c.contact_type !== "customer");
    if (vendors.length === 1) { candidate = vendors[0]; break; }
  }

  if (!candidate) {
    throw new Error(
      'Vendor "' + name + '" not found in Zoho Books (searched contact_name and search_text). Create it there (or rename it) and retry.'
    );
  }
  if (candidate.contact_type === "customer") {
    throw new Error(
      '"' + (candidate.contact_name || name) + '" exists in Zoho Books but is not marked as a Vendor (it is only a Customer). Open it in Zoho Books, tick Vendor, and retry.'
    );
  }
  return candidate;
}

// ---- cached Zoho master data (chart of accounts + taxes rarely change) ----
let cachedAccounts = null; // [{ account_id, account_name, account_type }]
let cachedTaxes = null;    // [{ tax_id, tax_name, tax_percentage }]
let cachedOrgStateCode = null;

async function chartOfAccounts() {
  if (cachedAccounts) return cachedAccounts;
  const all = [];
  for (let page = 1; page <= 3; page++) {
    const d = await api("/chartofaccounts?per_page=200&page=" + page);
    all.push(...(d.chartofaccounts || [])); // NOTE: the key is "chartofaccounts", no underscore
    if (!d.page_context || !d.page_context.has_more_page) break;
  }
  cachedAccounts = all;
  return all;
}

// Zoho REQUIRES an account_id on every bill line. Pick the purchase account:
// 1) exact name from ZOHO_BOOKS_EXPENSE_ACCOUNT (set in .env.local if you want another)
// 2) "Cost of Goods Sold"  3) "Materials"  4) "Merchandise"  5) any cost_of_goods_sold
async function expenseAccountId() {
  const wanted = (process.env.ZOHO_BOOKS_EXPENSE_ACCOUNT || "").trim().toLowerCase();
  const accounts = await chartOfAccounts();
  const isExpense = (a) => /expense|cost_of_goods/.test(a.account_type || "");
  const pick = (test) => accounts.find((a) => isExpense(a) && test(a));
  const acc =
    (wanted && pick((a) => a.account_name.trim().toLowerCase() === wanted)) ||
    pick((a) => /cost of goods sold/i.test(a.account_name)) ||
    pick((a) => /^materials$/i.test(a.account_name)) ||
    pick((a) => /merchandise/i.test(a.account_name)) ||
    pick((a) => a.account_type === "cost_of_goods_sold");
  if (!acc) {
    throw new Error(
      'No expense account found in Zoho Books to charge the bill lines to. Create one (e.g. "Cost of Goods Sold") or set ZOHO_BOOKS_EXPENSE_ACCOUNT in .env.local to the exact account name, then retry.'
    );
  }
  return acc.account_id;
}

async function taxList() {
  if (cachedTaxes) return cachedTaxes;
  const d = await api("/settings/taxes");
  cachedTaxes = d.taxes || [];
  return cachedTaxes;
}

// GST vs IGST: same state (first 2 GSTIN digits) -> GST, different states -> IGST
async function orgStateCode() {
  if (cachedOrgStateCode !== null) return cachedOrgStateCode;
  try {
    const d = await api("/organizations");
    const mine = (d.organizations || []).find(
      (o) => String(o.organization_id) === String(process.env.ZOHO_BOOKS_ORG_ID)
    );
    cachedOrgStateCode = mine && mine.gstin ? String(mine.gstin).slice(0, 2) : "";
  } catch {
    cachedOrgStateCode = "";
  }
  return cachedOrgStateCode;
}

// tax_id for a line: match the GST % printed on that bill line (null -> no tax)
async function taxId(rate, vendorGstin) {
  if (rate === null || rate === undefined || rate === "") return null;
  const same = (await taxList()).filter((t) => Number(t.tax_percentage) === Number(rate));
  if (!same.length) return null;
  const vendorState = vendorGstin ? String(vendorGstin).trim().slice(0, 2) : "";
  const orgState = await orgStateCode();
  const inter = vendorState && orgState && vendorState !== orgState;
  return (same.find((t) => (inter ? /^IGST/i : /^GST/i).test(t.tax_name)) || same[0]).tax_id;
}

// best effort: exact item match by name; null -> the line is sent as ad-hoc name+rate
async function findItemId(name) {
  if (!name) return null;
  try {
    const d = await api("/items?search_text=" + encodeURIComponent(name));
    const list = d.items || [];
    const exact = list.find((i) => (i.name || "").toLowerCase() === name.toLowerCase());
    return exact ? exact.item_id : null;
  } catch {
    return null;
  }
}

// Zoho refuses a second bill with the same number + vendor (error 13011) — e.g. the
// invoice was already entered in Zoho manually. Find that existing bill so we can
// link to it instead of failing with a cryptic error.
async function findExistingZohoBill(bill, vendor) {
  const d = await api("/bills?bill_number=" + encodeURIComponent(bill.invoice_number || ""));
  const hits = (d.bills || []).filter((b) => String(b.vendor_id) === String(vendor.contact_id));
  return hits[0] || null;
}

// Reporting-tag options (Location, Brand) with the option ids Zoho needs, from the zoho_tag_options
// table (imported from Zoho). The Brand tag is currently INACTIVE in Zoho, so it is only sent if
// someone reactivates it there and the table is refreshed (tag_active = true).
let tagCache = null;
async function tagOptions() {
  if (tagCache && Date.now() < tagCache.expires) return tagCache.rows;
  const { data, error } = await sb
    .from("zoho_tag_options")
    .select("tag_id,tag_name,option_id,option_name,tag_active,option_active");
  tagCache = { rows: error ? [] : data || [], expires: Date.now() + 60000 };
  return tagCache.rows;
}
async function lineTags(it) {
  const rows = await tagOptions();
  const find = (tag, name) =>
    name
      ? rows.find(
          (r) =>
            r.tag_name === tag &&
            r.tag_active &&
            r.option_active &&
            String(r.option_name).toLowerCase() === String(name).toLowerCase()
        )
      : null;
  const tags = [];
  const loc = find("Location", it.location);
  if (loc) tags.push({ tag_id: loc.tag_id, tag_option_id: loc.option_id });
  const brand = find("Brand", it.cost_center); // a saved line's cost_center holds its brand name
  if (brand) tags.push({ tag_id: brand.tag_id, tag_option_id: brand.option_id });
  return tags;
}

async function createZohoBill(bill, items) {
  const vendor = await findVendor(bill.vendor_name);
  const accountId = await expenseAccountId();

  const line_items = [];
  for (const it of items) {
    const line = {
      name: it.description || "Item",
      rate: Number(it.rate) || 0,
      quantity: Number(it.quantity) || 0,
      // the line's own account (chosen on the review screen); the default only when it has none
      account_id: it.account_id || accountId, // Zoho rejects bill lines without an expense account
    };
    // The app (and Zoho's CSV export) say "ineligible"; Zoho's API stores that as "ineligible_others"
    // and rejects "ineligible" ("Invalid value passed for itc_eligibility") — verified 2026-11-20 on
    // the live org (older Vaibhav bills carry ineligible_others; "eligible" is the same on both sides).
    if (it.itc_eligibility) line.itc_eligibility = it.itc_eligibility === "ineligible" ? "ineligible_others" : it.itc_eligibility;
    const tags = await lineTags(it);
    if (tags.length) line.tags = tags;
    if (it.unit) line.unit = it.unit;
    const tid = await taxId(it.tax_rate, vendor.gst_no);
    if (tid) line.tax_id = tid;
    const itemId = await findItemId(it.description);
    if (itemId) line.item_id = itemId;
    line_items.push(line);
  }

  const body = {
    vendor_id: vendor.contact_id,
    bill_number: bill.invoice_number || undefined,
    date: bill.invoice_date || new Date().toISOString().slice(0, 10),
    line_items,
    // extra charges go to the bill's extra-charge fields (best effort mapping)
    shipping_charge: Number(bill.freight_charges) || 0,
    adjustment: Number(bill.other_charges) || 0,
  };
  if (bill.due_date) body.due_date = bill.due_date;
  if (bill.discount_type === "%" && Number(bill.discount_value) > 0)
    body.discount = Number(bill.discount_value) + "%";
  if (bill.discount_type === "Rs" && Number(bill.discount_value) > 0)
    body.discount = Number(bill.discount_value);

  let d;
  let note = "";
  const send = (b) =>
    api("/bills", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
  try {
    try {
      d = await send(body);
    } catch (e) {
      const m = String(e.message || e);
      if (e.code === 13011 || !/tag|itc|eligib/i.test(m)) throw e;
      // Zoho does not accept tags / ITC on this account: create the bill without them and say so
      const plain = {
        ...body,
        line_items: body.line_items.map(({ tags, itc_eligibility, ...rest }) => rest),
      };
      d = await send(plain);
      note = "bill created without tags/ITC (Zoho said: " + m.slice(0, 160) + ")";
    }
  } catch (e) {
    if (e.code !== 13011) throw e; // not a duplicate-number problem — real failure
    // 13011: Zoho already has a bill with this number for this vendor.
    const existing = await findExistingZohoBill(bill, vendor);
    if (!existing) throw e; // can't locate it — surface the original error
    const appTotal = Number(bill.grand_total != null ? bill.grand_total : bill.computed_total) || 0;
    const zohoTotal = Number(existing.total) || 0;
    if (Math.abs(appTotal - zohoTotal) > 1) {
      throw new Error(
        "This bill is already in Zoho Books (" + existing.bill_number + ", dated " + existing.date +
          ", total \u20B9" + zohoTotal + ") but with a different amount than this app's bill (\u20B9" + appTotal +
          "). Check it in Zoho Books: fix whichever entry is wrong, or delete the Zoho bill if it was a duplicate entry, then retry."
      );
    }
    // same number, same vendor, matching total -> link to the existing Zoho bill
    return { ...existing, __adopted: true };
  }
  return note ? { ...d.bill, __note: note } : d.bill;
}

// download the original from Supabase Storage (the image/PDF uploaded with the
// draft — see lib/storage.js) and attach it to the Zoho bill under its real name.
// NOTE (verified live 2026-11-17): bills use the SINGULAR /attachment endpoint —
// /attachments (plural) answers Zoho code 5 "Invalid URL Passed".
async function attachStoredOriginal(zohoBillId, storagePath) {
  const f = await readBillOriginal(storagePath);
  if (!f.ok) throw new Error("could not read the stored original: " + f.error);
  const fd = new FormData();
  fd.append("attachment", new Blob([f.bytes], { type: f.contentType }), f.filename);
  await api("/bills/" + zohoBillId + "/attachment", { method: "POST", body: fd });
}

async function saveStatus(billId, fields) {
  await sb.from("purchase_bills").update(fields).eq("id", billId);
}

// Sync one approved bill to Zoho. Never throws; returns:
//   { ok: true,  zoho_bill_id, error? }          (error = attachment warning, if any)
//   { ok: false, reason: "not_configured" | "not_approved" | "already_synced" |
//                        "not_found" | "failed", error? }
export async function syncBill(billId) {
  if (!billId) return { ok: false, reason: "missing_id" };

  const { data: bill } = await sb.from("purchase_bills").select("*").eq("id", billId).maybeSingle();
  if (!bill) return { ok: false, reason: "not_found" };

  if (!zohoConfigured()) {
    await saveStatus(billId, { zoho_sync_status: "not_configured" });
    return { ok: false, reason: "not_configured" };
  }
  // duplicate prevention: never create the same bill twice
  if (bill.zoho_sync_status === "synced" || bill.zoho_bill_id) {
    return { ok: false, reason: "already_synced", zoho_bill_id: bill.zoho_bill_id };
  }
  if (bill.status !== "approved") return { ok: false, reason: "not_approved" };

  const { data: items } = await sb
    .from("purchase_bill_items")
    .select("*")
    .eq("bill_id", billId)
    .order("position");

  try {
    const zohoBill = await createZohoBill(bill, items || []);
    const adopted = !!zohoBill.__adopted; // already existed in Zoho — we just linked to it
    const patch = {
      zoho_sync_status: "synced",
      zoho_bill_id: String(zohoBill.bill_id),
      zoho_sync_error: adopted
        ? "linked to an existing Zoho bill (same number + vendor, matching total)"
        : zohoBill.__note || null,
    };
    try {
      // don't attach a file to a bill we didn't create (adopted) — it isn't ours to modify
      if (!adopted) {
        // the Supabase-stored original (the file uploaded with the draft)
        if (bill.storage_path) await attachStoredOriginal(patch.zoho_bill_id, bill.storage_path);
      }
    } catch (e) {
      // the bill exists in Zoho; keep it synced but record the attachment problem
      patch.zoho_sync_error = "bill created, attachment failed: " + String(e.message || e);
    }
    await saveStatus(billId, patch);
    return { ok: true, zoho_bill_id: patch.zoho_bill_id, error: patch.zoho_sync_error || "" };
  } catch (e) {
    const msg = String(e.message || e);
    await saveStatus(billId, { zoho_sync_status: "failed", zoho_sync_error: msg.slice(0, 500) });
    return { ok: false, reason: "failed", error: msg };
  }
}
