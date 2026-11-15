/* Real Central Kitchen opening stock for the planner: the "closing stock of last day"
   from the same Supabase tables the /daily-stock-report page uses ("Opening" column).

   closing(item, D) = physical_opening(D) + production(D) − wastage(D)
   wastage = spoilages.full_qty × items.batch_size + open_qty, outlet_id = 6 (CK only).

   Read-only; no writes anywhere in here. */

import { supabase } from "@/lib/supabaseBrowser";
import { FL } from "./planner";

const CK_OUTLET = 6; // central kitchen — only its spoilage counts as wastage

// YYYY-MM-DD -> YYYY-MM-DD, calendar math on the string (UTC-safe, same as daily-stock-report)
const shiftDate = (str, days) => {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

const packSize = (batch_size) => {
  const n = parseFloat(String(batch_size || "").replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 1;
};

/* ----- name matching: DB item_name  <->  planner FL names ----- */

// lowercase, strip tags/punctuation, drop filler words ("the", "tart", "cheese(cake)")
const norm = (s) =>
  (s || "")
    .toLowerCase()
    .replace(/^#_#\s*/, "")
    .replace(/\s*-\s*taatsu$/i, "")
    .replace(/^tts\s+/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the|tart|cheesecake|cheese)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

// DB names that don't normalise to the planner's short names
const ALIASES = {
  "coconut chocolate": "choc coconut", // "Coconut Chocolate Tart" -> Choc Coconut*
  "peanut butter jelly": "pb j",       // "Peanut butter jelly tart" -> PB&J*
};

// normal form of an item name (shared with outletStock.js for sheet item matching)
export const normItem = (name) => {
  const n = norm(name);
  return ALIASES[n] || n;
};

const matchKey = (a, b) =>
  a === b || a.startsWith(b + " ") || b.startsWith(a + " ");

// do two item names refer to the same product? (word-prefix tolerant)
export const itemKeysMatch = matchKey;

/* ----- fetch ----- */

// qty for every FL row (index-aligned), sourced from the latest stock report before `date`.
// Returns { ok, date, qty, missing, extra }:
//   ok      false = no stock entry found at all (caller keeps its current values)
//   date    the report date actually used (<= date-1)
//   qty     number[] aligned with FL (0 for flavours with no DB item)
//   missing planner flavours with no DB item, extra DB items that match no planner flavour
export async function fetchCKClosing(date) {
  const before = shiftDate(date, -1);

  // latest date at or before `before` that has a physical opening entry
  const last = await supabase
    .from("physical_opening")
    .select("opening_date")
    .lte("opening_date", before)
    .order("opening_date", { ascending: false })
    .limit(1);
  if (last.error) throw last.error;
  const day = last.data?.[0]?.opening_date;
  if (!day) return { ok: false, date: null, qty: null, missing: [], extra: [] };

  const [itemsR, physR, prodR, spoilR] = await Promise.all([
    supabase.from("items").select("id,item_name,category,batch_size").eq("category", "TARTS").eq("is_active", true),
    supabase.from("physical_opening").select("item_id,opening_qty").eq("opening_date", day),
    supabase.from("production").select("item_id,production_qty").eq("production_date", day),
    supabase.from("spoilages").select("item_id,full_qty,open_qty").eq("spoilage_date", day).eq("outlet_id", CK_OUTLET),
  ]);
  const err = [itemsR, physR, prodR, spoilR].find((r) => r.error);
  if (err) throw err.error;

  const items = itemsR.data || [];
  const batch = new Map(items.map((i) => [i.id, i.batch_size]));
  const waste = new Map();
  for (const r of spoilR.data || [])
    waste.set(r.item_id, (waste.get(r.item_id) || 0) + Number(r.full_qty) * packSize(batch.get(r.item_id)) + Number(r.open_qty));
  const add = (rows, key) => {
    const m = new Map();
    for (const r of rows || []) m.set(r.item_id, (m.get(r.item_id) || 0) + Number(r[key]));
    return m;
  };
  const phys = add(physR.data, "opening_qty");
  const prod = add(prodR.data, "production_qty");

  // closing stock per DB item, keyed by normalised (alias-applied) name
  const db = items.map((i) => ({
    n: normItem(i.item_name),
    qty: Math.max(0, Math.round((phys.get(i.id) || 0) + (prod.get(i.id) || 0) - (waste.get(i.id) || 0))),
  }));

  // match each planner flavour to a DB item (a real-stock match wins over a 0-stock one)
  const dbIdx = FL.map((f) => {
    const fn = normItem(f[0]);
    const withStock = db.findIndex((d) => d.qty > 0 && matchKey(d.n, fn));
    return withStock >= 0 ? withStock : db.findIndex((d) => matchKey(d.n, fn));
  });
  const qty = dbIdx.map((di) => (di >= 0 ? db[di].qty : 0));

  const used = new Set(dbIdx.filter((d) => d >= 0));
  const missing = FL.map((f, i) => (dbIdx[i] < 0 ? f[0] : null)).filter(Boolean);
  const extra = db.map((_d, i) => items[i].item_name).filter((_n, i) => !used.has(i));

  return { ok: true, date: day, qty, missing, extra };
}
