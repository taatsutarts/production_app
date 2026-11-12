/* Real outlet stock for the planner: the same spreadsheet import the PO page uses.
   Both pages read /api/stock (app/lib/stock.js reads the "Kytchens Current Stock" Google
   Sheet and maps sheet spellings to DB names) — no dependency on the po-send page code.

   This file reshapes the API result into the planner's stock matrix:
   S[outlet (index in N)][flavour (index in FL)] = qty, or null when the sheet has no row
   for that outlet+flavour (the sheet lists every SKU an outlet carries).
   Outlets absent from the sheet entirely get hardcoded MANUAL_STOCK values for now. */

import { N, FL } from "./planner";
import { normItem, itemKeysMatch } from "./ckStock";

// planner outlet names that differ from the DB outlet names returned by /api/stock
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

/* Hardcoded stock for outlets that don't report stock in the sheet yet
   (owner-provided 2026-11-12; Biscoff not carried at these stores -> null).
   FL order. TODO: remove once the stores report stock in the sheet themselves. */
const MANUAL_STOCK = {
  Bandra:    [40, 13, 77, 27, 11, 16, 18, 33, 51, 22, null, 34, 18, 28, 23, 28, 32],
  Matunga:   [48, 53, 99, 44, 38, 72, 70, 82, 64,  7, null, 50, 19, 60, 25, 49, 56],
  Kandivali: [52, 26, 98, 76, 60, 45, 79, 73, 52, 19, null, 30,  4, 62, 20, 44, 67],
};

export async function fetchOutletStock() {
  const empty = { ok: false, date: "", S: null, missing: [], manual: [], unknownOutlets: [], unknownItems: [] };
  try {
    const r = await fetch("/api/stock");
    const d = await r.json();
    if (d.error) return { ...empty, error: d.error };

    const S = N.map(() => FL.map(() => null));
    const unknownOutlets = new Set(), unknownItems = new Set();

    for (const row of d.stock || []) {
      const o = N.findIndex((n) => sameOutlet(n, row.outlet));
      if (o < 0) { unknownOutlets.add(row.outlet); continue; }
      const i = FL.findIndex((f) => itemKeysMatch(normItem(f[0]), normItem(row.item)));
      if (i < 0) { unknownItems.add(row.item); continue; }
      // negative sheet values are system errors: treat as 0 (same rule as the hardcoded data)
      S[o][i] = Math.max(0, (S[o][i] || 0) + (Number(row.qty) || 0));
    }

    // fill the hardcoded stores (sheet data always wins when a row exists)
    const manual = [];
    for (const [name, stock] of Object.entries(MANUAL_STOCK)) {
      const o = N.indexOf(name);
      if (o < 0) continue;
      stock.forEach((v, i) => {
        if (v != null && S[o][i] == null) S[o][i] = v;
      });
      manual.push(name);
    }

    // data gap = an outlet with no sheet rows AND no hardcoded stock
    const missing = N.filter((_n, o) => S[o].every((v) => v == null));

    // the table shows numbers, never blanks: a flavour with no sheet row = 0 stock
    S.forEach((row) => row.forEach((v, i) => {
      if (v == null) row[i] = 0;
    }));

    return {
      ok: true,
      date: d.dateCell || "",
      S,
      missing,
      manual,
      unknownOutlets: [...unknownOutlets],
      unknownItems: [...unknownItems],
    };
  } catch (e) {
    return { ...empty, error: e.message };
  }
}
