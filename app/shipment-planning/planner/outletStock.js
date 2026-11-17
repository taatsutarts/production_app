/* Real outlet stock for the planner, sourced from the `stores_closing_stock` table
   (the outlet team enters closing stock daily on /shipment-planning/closing-stock).

   For each outlet the NEWEST entry at or before the dispatch date wins, per flavour.
   Outlets with no closing-stock rows at all fall back to the shared stock sheet
   (/api/stock — the same import the PO page uses). Everything else is 0: the table
   shows numbers, never blanks. No hardcoded stock lives in code anymore.

   S[outlet (index in N)][flavour (index in FL)] = qty. */

import { supabase } from "@/lib/supabaseBrowser";
import { N, FL } from "./planner";
import { normItem, itemKeysMatch } from "./ckStock";

// planner outlet names that differ from the DB outlet names
const OUTLET_ALIASES = {
  "andheri west": "dn nagar", // planner keeps the colloquial name; DB outlet is "DN Nagar"
};

const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const dropKind = (s) => s.replace(/\b(kytchens|kytchen|store|cloud)\b/g, "").replace(/\s+/g, " ").trim();

// does a planner outlet name and a DB outlet name refer to the same outlet?
const sameOutlet = (plannerName, dbName) => {
  const a = OUTLET_ALIASES[norm(plannerName)] || norm(plannerName);
  return a === dropKind(norm(dbName));
};

export async function fetchOutletStock(dispatchDate) {
  const empty = { ok: false, S: null, closing: N.map(() => null), missing: [], unknownItems: [], sheet: { used: [], date: "", error: null } };
  try {
    // planner outlet -> DB row (id for the closing-stock query, name for the sheet)
    const { data: outletRows, error: outErr } = await supabase
      .from("outlets")
      .select("id,name")
      .eq("is_active", true);
    if (outErr) return { ...empty, error: outErr.message };

    const idOf = N.map((n) => outletRows.find((r) => sameOutlet(n, r.name))?.id ?? null);

    // newest entries at or before the dispatch date (bounded window: 14 days)
    let q = supabase
      .from("stores_closing_stock")
      .select("stock_date,outlet_id,item_name,qty")
      .order("stock_date", { ascending: false })
      .limit(2000);
    if (dispatchDate) q = q.lte("stock_date", dispatchDate);
    const { data: closingRows, error: cErr } = await q;
    if (cErr) return { ...empty, error: cErr.message };

    const S = N.map(() => FL.map(() => null));
    const closing = N.map(() => null); // the closing-stock date used, per outlet
    const unknownItems = new Set();

    // newest row per (outlet, flavour): rows arrive stock_date DESC, so the first hit wins
    for (const row of closingRows || []) {
      const o = idOf.indexOf(row.outlet_id);
      if (o < 0) continue;
      const i = FL.findIndex((f) => itemKeysMatch(normItem(f[0]), normItem(row.item_name)));
      if (i < 0) { unknownItems.add(row.item_name); continue; }
      if (S[o][i] == null) {
        S[o][i] = Math.max(0, Number(row.qty) || 0);
        if (closing[o] == null) closing[o] = row.stock_date;
      }
    }

    // outlets with no closing-stock rows at all fall back to the shared stock sheet
    const sheet = { used: [], date: "", error: null };
    const noClosing = N.filter((_n, o) => closing[o] == null);
    if (noClosing.length) {
      try {
        const r = await fetch("/api/stock");
        const d = await r.json();
        if (d.error) sheet.error = d.error;
        else {
          sheet.date = d.dateCell || "";
          for (const row of d.stock || []) {
            const o = noClosing.findIndex((n) => sameOutlet(n, row.outlet));
            if (o < 0) continue;
            const outlet = noClosing[o];
            const i = FL.findIndex((f) => itemKeysMatch(normItem(f[0]), normItem(row.item)));
            if (i < 0) { unknownItems.add(row.item); continue; }
            const oi = N.indexOf(outlet);
            // negative sheet values are system errors: treat as 0
            S[oi][i] = Math.max(0, (S[oi][i] || 0) + (Number(row.qty) || 0));
            if (!sheet.used.includes(outlet)) sheet.used.push(outlet);
          }
        }
      } catch (e) {
        sheet.error = e.message;
      }
    }

    // data gap = an outlet with neither closing-stock rows nor sheet rows
    const missing = N.filter((_n, o) => S[o].every((v) => v == null));

    // the table shows numbers, never blanks: no entry for a flavour = 0 stock
    S.forEach((row) => row.forEach((v, i) => {
      if (v == null) row[i] = 0;
    }));

    return { ok: true, S, closing, missing, unknownItems: [...unknownItems], sheet };
  } catch (e) {
    return { ...empty, error: e.message };
  }
}
