// scripts/import-zoho-history.mjs
// Teaches the Purchase Bills tables what your Zoho bill history already knows:
//   vendors (+ their Zoho ids), Zoho accounts / tag options, and per item / per vendor+item
//   defaults for Account, ITC eligibility, Location and Brand — so a scanned bill is pre-filled.
//
//   node scripts/import-zoho-history.mjs            dry run: reads files, reads the DB, WRITES NOTHING
//   node scripts/import-zoho-history.mjs --apply    writes (run supabase_migration_zoho_bill_fields.sql first)
//
// Inputs (all in the project root, all gitignored — they are real business data):
//   Bill (2).csv                    Zoho bills export (one row per bill line)
//   zoho_vendors_all.json           ALL vendor contacts (the first export only held 200 of 6,717)
//   zoho_chartofaccounts_data.json  chart of accounts
//   zoho_tag_options.json           Location / Brand tag options with option ids
// Needs .env.local (SUPABASE_URL + SUPABASE_SERVICE_KEY). Re-runnable: it matches what already exists.
//
// What it does NOT do: it never touches Zoho; it never deletes anything; fuzzy name matches are never
// applied automatically (only exact normalised names link to an existing item).
import dns from "dns";
dns.setDefaultResultOrder("ipv4first");
import fs from "fs";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; })
);
const sb = createClient(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

/* ---------------------------------- helpers ---------------------------------- */
function parseCSV(text) {
  const rows = []; let row = [], f = "", q = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n") { row.push(f.replace(/\r$/, "")); rows.push(row); row = []; f = ""; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const head = rows.shift();
  return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])));
}
const readJSON = (f) => JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, ""));
// same normaliser as lib/purchaseMatch.js (keeps size / grade / pack words that tell products apart)
const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9&.\-/% ]+/g, " ").replace(/\s+/g, " ").trim();
const stripName = (s) => norm(String(s).replace(/^#_#\s*/, "").replace(/\s*-\s*Taatsu$/i, ""));
const title = (s) => (s && s === s.toUpperCase() ? s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : s);
const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const mostCommon = (vals) => { const m = new Map(); vals.forEach((v) => m.set(v, (m.get(v) || 0) + 1)); return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]; };

// Goods = what the app is for: ingredients and packaging. Rent, salaries, commissions, taxes, etc. are skipped.
const GOODS_ACCOUNT = /^(Taatsu-Cost of Goods Sold|Cost of Goods Sold|Packaging Expenses|Taatsu-Packaging Services|Raw Materials And Consumables)$/i;
// charge lines are handled by the bill's freight / other-charges fields, not as items
const CHARGE_LINE = /^(delivery|freight|round|discount|shipping|transport|courier|cartage|loading|packing charge|handling)/i;

// Brand: the explicit Brand tag when the line has one, else what the account / location say
// (Zoho left the Brand tag blank on ~70% of lines, though the account makes the brand obvious).
function brandOf(r) {
  if (r["Brand"]) return r["Brand"];
  const a = r["Account"], loc = r["Location"];
  if (/^taatsu/i.test(a)) return "Taatsu";
  if (/gourmaison|\bGM\b/i.test(a)) return "Gourmaison";
  if (loc === "GM") return "Gourmaison";
  if (loc === "CK - TTE") return "Taatsu";
  return "";
}
const brandType = (set) => (set.size === 0 ? null : set.size === 1 ? [...set][0] : "Both");

/* ---------------------------------- load inputs ---------------------------------- */
for (const f of ["Bill (2).csv", "zoho_vendors_all.json", "zoho_chartofaccounts_data.json", "zoho_tag_options.json"])
  if (!fs.existsSync(f)) { console.error("Missing input file: " + f); process.exit(1); }
const rows = parseCSV(fs.readFileSync("Bill (2).csv", "utf8")).filter((r) => r["Bill Status"] !== "Void");
const zohoVendors = readJSON("zoho_vendors_all.json").contacts;
const coa = readJSON("zoho_chartofaccounts_data.json").chartofaccounts;
const tagDetails = readJSON("zoho_tag_options.json").map((d) => d.reporting_tag || d.tag);

const acctByName = new Map(coa.map((a) => [a.account_name.toLowerCase(), a]));
const acct = (name) => acctByName.get(String(name).toLowerCase());

/* ---------------------------------- vendors ---------------------------------- */
const zByName = new Map(), zByGst = new Map();
for (const c of zohoVendors) {
  for (const n of new Set([c.contact_name, c.vendor_name, c.company_name].filter(Boolean))) { const k = norm(n); (zByName.get(k) || zByName.set(k, []).get(k)).push(c); }
  if (c.gst_no) (zByGst.get(c.gst_no) || zByGst.set(c.gst_no, []).get(c.gst_no)).push(c);
}
const uniq = (a) => [...new Map(a.map((c) => [c.contact_id, c])).values()];
const csvVendors = new Map(); // norm name -> { name, gst:Set, rows }
for (const r of rows) { const k = norm(r["Vendor Name"]); const v = csvVendors.get(k) || csvVendors.set(k, { name: r["Vendor Name"], gst: new Set(), lines: 0 }).get(k); v.lines++; if (r["GST Identification Number (GSTIN)"]) v.gst.add(r["GST Identification Number (GSTIN)"]); }
const vendorMatch = new Map(); // norm csv name -> zoho contact
const skippedVendors = [];
for (const [k, v] of csvVendors) {
  let m = uniq(zByName.get(k) || []);
  if (m.length > 1) { const g = m.filter((c) => v.gst.has(c.gst_no)); if (g.length === 1) m = g; }
  if (m.length === 1) vendorMatch.set(k, m[0]);
  else skippedVendors.push({ name: v.name, lines: v.lines, why: m.length ? `${m.length} Zoho contacts share this name` : "not found in Zoho vendors" });
}

/* ---------------------------------- items + defaults from history ---------------------------------- */
const goods = rows.filter((r) => GOODS_ACCOUNT.test(r["Account"]) && !CHARGE_LINE.test(r["Description"]) && norm(r["Description"]));
const combo = (r) => ({ account: r["Account"], itc: r["ITC Eligibility"] || "", location: r["Location"] || "", brand: brandOf(r) });
const comboKey = (c) => [c.account, c.itc, c.location, c.brand].join("|");
// most frequent joint combination; ties -> the most recent bill
function modeCombo(lines) {
  const m = new Map();
  for (const r of lines) { const c = combo(r), k = comboKey(c); const e = m.get(k) || { c, n: 0, last: "" }; e.n++; if (r["Bill Date"] > e.last) e.last = r["Bill Date"]; m.set(k, e); }
  return [...m.values()].sort((a, b) => b.n - a.n || (b.last > a.last ? 1 : -1))[0].c;
}
const byItem = new Map(); // norm description -> lines
for (const r of goods) { const k = norm(r["Description"]); (byItem.get(k) || byItem.set(k, []).get(k)).push(r); }

const pi = await readAll("purchase_items", "id,item_name,zoho_item_id,brand_type");
const piByName = new Map(); for (const p of pi) { piByName.set(norm(p.item_name), p); if (!piByName.has(stripName(p.item_name))) piByName.set(stripName(p.item_name), p); }

const items = []; // one per distinct goods description
for (const [k, lines] of byItem) {
  const def = modeCombo(lines);
  const a = acct(def.account);
  const brands = new Set(lines.map(brandOf).filter(Boolean));
  const existing = piByName.get(k) || piByName.get(stripName(k));
  items.push({
    key: k, display: title(mostCommon(lines.map((r) => r["Description"]))), lines: lines.length, def,
    account_id: a?.account_id || null, brand_type: brandType(brands), existing: existing || null,
  });
}

/* ---------------------------------- vendor + item overrides ---------------------------------- */
const itemByKey = new Map(items.map((i) => [i.key, i]));
const pairs = new Map(); // vendor norm || item norm -> lines
for (const r of goods) { const vk = norm(r["Vendor Name"]); if (!vendorMatch.has(vk)) continue; const k = vk + "||" + norm(r["Description"]); (pairs.get(k) || pairs.set(k, []).get(k)).push(r); }
const mappings = [];
for (const [k, lines] of pairs) {
  const [vk, ik] = k.split("||"); const item = itemByKey.get(ik); const c = modeCombo(lines);
  const pairBrand = brandType(new Set(lines.map(brandOf).filter(Boolean)));
  const ov = {};
  if (c.account !== item.def.account) { ov.account_name = c.account; ov.account_id = acct(c.account)?.account_id || null; }
  if (c.itc && c.itc !== item.def.itc) ov.itc_eligibility = c.itc;
  if (c.location && c.location !== item.def.location) ov.location = c.location;
  if (pairBrand && pairBrand !== item.brand_type) ov.brand_type = pairBrand;
  mappings.push({ vendorKey: vk, itemKey: ik, wording: mostCommon(lines.map((r) => r["Description"])), lines: lines.length, ov });
}

/* ---------------------------------- tag options ---------------------------------- */
const tagRows = [];
for (const t of tagDetails) for (const o of t.tag_options || [])
  tagRows.push({ tag_id: String(t.tag_id), tag_name: t.tag_name, option_id: String(o.tag_option_id), option_name: o.tag_option_name, tag_active: t.status === "active" || t.is_active === true, option_active: o.is_active !== false });
const accountRows = coa.map((a) => ({ account_id: String(a.account_id), account_name: a.account_name, account_code: a.account_code || null, account_type: a.account_type || null, is_active: a.is_active !== false }));

/* ---------------------------------- report ---------------------------------- */
const dbVendors = await readAll("vendors", "id,vendor_name,gstin,zoho_vendor_id");
const dbV = new Map(); for (const v of dbVendors) { dbV.set(norm(v.vendor_name), v); }
// existing Supabase vendors without a Zoho id: link by exact name, else by GSTIN (only when unambiguous)
const dbLinks = new Map(); // our vendor id -> zoho contact
for (const v of dbVendors) {
  if (v.zoho_vendor_id) continue;
  let m = uniq(zByName.get(norm(v.vendor_name)) || []);
  if (m.length !== 1 && v.gstin) m = uniq(zByGst.get(v.gstin) || []);
  if (m.length === 1) dbLinks.set(v.id, m[0]);
}
const newItems = items.filter((i) => !i.existing), linkedItems = items.filter((i) => i.existing);
const ovCount = mappings.filter((m) => Object.keys(m.ov).length).length;
console.log(APPLY ? "=== APPLY MODE ===" : "=== DRY RUN (nothing is written) ===");
console.log(`CSV: ${rows.length} bill lines (void excluded) | ${csvVendors.size} vendors | goods lines: ${goods.length}`);
console.log(`Vendors: ${vendorMatch.size} matched to Zoho (will be added/linked) | ${skippedVendors.length} skipped`);
for (const s of skippedVendors) console.log(`   skipped: ${s.name} (${s.lines} lines) — ${s.why}`);
console.log(`Existing Supabase vendors: ${dbVendors.length} -> ${dbLinks.size} will get their Zoho id (by name / GSTIN); ${dbVendors.length - dbLinks.size - dbVendors.filter((v) => v.zoho_vendor_id).length} left unlinked: ${dbVendors.filter((v) => !v.zoho_vendor_id && !dbLinks.has(v.id)).map((v) => v.vendor_name).join(', ') || 'none'}`);
console.log(`Items: ${items.length} distinct goods descriptions | ${linkedItems.length} link to an existing purchase item | ${newItems.length} will be created`);
console.log(`Vendor+item mappings: ${mappings.length} | with a vendor-specific override: ${ovCount}`);
console.log(`Zoho accounts: ${accountRows.length} | tag options: ${tagRows.length} (Location ${tagRows.filter((t) => t.tag_name === "Location").length}, Brand ${tagRows.filter((t) => t.tag_name === "Brand").length}; Brand tag active in Zoho: ${tagRows.some((t) => t.tag_name === "Brand" && t.tag_active)})`);
const noAcct = items.filter((i) => !i.account_id); if (noAcct.length) console.log("WARNING items with no Zoho account id:", noAcct.map((i) => i.display).join(", "));
console.log("\nEXAMPLE — Vaibhav Laxmi Venture:");
for (const m of mappings.filter((m) => /VAIBHAV LAXMI/.test(m.vendorKey))) { const i = itemByKey.get(m.itemKey); console.log(`   "${m.wording}" -> item "${i.display}" | account ${i.def.account} | ITC ${i.def.itc || "-"} | location ${i.def.location || "-"} | brand ${i.brand_type || "-"} | vendor override: ${JSON.stringify(m.ov)}`); }
fs.writeFileSync("zoho_import_preview.json", JSON.stringify({ skippedVendors, items: items.map((i) => ({ name: i.display, lines: i.lines, linkedTo: i.existing?.item_name || null, ...i.def, brand_type: i.brand_type })), mappings: mappings.map((m) => ({ vendor: csvVendors.get(m.vendorKey).name, wording: m.wording, item: itemByKey.get(m.itemKey).display, lines: m.lines, override: m.ov })) }, null, 1));
console.log("\nFull preview written to zoho_import_preview.json (gitignored).");
if (!APPLY) { console.log("Run with --apply to write (after the SQL migration)."); process.exit(0); }

/* ---------------------------------- apply ---------------------------------- */
const log = { at: new Date().toISOString(), vendorsInserted: [], vendorsLinked: [], itemsInserted: [], itemsUpdated: [], mappings: 0, errors: [] };
// the migration must have run
{ const t = await sb.from("purchase_items").select("account_id,itc_eligibility,location").limit(1); const z = await sb.from("zoho_accounts").select("account_id").limit(1);
  if (t.error || z.error) { console.error("\nThe SQL migration has not been run yet: " + (t.error || z.error).message + "\nRun supabase_migration_zoho_bill_fields.sql in the Supabase SQL editor, then re-run with --apply."); process.exit(1); } }

for (const part of chunk(accountRows, 200)) { const { error } = await sb.from("zoho_accounts").upsert(part, { onConflict: "account_id" }); if (error) throw new Error("zoho_accounts: " + error.message); }
for (const part of chunk(tagRows, 200)) { const { error } = await sb.from("zoho_tag_options").upsert(part, { onConflict: "tag_id,option_id" }); if (error) throw new Error("zoho_tag_options: " + error.message); }
console.log("✓ zoho_accounts + zoho_tag_options");

// vendors: link existing rows (by zoho id, exact name, or GSTIN), insert the rest
for (const [id, c] of dbLinks) { const { error } = await sb.from("vendors").update({ zoho_vendor_id: String(c.contact_id) }).eq("id", id); if (error) log.errors.push("link vendor " + id + ": " + error.message); else log.vendorsLinked.push(id); }
const byZid = new Map(dbVendors.filter((v) => v.zoho_vendor_id).map((v) => [v.zoho_vendor_id, v]));
for (const [id, c] of dbLinks) byZid.set(String(c.contact_id), dbVendors.find((v) => v.id === id));
const byGstDb = new Map(dbVendors.filter((v) => v.gstin).map((v) => [v.gstin, v]));
const usedGst = new Set(dbVendors.map((v) => v.gstin).filter(Boolean));
const vendorId = new Map(); // csv norm name -> our vendors.id
for (const [k, c] of vendorMatch) {
  const gst = c.gst_no && c.gst_no.length >= 15 ? c.gst_no : null;
  const ex = byZid.get(String(c.contact_id)) || dbV.get(k) || dbV.get(norm(c.contact_name)) || (gst && byGstDb.get(gst));
  if (ex) {
    vendorId.set(k, ex.id);
    if (!ex.zoho_vendor_id && !dbLinks.has(ex.id)) { const { error } = await sb.from("vendors").update({ zoho_vendor_id: String(c.contact_id) }).eq("id", ex.id); if (error) log.errors.push("link vendor " + ex.vendor_name + ": " + error.message); else log.vendorsLinked.push(ex.id); }
    continue;
  }
  const rec = { vendor_name: c.contact_name, gstin: gst && !usedGst.has(gst) ? gst : null, phone: c.phone || c.mobile || null, email: c.email || null, zoho_vendor_id: String(c.contact_id) };
  const { data, error } = await sb.from("vendors").insert(rec).select("id").single();
  if (error) { log.errors.push("insert vendor " + c.contact_name + ": " + error.message); continue; }
  vendorId.set(k, data.id); log.vendorsInserted.push(data.id); if (rec.gstin) usedGst.add(rec.gstin);
}
console.log(`✓ vendors: ${log.vendorsInserted.length} added, ${log.vendorsLinked.length} existing linked to Zoho`);

// items: update the 4 new columns on linked items (never overwrite a brand someone already set); create the rest
const itemId = new Map();
for (const i of items) {
  const fields = { account_id: i.account_id, account_name: i.def.account, itc_eligibility: i.def.itc || null, location: i.def.location || null };
  if (i.existing) {
    itemId.set(i.key, i.existing.id);
    const upd = { ...fields }; if (!i.existing.brand_type && i.brand_type) upd.brand_type = i.brand_type;
    const { error } = await sb.from("purchase_items").update(upd).eq("id", i.existing.id);
    if (error) log.errors.push("update item " + i.display + ": " + error.message); else log.itemsUpdated.push(i.existing.id);
  } else {
    const { data, error } = await sb.from("purchase_items").insert({ item_name: i.display, status: "Active", added_by: "zoho_history_import", brand_type: i.brand_type, ...fields }).select("id").single();
    if (error) { log.errors.push("insert item " + i.display + ": " + error.message); continue; }
    itemId.set(i.key, data.id); log.itemsInserted.push(data.id);
  }
}
console.log(`✓ items: ${log.itemsInserted.length} created, ${log.itemsUpdated.length} existing updated`);

// vendor+item mappings: only add / fill — never repoint an existing mapping to a different item
const existingMaps = await readAll("vendor_item_mappings", "id,vendor_id,normalized_vendor_item_name,item_id");
const mapKey = (v, n) => v + "|" + n; const have = new Map(existingMaps.map((m) => [mapKey(m.vendor_id, m.normalized_vendor_item_name), m]));
const toInsert = [];
for (const m of mappings) {
  const vid = vendorId.get(m.vendorKey), iid = itemId.get(m.itemKey); if (!vid || !iid) continue;
  const nn = norm(m.wording); const cur = have.get(mapKey(vid, nn));
  if (cur) { if (Object.keys(m.ov).length && cur.item_id === iid) { const { error } = await sb.from("vendor_item_mappings").update(m.ov).eq("id", cur.id); if (error) log.errors.push("update mapping " + m.wording + ": " + error.message); else log.mappings++; } continue; }
  toInsert.push({ vendor_id: vid, vendor_item_name: m.wording, normalized_vendor_item_name: nn, item_id: iid, ...m.ov });
}
for (const part of chunk(toInsert, 200)) { const { error } = await sb.from("vendor_item_mappings").insert(part); if (error) log.errors.push("insert mappings: " + error.message); else log.mappings += part.length; }
console.log(`✓ vendor+item mappings written: ${log.mappings}`);
fs.writeFileSync("zoho_import_log.json", JSON.stringify(log, null, 1));
console.log(log.errors.length ? `\n${log.errors.length} problem(s):\n  ` + log.errors.join("\n  ") : "\nNo errors.");
console.log("Log of created row ids: zoho_import_log.json (gitignored) — lets a rollback find exactly what was added.");

async function readAll(table, cols) { const out = []; for (let p = 0; ; p++) { const { data, error } = await sb.from(table).select(cols).range(p * 1000, p * 1000 + 999); if (error) throw new Error(table + ": " + error.message); out.push(...data); if (data.length < 1000) break; } return out; }
