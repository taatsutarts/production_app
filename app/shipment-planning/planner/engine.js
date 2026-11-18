/* Taatsu Shipment Planner — spec v6 engine (sections 7–14).
 *
 * Pure functions: numbers/arrays in, a plan out. No React, no data fetching, no globals.
 * The page (page.jsx) supplies a `ctx`:
 *
 *   ctx = {
 *     N,            string[]   outlet display names (index = outlet id used everywhere)
 *     Z,            string|arr zone per outlet: C/W/E/P
 *     NEAR,         number[]   1 = near the kitchen (little dry ice)
 *     CITY,         string[]   "Mumbai" | "Pune" (optional; derived from Z when absent)
 *     FL,           array      flavours: [name, salesMixPct, stock?] (v5 shape) OR
 *                              {name, pct, seasonal} (v6 shape)
 *     S,            number[][] current stock [outlet][flavour]
 *     CK,           number[]   kitchen stock per flavour
 *     WD, WE,       number[]   weekday / weekend sales per outlet
 *     CAPW,         number[]   freezer working capacity per outlet
 *     LL, KIT,      [lat,lng]  outlet + kitchen coordinates (from the outlets table)
 *     CKS,          number     kitchen storage limit (optional)
 *     DAYS,         number     days-of-stock trigger (default 2)
 *     OV, OVT, OVB            manual overrides (typed flavour / typed total / typed boxes)
 *     SET,          object     settings overrides (shelf life, prices, route limit, …)
 *     DRIVE,        object     real drive times: {"A|B": minutes} (place names)
 *     PRICE,        object     private per-outlet prices: {"Gamdevi": 400, …}
 *   }
 *
 * Every function is side-effect free. The page owns the state and persistence.
 */

/* ------------------------------------------------------------------ */
/* settings                                                            */
/* ------------------------------------------------------------------ */

export const ENGINE_DEFAULTS = {
  // dispatch / stock
  daysOfStock: 2, // outlets under this many days of total stock are critical
  lowFlavourSharePct: 30, // flavour-aware criticality: low flavours > this % of sales mix
  lowFlavourDays: 2, // a flavour is "low" under this many days
  shelfLifeDays: 30, // never send more than the outlet can sell in N days (product shelf life = 30 days — owner)
  cksLimit: 4000, // kitchen storage limit
  prodDefault: 1500, // default daily production (week plan)
  // routing
  routeTimeLimitMin: 180, // NOT enforced any more (nor editable): a late shipment is not our concern (owner 2026-11-17)
  roadFactor: 1.35, // straight-line km -> road km
  avgSpeedKmh: 15.4, // peak-hour average incl. stops (calibrated to the spec's estimates)
  // packing / cost
  dryIceRsPerKg: 90,
  cartonRs: 55,
  traysPerCarton: 32, // 192 tarts
  trays60: 50, // 300 tarts
  trays30: 17, // 102 tarts
  ice60Far: 0.55,
  ice30Far: 0.4,
  ice60Near: 0.225,
  ice30Near: 0.1,
  ice60Pune: 3.5,
  ice30Pune: 2,
  // rules — the two global values (SET, sourced from the planner_settings DB row).
  // The per-vehicle stop limits live on the vehicles themselves (VEHICLES + the
  // `vehicles` DB table via ctx.VEH) — see dropLimits/vehOf.
  ecoRadiusKm: 5, // Eco "in radius" band: straight-line km from the kitchen
  minTartsPerOutlet: 300, // an auto-planned outlet always receives at least this much when the freezer has room (0 = off). The owner minimum beats the shelf-life cap; freezer room still binds.
  puneWaitDays: 1, // Pune waits unless an outlet runs out before then
  urgentDays: 1, // "under one day of stock" = urgent second-trip trigger
  // challan / dispatch
  challanExpiryDays: 30,
  challanCompany: "Gourmet Zone Foods Private Limited",
  challanBrand: "Taatsu",
};

/* Per-vehicle physical + rule constants — the built-in fallback. The `vehicles`
 * DB table (migration v7) is the source of truth once it loads: the page passes
 * its rows in via ctx.VEH and vehOf() merges them over these. cap is in 60L-box
 * equivalents for tray vans ("t") and cartons for the freezer ("c").
 * maxNear/maxFar = the Eco in-radius/beyond-radius stop limits (null = no radius rule). */
export const VEHICLES = {
  es: { k: "es", l: "Eco van (Everest small)", m: "t", cap: 6, flat: 3000, minStops: 1, maxStops: 6, maxNear: 2, maxFar: 4 },
  el: { k: "el", l: "Everest large van", m: "t", cap: 14, flat: 3500, minStops: 1, maxStops: 6 },
  ef: { k: "ef", l: "Everest freezer van", m: "c", cap: 21, flat: 6500, puneFlat: 13500, minStops: 1, maxStops: 6 },
  pv: { k: "pv", l: "Private 3-wheeler", m: "t", cap: 12, perDrop: true, minStops: 1, maxStops: 5 },
};

/* one vehicle's effective row: DB values (ctx.VEH from the vehicles table) win */
export function vehOf(ctx, k) {
  return { ...VEHICLES[k], ...(ctx.VEH?.[k] || {}) };
}

/* ------------------------------------------------------------------ */
/* small helpers                                                       */
/* ------------------------------------------------------------------ */

export const sum = (a) => (a || []).reduce((x, y) => x + (Number(y) || 0), 0);
export const r6 = (v) => Math.floor(Math.max(0, Number(v) || 0) / 6) * 6; // round DOWN to trays
export const round6 = (v) => Math.round(Math.max(0, Number(v) || 0) / 6) * 6; // typed totals: halves up
export const fm = (n) => "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");
export const cpt = (n) => (Number.isFinite(n) ? "₹" + n.toFixed(1) : "–");

export const cfg = (ctx) => ({ ...ENGINE_DEFAULTS, ...(ctx.SET || {}) });

/* drop limits per vehicle key — the vehicle's own row (DB `vehicles` table via
 * vehOf) is the source; the built-in VEHICLES constants are the fallback */
export function dropLimits(ctx, k) {
  const v = vehOf(ctx, k);
  return { min: v.minStops ?? 1, max: v.maxStops ?? 5 };
}

/* straight-line km outlet -> kitchen (same approximation as driveMin) */
export function kmFromCK(ctx, o) {
  const a = ctx.LL?.[o];
  const b = ctx.KIT;
  if (!a || !b) return null;
  return 111 * Math.hypot(a[0] - b[0], (a[1] - b[1]) * 0.95);
}

/* inside the Eco in-radius band (owner rule 2026-11-16: within ecoRadiusKm of the
 * kitchen). Missing coordinates count as outside — a far stop is the safer read. */
export function inRadius(ctx, o) {
  const km = kmFromCK(ctx, o);
  return km != null && km <= cfg(ctx).ecoRadiusKm + 1e-9;
}
export const zoneOf = (ctx, o) => (Array.isArray(ctx.Z) ? ctx.Z[o] : (ctx.Z || "")[o]);
export const cityOf = (ctx, o) =>
  ctx.CITY?.[o] || (zoneOf(ctx, o) === "P" ? "Pune" : "Mumbai");
export const nameOf = (ctx, o) => ctx.N[o];
export const norm = (s) =>
  (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

export const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;
export const dateAt = (dateStr) => new Date(dateStr + "T00:00");
export const isoDate = (d) => {
  const x = new Date(d);
  const p = (n) => String(n).padStart(2, "0");
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
};
export const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

/* flavour metadata works with both the v5 array rows and v6 objects */
export const flName = (f) => (Array.isArray(f) ? f[0] : f.name);
export const flPct = (f) => (Array.isArray(f) ? Number(f[1]) || 0 : Number(f.pct) || 0);
export const flSeasonal = (f) => (Array.isArray(f) ? !(Number(f[1]) > 0) : !!f.seasonal);
export const isClassic = (f) => flPct(f) > 0 && !flSeasonal(f);

/* ------------------------------------------------------------------ */
/* sales and cover                                                     */
/* ------------------------------------------------------------------ */

export function outletSales(ctx, o, d) {
  return (isWeekend(d) ? ctx.WE?.[o] : ctx.WD?.[o]) || 0;
}

/* expected sales over the next `n` calendar days (weekends included) */
export function salesOverDays(ctx, o, d, n) {
  let total = 0;
  for (let i = 0; i < Math.max(0, n); i++) total += outletSales(ctx, o, addDays(d, i));
  return total;
}

/* days of stock left, walking forward day by day (weekend rate Sat and Sun) */
export function cover(ctx, o, d, s) {
  const x = new Date(d);
  let left = Math.max(0, Number(s) || 0);
  let c = 0;
  for (let i = 0; i < 60; i++) {
    const q = outletSales(ctx, o, x);
    if (q <= 0) return Infinity; // no sales -> never runs out
    if (left >= q) {
      left -= q;
      c++;
    } else {
      c += left / q;
      break;
    }
    x.setDate(x.getDate() + 1);
  }
  return c;
}

/* per-flavour cover (classic mix only; a flavour with no sales is never low) */
function flavourCover(ctx, o, i, d, stock) {
  const totalPct = sum(ctx.FL.filter(isClassic).map(flPct));
  const pct = flPct(ctx.FL[i]);
  if (totalPct <= 0 || pct <= 0) return Infinity;
  const base = outletSales(ctx, o, d) || 0;
  const rate = (x) => ((outletSales(ctx, o, x) || 0) * pct) / totalPct;
  if (rate(d) <= 0) return Infinity;
  return coverRate(d, stock, rate);
}

/* cover with an explicit daily rate (used by flavour cover) */
function coverRate(d, stock, rate) {
  const x = new Date(d);
  let left = Math.max(0, Number(stock) || 0);
  let c = 0;
  for (let i = 0; i < 60; i++) {
    const q = typeof rate === "function" ? rate(x) : rate;
    if (q <= 0) return Infinity;
    if (left >= q) {
      left -= q;
      c++;
    } else {
      c += left / q;
      break;
    }
    x.setDate(x.getDate() + 1);
  }
  return c;
}

/* the per-outlet criticality picture (section 9.1 + 13) */
export function criticality(ctx, st, d) {
  const C = cfg(ctx);
  const totalPct = sum(ctx.FL.filter(isClassic).map(flPct));
  return ctx.N.map((name, o) => {
    const stock = st[o] || 0;
    const cv = cover(ctx, o, d, stock);
    const low = [];
    ctx.FL.forEach((f, i) => {
      if (!isClassic(f)) return;
      const s = Math.max(0, ctx.S?.[o]?.[i] || 0);
      const fc = flavourCover(ctx, o, i, d, s);
      if (fc < C.lowFlavourDays) low.push({ i, name: flName(f), cover: fc, pct: flPct(f) });
    });
    const lowPct = totalPct > 0 ? (sum(low.map((x) => x.pct)) / totalPct) * 100 : 0;
    const critical = cv < C.daysOfStock || lowPct > C.lowFlavourSharePct;
    let reason;
    if (cv === Infinity) reason = "no sales";
    else if (cv < C.daysOfStock) reason = `${cv.toFixed(1)} days of stock`;
    else if (lowPct > C.lowFlavourSharePct)
      reason = `${low.length} low flavour${low.length === 1 ? "" : "s"} (${lowPct.toFixed(0)}% of mix)`;
    else reason = `${cv.toFixed(1)} days · can wait`;
    return { o, name, stock, cover: cv, low, lowPct, critical, reason };
  });
}

export const criticalOutlets = (ctx, st, d) =>
  criticality(ctx, st, d).filter((x) => x.critical).map((x) => x.o);

/* Does this outlet actually need stock today? (owner rule 2026-11-18: free
 * drops and return-run top-ups may only go to outlets that are running out —
 * never to one sitting on days of stock just because the van has room.)
 * True when the TOTAL cover is under the critical bar (daysOfStock), or when
 * 2+ classic flavours are under lowFlavourDays ("more than one flavour running
 * dry = flag and send"), even if the total looks healthy. */
function needsStock(ctx, o, d, st) {
  const C = cfg(ctx);
  if (cover(ctx, o, d, st[o] || 0) < C.daysOfStock) return true;
  let low = 0;
  ctx.FL.forEach((f, i) => {
    if (!isClassic(f)) return;
    if (flavourCover(ctx, o, i, d, Math.max(0, ctx.S?.[o]?.[i] || 0)) < C.lowFlavourDays) low++;
  });
  return low >= 2;
}

/* ------------------------------------------------------------------ */
/* boxes, dry ice, packaging                                           */
/* ------------------------------------------------------------------ */

/* auto box count for U tarts: trays -> 60L boxes + 30L box */
export function thA(U, C = ENGINE_DEFAULTS) {
  const tr = Math.ceil(Math.max(0, U) / 6);
  let a = Math.floor(tr / C.trays60);
  const r = tr % C.trays60;
  let b = 0;
  if (r > 0) {
    if (r <= C.trays30) b = 1;
    else a++;
  }
  return { m: "t", a, b };
}

export const bcap = (b, C = ENGINE_DEFAULTS) => (b.m === "c" ? b.c * C.traysPerCarton * 6 : b.a * C.trays60 * 6 + b.b * C.trays30 * 6);

/* dry ice kg for one outlet's boxes */
export function dry(ctx, o, b) {
  const C = cfg(ctx);
  if (zoneOf(ctx, o) === "P") return b.a * C.ice60Pune + b.b * C.ice30Pune;
  if (ctx.NEAR?.[o]) return b.a * C.ice60Near + b.b * C.ice30Near;
  return b.a * C.ice60Far + b.b * C.ice30Far;
}

/* boxes for an outlet + total, honouring a typed box override */
export function box(ctx, o, U, m, ov) {
  const x = ov && ctx.OVB?.[o];
  if (x && x.m === m) return x;
  return m === "t" ? thA(U, cfg(ctx)) : { m: "c", c: Math.ceil(Math.max(0, U) / (cfg(ctx).traysPerCarton * 6)) };
}

/* ------------------------------------------------------------------ */
/* drive times and route order                                         */
/* ------------------------------------------------------------------ */

const pairKey = (a, b) => (a < b ? a + "|" + b : b + "|" + a);
const place = (ctx, x) => (x < 0 ? "CK" : norm(ctx.N[x]));

/* minutes between two points (outlet index, or -1 for the kitchen).
 * A real time in ctx.DRIVE wins; otherwise straight-line x road factor at the
 * calibrated average speed. */
export function driveMin(ctx, a, b) {
  const C = cfg(ctx);
  const dr = ctx.DRIVE || {};
  const key = pairKey(place(ctx, a), place(ctx, b));
  const real = dr[key] ?? dr[`${place(ctx, a)}|${place(ctx, b)}`] ?? dr[`${place(ctx, b)}|${place(ctx, a)}`];
  if (real != null && Number.isFinite(Number(real))) return Number(real);
  const pa = a < 0 ? ctx.KIT : ctx.LL?.[a];
  const pb = b < 0 ? ctx.KIT : ctx.LL?.[b];
  if (!pa || !pb) return 0;
  const km = 111 * Math.hypot(pa[0] - pb[0], (pa[1] - pb[1]) * 0.95);
  return ((km * C.roadFactor) / C.avgSpeedKmh) * 60;
}

export function routeMinutes(ctx, order, start = -1) {
  let t = 0;
  let cur = start;
  for (const o of order) {
    t += driveMin(ctx, cur, o);
    cur = o;
  }
  return t + driveMin(ctx, cur, start);
}

export function routeKm(ctx, order, start = -1) {
  let km = 0;
  let cur = start;
  for (const o of order) {
    const a = cur < 0 ? ctx.KIT : ctx.LL?.[cur];
    const b = ctx.LL?.[o];
    if (a && b) km += 111 * Math.hypot(a[0] - b[0], (a[1] - b[1]) * 0.95) * cfg(ctx).roadFactor;
    cur = o;
  }
  const a = cur < 0 ? ctx.KIT : ctx.LL?.[cur];
  const b = ctx.KIT;
  if (a && b) km += 111 * Math.hypot(a[0] - b[0], (a[1] - b[1]) * 0.95) * cfg(ctx).roadFactor;
  return km;
}

function permutations(a) {
  if (a.length <= 1) return [a];
  const out = [];
  a.forEach((x, i) => {
    const rest = a.slice(0, i).concat(a.slice(i + 1));
    permutations(rest).forEach((p) => out.push([x].concat(p)));
  });
  return out;
}

/* visiting order with the shortest total time (kitchen -> stops -> kitchen).
 * Exhaustive up to 6 stops (the Everest drop limit), nearest-neighbour + 2-opt after.
 * `last` pins one outlet to the end (Thane rides last when it travels with Powai/Marol). */
export function orderStops(ctx, ids, start = -1, last = null) {
  if (!ids.length) return [];
  if (ids.length === 1) return ids.slice();
  if (last != null && ids.includes(last)) {
    const rest = ids.filter((o) => o !== last);
    return orderStops(ctx, rest, start, null).concat(last);
  }
  if (ids.length <= 6) {
    let best = ids.slice();
    let bt = routeMinutes(ctx, best, start);
    for (const p of permutations(ids)) {
      const t = routeMinutes(ctx, p, start);
      if (t < bt - 1e-9) {
        bt = t;
        best = p;
      }
    }
    return best;
  }
  // nearest neighbour, then 2-opt
  const out = [];
  let cur = start;
  const rest = ids.slice();
  while (rest.length) {
    rest.sort((a, b) => driveMin(ctx, cur, a) - driveMin(ctx, cur, b));
    const n = rest.shift();
    out.push(n);
    cur = n;
  }
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < out.length - 1; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const cand = out.slice(0, i).concat(out.slice(i, j + 1).reverse(), out.slice(j + 1));
        if (routeMinutes(ctx, cand, start) < routeMinutes(ctx, out, start) - 1e-9) {
          out.splice(0, out.length, ...cand);
          improved = true;
        }
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* flavour split (largest remainder, kitchen limit per flavour)        */
/* ------------------------------------------------------------------ */

export function split(ctx, o, TOT, ov, lim) {
  const FL = ctx.FL;
  const S = ctx.S[o];
  const q = FL.map(() => 0);
  const classic = FL.map((f) => isClassic(f));
  const seasonal = FL.map((f, i) => (!classic[i] && ov && ov[o + "|" + i] != null ? Math.max(0, ov[o + "|" + i]) : 0));
  const ss = sum(seasonal);
  const bt = Math.max(0, Math.round((Math.max(0, TOT) - ss) / 6)); // trays of classics
  const cp = sum(FL.map((f, i) => (classic[i] ? flPct(f) : 0)));
  const sc = sum(FL.map((f, i) => (classic[i] ? S[i] : 0)));
  const L = sc + bt * 6;
  const w = FL.map((f, i) => (classic[i] ? Math.max(0, (L * flPct(f)) / cp - S[i]) : 0));
  const ws = sum(w);
  const id = FL.map((f, i) => (classic[i] ? (ws ? w[i] / ws : flPct(f) / cp) * bt : 0));
  const base = id.map((v) => Math.floor(v));
  let rem = bt - sum(base);
  id
    .map((v, i) => [v - Math.floor(v), i])
    .sort((a, b) => b[0] - a[0])
    .forEach((x) => {
      if (rem > 0 && classic[x[1]]) {
        base[x[1]]++;
        rem--;
      }
    });
  FL.forEach((f, i) => {
    if (S[i] == null) return;
    if (classic[i]) {
      q[i] = base[i] * 6;
      if (lim) q[i] = Math.min(q[i], r6(lim[i]));
    }
    if (ov && ov[o + "|" + i] != null) q[i] = Math.max(0, ov[o + "|" + i]); // typed flavour wins
  });
  return q;
}

/* ------------------------------------------------------------------ */
/* allocation: decide quantities first (section 9)                     */
/* ------------------------------------------------------------------ */

/* freezer room for one outlet: capacity - stock, capped by the outlet's own
 * max send (outlets.max_send_qty via ctx.MAX; null = no extra limit). */
export function sendRoom(ctx, o, st) {
  const room = r6((ctx.CAPW?.[o] || 0) - (st[o] || 0));
  const mx = ctx.MAX?.[o];
  return mx != null ? Math.min(room, r6(mx)) : room;
}

/* minimum an auto-planned outlet receives: the outlet's own row
 * (outlets.min_send_qty via ctx.MIN) over the global planner_settings minimum. */
export function minSend(ctx, o) {
  const m = ctx.MIN?.[o];
  return m != null ? r6(m) : r6(cfg(ctx).minTartsPerOutlet);
}

/* Fill each outlet to its freezer capacity (multiple of 6), capped by the
 * shelf-life limit, served most-urgent-first and clamped by kitchen stock.
 * `ckStart` lets the caller continue from stock left by an earlier pass
 * (used for free extra drops). Returns { q, u, T, left }. */
export function allocate(ctx, ids, st, d, ov, ckStart) {
  const C = cfg(ctx);
  const CK = (ckStart || ctx.CK || []).slice();
  const urg = ids.slice().sort((a, b) => cover(ctx, a, d, st[a]) - cover(ctx, b, d, st[b]));
  const T = {};

  urg.forEach((o) => {
    const room = sendRoom(ctx, o, st);
    const shelf = r6(salesOverDays(ctx, o, d, C.shelfLifeDays));
    let t = Math.max(0, Math.min(room, shelf));
    const typedB = ov && ctx.OVB?.[o];
    const typedT = ov && ctx.OVT?.[o] != null;
    if (typedB) t = Math.min(bcap(ctx.OVB[o], C), Math.max(0, room));
    if (typedT) t = Math.max(0, round6(ctx.OVT[o])); // typed total: never box-capped
    if (!typedB && !typedT && minSend(ctx, o) > 0) {
      // owner minimum (2026-11-16): never plan a tiny shipment — an auto-planned
      // outlet gets at least its minimum (per-outlet row over the global setting)
      // when the freezer has room. The minimum beats the shelf-life cap; the
      // freezer room (and the outlet's max send) still binds.
      // Applied whenever the outlet has no typed number of its own — ov merely
      // says typed numbers may exist; it must not switch the minimum off
      // (the live plan always runs in ov mode).
      t = Math.max(t, Math.min(minSend(ctx, o), Math.max(0, room)));
    }
    T[o] = t;
  });

  const q = {};
  const u = {};
  urg.forEach((o) => {
    const avail = sum(CK);
    const t = Math.min(T[o] || 0, avail);
    q[o] = split(ctx, o, t, ov, CK);
    q[o].forEach((v, i) => (CK[i] = Math.max(0, (CK[i] || 0) - v)));
    u[o] = sum(q[o]);
  });

  return { q, u, T, left: CK };
}

/* ------------------------------------------------------------------ */
/* vehicle options (section 4, 10)                                     */
/* ------------------------------------------------------------------ */

export function privateDropPrice(ctx, o) {
  const name = norm(ctx.N[o]);
  const city = cityOf(ctx, o);
  const table = ctx.PRICE?.private || ctx.PRICE || {};
  const direct = table[name];
  if (direct != null && Number.isFinite(Number(direct))) return Number(direct);
  if (city === "Pune") return 4000;
  if (name === "gamdevi" || name === "worli") return 400;
  if (name === "juhu") return 500;
  return 800; // Kandivali and every other Mumbai outlet
}

/* one vehicle option for a trip */
function vehicleOption(ctx, k, ids, U, ov, kind) {
  const C = cfg(ctx);
  const v = vehOf(ctx, k);
  const pu = ids.length > 0 && ids.every((o) => zoneOf(ctx, o) === "P");
  const bx = ids.map((o) => box(ctx, o, U[o] || 0, v.m, ov));
  const used = sum(bx.map((b) => (v.m === "c" ? b.c : b.a + b.b / 2)));
  let veh;
  if (v.perDrop) veh = sum(ids.map((o) => privateDropPrice(ctx, o)));
  else if (k === "ef" && pu) veh = (v.puneFlat / 2) * ids.length; // 6750/drop, 13500 for 2
  else veh = v.flat;
  const pk = v.m === "c" ? sum(bx.map((b) => b.c)) * C.cartonRs : sum(bx.map((b, i) => dry(ctx, ids[i], b))) * C.dryIceRsPerKg;
  const drops = ids.length;
  // rule validity (owner rules 2026-11-16): stop limits per vehicle + the radius
  // split for any vehicle that carries one (the Eco). `why` names the broken rule
  // so the UI can show it.
  const dl = dropLimits(ctx, k);
  const inRad = ids.filter((o) => inRadius(ctx, o)).length;
  let why = null;
  if (drops < dl.min) why = `min ${dl.min} stop${dl.min === 1 ? "" : "s"}`;
  else if (drops > dl.max) why = `over ${dl.max} stops`;
  else if (v.maxNear != null && inRad > v.maxNear) why = `max ${v.maxNear} within ${C.ecoRadiusKm} km`;
  else if (v.maxFar != null && drops - inRad > v.maxFar) why = `max ${v.maxFar} beyond ${C.ecoRadiusKm} km`;
  const valid = used <= v.cap + 1e-9 && !why;
  return {
    k,
    l: v.l,
    m: v.m,
    cap: v.cap,
    used,
    bx,
    veh,
    pk,
    c: veh + pk,
    U: sum(ids.map((o) => U[o] || 0)),
    drops,
    valid,
    why,
    near: inRad,
    perDrop: !!v.perDrop,
    pune: pu,
    kind: kind || "mumbai",
  };
}

/* every allowed vehicle for one trip, valid first then cheapest */
export function vehicleOptions(ctx, ids, U, ov, kind) {
  const pu = ids.length > 0 && ids.every((o) => zoneOf(ctx, o) === "P");
  const keys = pu ? ["ef", "pv"] : ["es", "el", "ef", "pv"];
  return keys
    .map((k) => vehicleOption(ctx, k, ids, U, ov, kind))
    .sort((a, b) => b.valid - a.valid || a.c - b.c);
}

/* ------------------------------------------------------------------ */
/* trip grouping (section 7)                                           */
/* ------------------------------------------------------------------ */

const has = (ctx, o, name) => norm(ctx.N[o]) === name;

/* Split the selected outlets into allowed trips. Pune always travels together on
 * its own trip. Mumbai allows at most one van trip and one second trip, both under
 * the drop limits (Everest vans <= 6 stops, private 3-wheeler <= 5 — the rules live
 * in the vehicles table / VEHICLES via dropLimits). Goregaon/Thane never share; Thane only rides
 * with Powai/Marol (last stop), or gets its own urgent trip under one day of stock. */
export function groupTrips(ctx, sel, st, d) {
  const C = cfg(ctx);
  const puneAll = ctx.N.map((_n, o) => o).filter((o) => zoneOf(ctx, o) === "P");
  const puneSel = sel.filter((o) => zoneOf(ctx, o) === "P");
  const mumbai = sel.filter((o) => zoneOf(ctx, o) !== "P");
  const trips = [];
  const deferred = [];

  if (puneSel.length) {
    const ids = puneAll.slice(); // both Pune outlets, even if only one is critical
    trips.push({ kind: "pune", ids, deferred: [] });
  }

  let pool = mumbai.slice();
  // Thane: never alone
  const thane = pool.find((o) => has(ctx, o, "thane"));
  if (thane != null) {
    const companions = pool.filter((o) => has(ctx, o, "powai") || has(ctx, o, "marol"));
    if (!companions.length && cover(ctx, thane, d, st[thane]) >= C.urgentDays) {
      deferred.push({ o: thane, reason: "Thane never travels alone — it waits for Powai or Marol" });
      pool = pool.filter((o) => o !== thane);
    }
  }

  if (!pool.length) return { trips, deferred };

  pool.sort((a, b) => cover(ctx, a, d, st[a]) - cover(ctx, b, d, st[b]));

  let first;
  let second = [];
  const maxFirst = Math.max(dropLimits(ctx, "es").max, dropLimits(ctx, "el").max, dropLimits(ctx, "ef").max); // a van takes up to 6
  if (pool.length <= maxFirst) {
    first = pool;
  } else {
    // too many for one van: the most urgent fill the first trip and the rest ALWAYS
    // get a second trip (owner: one Everest + one private 3-wheeler is fine) — the
    // trip still respects the stop limits (vans <= 6, private <= 5). Only true
    // overflow, beyond what a second trip may carry, waits.
    first = pool.slice(0, maxFirst);
    const rest = pool.slice(maxFirst);
    second = rest.slice(0, maxFirst);
    rest.slice(maxFirst).forEach((o) => deferred.push({ o, reason: "no vehicle slots left today — over the trip stop limits" }));
  }

  // Goregaon and Thane must not share a trip.
  const g = first.find((o) => has(ctx, o, "goregaon"));
  const t = first.find((o) => has(ctx, o, "thane"));
  if (g != null && t != null) {
    const companions = first.filter((o) => has(ctx, o, "powai") || has(ctx, o, "marol"));
    // Thane (and its Powai/Marol company) move to the second trip.
    first = first.filter((o) => o !== t && !companions.includes(o));
    second = [t].concat(companions, second.filter((o) => o !== t && !companions.includes(o)));
  }

  // the second trip respects the stop limits too — overflow waits
  if (second.length > maxFirst) {
    second.slice(maxFirst).forEach((o) => deferred.push({ o, reason: "no vehicle slots left today — over the trip stop limits" }));
    second = second.slice(0, maxFirst);
  }

  // Thane rides last when it travels with Powai/Marol.
  const thaneInFirst = first.find((o) => has(ctx, o, "thane"));
  const firstOrdered = orderStops(ctx, first, -1, thaneInFirst != null ? thaneInFirst : null);
  const t2 = second.find((o) => has(ctx, o, "thane"));
  const secondOrdered = second.length ? orderStops(ctx, second, -1, t2 != null ? t2 : null) : [];

  const out = [];
  if (first.length) out.push({ kind: "mumbai", ids: firstOrdered });
  if (secondOrdered.length) out.push({ kind: "mumbai-2", ids: secondOrdered });
  // keep Pune first (it is the long run)
  const puneTrip = trips.find((x) => x.kind === "pune");
  if (puneTrip) out.unshift(puneTrip);
  return { trips: out, deferred };
}

/* ------------------------------------------------------------------ */
/* extras + return run                                                 */
/* ------------------------------------------------------------------ */

/* Free extra drops: a van fare is flat, so add nearby non-critical outlets when
 * the boxes fit the small van and the stop rules allow (owner rules 2026-11-16:
 * Eco <= maxStops, <= maxNear inside the kitchen radius, <= maxFar beyond it). */
export function freeExtras(ctx, trip, q, u, st, d, ckLeft, sel) {
  const C = cfg(ctx);
  if (trip.kind === "pune") return { ids: [], q: {}, u: {}, used: 0 };
  const vE = vehOf(ctx, "es");
  const esDL = dropLimits(ctx, "es");
  const maxNear = vE.maxNear != null ? vE.maxNear : esDL.max; // no radius rule -> only the total binds
  const maxFar = vE.maxFar != null ? vE.maxFar : esDL.max;
  const inTrip = new Set(trip.ids);
  const candidates = ctx.N
    .map((_n, o) => o)
    .filter((o) => !inTrip.has(o) && zoneOf(ctx, o) !== "P" && ctx.NEAR?.[o] && !sel.includes(o))
    .filter((o) => !(ctx.NOEX || []).includes(o)) // owner refused this free drop ("✕" on the trip card)
    .filter((o) => needsStock(ctx, o, d, st)) // only outlets that are actually running out
    .filter((o) => sendRoom(ctx, o, st) >= 300)
    .filter((o) => !has(ctx, o, "thane") && !has(ctx, o, "goregaon"))
    .sort((a, b) => cover(ctx, a, d, st[a]) - cover(ctx, b, d, st[b]));

  const ids = [];
  // extras must fit the small van (the flat-fare vehicle); otherwise they are a
  // separate return run, not a free drop.
  let used = sum(trip.ids.map((o) => {
    const b = thA(u[o] || 0, C);
    return b.a + b.b / 2;
  }));
  // the Eco in-radius budget: stops already on the trip, plus the extras added here
  let nearStops = trip.ids.filter((o) => inRadius(ctx, o)).length;
  let farStops = trip.ids.length - nearStops;
  let addedNear = 0;
  let addedFar = 0;
  for (const o of candidates) {
    if (trip.ids.length + ids.length >= esDL.max) break;
    const isNear = inRadius(ctx, o);
    if (isNear ? nearStops + addedNear >= maxNear : farStops + addedFar >= maxFar) continue;
    const need = Math.min(
      sendRoom(ctx, o, st),
      r6(salesOverDays(ctx, o, d, C.shelfLifeDays)),
    );
    const b = thA(need, C);
    const slots = b.a + b.b / 2;
    if (used + slots > vE.cap + 1e-9) continue;
    ids.push(o);
    used += slots;
    if (isNear) addedNear++;
    else addedFar++;
  }
  if (!ids.length) return { ids: [], q: {}, u: {}, used: 0 };
  const extra = allocate(ctx, ids, st, d, null, ckLeft);
  return { ids, q: extra.q, u: extra.u, used: sum(Object.values(extra.u)), left: extra.left };
}

/* Return run (split run, section 12 + owner rule 2026-11-16): drop the in-radius
 * outlets first, come back to the kitchen, reload, then do the far run on the same
 * flat fare. Legs are decided by DISTANCE (within ecoRadiusKm of CK), not by name.
 * Skipped when the trip already contains in-radius stops (they can't be split onto
 * a leg). Only the Eco and large Everest vans; every leg respects the drop rules. */
export function returnRunOptions(ctx, trip, q, u, st, d, ckLeft, opts) {
  const C = cfg(ctx);
  if (trip.kind === "pune") return [];
  if (trip.ids.some((o) => inRadius(ctx, o))) return [];
  const far = trip.ids.slice();
  if (!far.length) return [];
  const nearCands = ctx.N
    .map((_n, o) => o)
    .filter((o) => inRadius(ctx, o) && !trip.ids.includes(o))
    .filter((o) => !(ctx.NOEX || []).includes(o)) // owner refused this outlet as a free drop today
    .filter((o) => sendRoom(ctx, o, st) >= 300)
    .filter((o) => needsStock(ctx, o, d, st)) // only outlets that are actually running out
    .sort((a, b) => cover(ctx, a, d, st[a]) - cover(ctx, b, d, st[b]));
  if (!nearCands.length) return [];

  const out = [];
  for (const k of ["es", "el"]) {
    const v = vehOf(ctx, k);
    const dl = dropLimits(ctx, k);
    // the far leg is the trip as built — it must satisfy this vehicle's far/total rules
    if (far.length > dl.max) continue;
    if (v.maxFar != null && far.length > v.maxFar) continue;
    const nearCap = Math.min(v.maxNear != null ? v.maxNear : dl.max, dl.max - far.length);
    const near = [];
    for (const o of nearCands) {
      if (near.length + 1 > nearCap) break;
      near.push(o);
    }
    if (!near.length) continue;

    const farU = sum(far.map((o) => u[o] || 0));
    const nearAlloc = allocate(ctx, near, st, d, null, ckLeft);
    const nearU = sum(near.map((o) => nearAlloc.u[o] || 0));
    if (!nearU) continue;

    const farBoxes = far.map((o) => box(ctx, o, u[o] || 0, v.m, null));
    const nearBoxes = near.map((o) => box(ctx, o, nearAlloc.u[o] || 0, v.m, null));
    const farUsed = sum(farBoxes.map((b) => b.a + b.b / 2));
    const nearUsed = sum(nearBoxes.map((b) => b.a + b.b / 2));
    // a return run only pays off when the far run already fills the van
    if (farUsed < v.cap - 1e-9) continue;
    if (farUsed > v.cap + 1e-9 || nearUsed > v.cap + 1e-9) continue;

    const veh = v.flat;
    const pk = sum(far.map((o, i) => dry(ctx, o, farBoxes[i]))) * C.dryIceRsPerKg +
      sum(near.map((o, i) => dry(ctx, o, nearBoxes[i]))) * C.dryIceRsPerKg;
    const totalU = farU + nearU;
    const c = veh + pk;

    // only offer it when it lowers cost per tart
    const bestSingle = opts.filter((x) => x.valid && !x.returnRun).sort((a, b) => a.c / Math.max(1, a.U) - b.c / Math.max(1, b.U))[0];
    const single = bestSingle ? bestSingle.c / Math.max(1, bestSingle.U) : Infinity;
    if (!(c / Math.max(1, totalU) < single - 1e-9)) continue;

    const allIds = near.concat(far);
    out.push({
      k: k + "-rr",
      l: v.l + " + return run",
      m: v.m,
      cap: v.cap,
      used: Math.max(nearUsed, farUsed),
      bx: allIds.map((o) => (near.includes(o) ? nearBoxes[near.indexOf(o)] : farBoxes[far.indexOf(o)])),
      veh,
      pk,
      c,
      drops: allIds.length,
      valid: true,
      returnRun: true,
      U: totalU,
      runs: [
        { ids: near, U: nearU, bx: nearBoxes, used: nearUsed, label: "near run" },
        { ids: far, U: farU, bx: farBoxes, used: farUsed, label: "far run" },
      ],
      q: { ...q, ...nearAlloc.q },
      u: { ...u, ...nearAlloc.u },
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* build a plan                                                        */
/* ------------------------------------------------------------------ */

/* Full plan for an explicit selection of outlets. Returns the v5-compatible
 * { q, u, ids, tot, trips } plus the new fields the v6 UI needs. */
export function buildPlan(ctx, sel, st, d, ov) {
  const C = cfg(ctx);
  const info = criticality(ctx, st, d);
  const grouped = groupTrips(ctx, sel, st, d);
  const baseIds = grouped.trips.flatMap((t) => t.ids);
  const alloc = allocate(ctx, baseIds, st, d, ov);
  const q = { ...alloc.q };
  const u = { ...alloc.u };

  const trips = grouped.trips.map((t) => {
    const U = sum(t.ids.map((o) => u[o] || 0));
    const opts = vehicleOptions(ctx, t.ids, Object.fromEntries(t.ids.map((o) => [o, u[o] || 0])), ov, t.kind);
    return { ...t, key: t.ids.join("-"), U, o: opts };
  });

  // free extras for Everest trips (flat fare, spare drops)
  const withExtras = trips.map((t) => {
    if (t.kind === "pune") return { ...t, extras: { ids: [], q: {}, u: {} } };
    const ex = freeExtras(ctx, t, q, u, st, d, alloc.left, sel);
    if (!ex.ids.length) return { ...t, extras: { ids: [], q: {}, u: {} } };
    ex.ids.forEach((o) => {
      q[o] = ex.q[o] || q[o] || 0;
      u[o] = ex.u[o] || u[o] || 0;
    });
    const U = t.U + sum(ex.ids.map((o) => u[o] || 0));
    const ids = t.ids.concat(ex.ids);
    // Thane still has to be the last stop after extras are appended
    const thane = ids.find((o) => has(ctx, o, "thane"));
    const ordered = orderStops(ctx, ids, -1, thane != null ? thane : null);
    const opts = vehicleOptions(ctx, ordered, Object.fromEntries(ordered.map((o) => [o, u[o] || 0])), ov, t.kind);
    return { ...t, ids: ordered, U, key: ordered.join("-"), o: opts, extras: ex };
  });

  // return-run options (and their quantities) for each Mumbai trip
  const finalTrips = withExtras.map((t) => {
    const rr = returnRunOptions(ctx, t, q, u, st, d, alloc.left, t.o);
    rr.forEach((r) => {
      Object.assign(q, r.q);
      Object.assign(u, r.u);
    });
    const opts = t.o.concat(rr);
    return { ...t, o: opts, rr };
  });

  // "minimum 1 drop" (owner rule): a vehicle is never dispatched without at least one
  // real drop — if the kitchen is short and EVERY stop of a trip got 0 tarts, the trip
  // is dropped entirely instead of planning a paid vehicle with nothing to deliver.
  const sentTrips = finalTrips.filter((t) => sum(t.ids.map((o) => u[o] || 0)) > 0);
  // capacity rule: an over-capacity option is invalid, so the planner automatically
  // switches to the next bigger van. If even the freezer van cannot fit the load the
  // trip is flagged noFit and the UI says so — nothing is ever sent over capacity.
  sentTrips.forEach((t) => { t.noFit = !t.o.some((x) => x.valid); });

  const ids = sentTrips.flatMap((t) => t.ids);
  const tot = sum(ids.map((o) => u[o] || 0));
  const infoByOutlet = Object.fromEntries(info.map((x) => [x.o, x]));

  return {
    q,
    u,
    ids,
    tot,
    trips: sentTrips,
    deferred: grouped.deferred,
    info: infoByOutlet,
    critical: info.filter((x) => x.critical).map((x) => x.o),
    T: alloc.T,
    ckLeft: alloc.left,
  };
}

/* which outlets go today: the v5 rule kept as named plan options, but criticality
 * now comes from the flavour-aware section 9.1 test. */
export function planOptions(ctx, st, d) {
  const info = criticality(ctx, st, d);
  const crit = info.filter((x) => x.critical).map((x) => x.o);
  const low = info.filter((x) => x.low.length > 0).map((x) => x.o);
  const byCover = info.slice().sort((a, b) => a.cover - b.cover).map((x) => x.o);
  const allMumbai = (ids) => ids.every((o) => zoneOf(ctx, o) !== "P");
  const opts = [];
  if (crit.length) {
    const priv = crit.length <= 2 && allMumbai(crit);
    opts.push({
      l: priv ? "Critical only, private 3-wheeler" : "All critical outlets",
      ids: crit,
      f: priv ? "pv" : null,
    });
  } else {
    opts.push({ l: "Skip dispatch", ids: [], f: null });
    opts.push({ l: "Send to the 4 lowest", ids: byCover.slice(0, 4), f: null });
  }
  const lowOnly = low.filter((o) => !crit.includes(o));
  if (crit.length && lowOnly.length)
    opts.push({ l: "Critical + other low flavours", ids: crit.concat(lowOnly), f: null });
  return opts;
}

/* pick the selected option for a trip (same contract as the old planner) */
export function pick(t, useOverrides, force, SELV) {
  const x = useOverrides && SELV && SELV[t.key] && t.o.find((v) => v.k === SELV[t.key]);
  if (x) return x;
  const f = force && t.o.find((v) => v.k === force && v.valid);
  return f || t.o.find((z) => z.valid) || t.o[0];
}

/* cost + tarts for a chosen set of options (used by the options comparison) */
export function planCost(ctx, plan, SELV, FORCE) {
  let c = 0;
  let u = 0;
  const chosen = [];
  plan.trips.forEach((t) => {
    const x = pick(t, true, FORCE, SELV);
    chosen.push(x);
    c += x.c;
    u += x.returnRun ? x.U : t.U;
  });
  return { cost: c, tarts: u, cpt: u ? c / u : null, chosen };
}

/* ------------------------------------------------------------------ */
/* week plan (Appendix B)                                              */
/* ------------------------------------------------------------------ */

export function workingDays(dateStr, count = 6) {
  const d = dateAt(dateStr);
  const out = [];
  while (out.length < count) {
    if (d.getDay() !== 0) out.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/* Project outlet stock forward: add a shipment, then subtract every calendar
 * day's sales up to (not including) `until`. */
export function projectStock(ctx, st, d, send, until) {
  const out = st.map((v) => Math.max(0, v));
  Object.entries(send || {}).forEach(([o, q]) => {
    out[Number(o)] = (out[Number(o)] || 0) + (Number(q) || 0);
  });
  for (let x = new Date(d); x < until; x.setDate(x.getDate() + 1)) {
    ctx.N.forEach((_n, o) => {
      out[o] = Math.max(0, out[o] - outletSales(ctx, o, x));
    });
  }
  return out;
}

/* six working days from the dispatch date, Sundays skipped */
export function weekRows(ctx, plan, PROD, SELV, FORCE, dateStr) {
  const C = cfg(ctx);
  let st = ctx.N.map((_n, o) => (ctx.S[o] || []).reduce((a, b) => a + Math.max(0, b || 0), 0));
  let ck = sum(ctx.CK);
  const rows = [];
  const ds = workingDays(dateStr, 6);
  ds.forEach((d, i) => {
    let P;
    let force = null;
    if (i === 0) {
      P = plan;
      force = FORCE;
    } else {
      const sel = criticalOutlets(ctx, st, d);
      force = sel.length <= 2 && sel.every((o) => zoneOf(ctx, o) !== "P") ? "pv" : null;
      P = buildPlan(ctx, sel, st, d, null);
    }
    const chosen = P.trips.map((t) => pick(t, true, force, SELV));
    const ship = sum(P.ids.map((o) => P.u[o] || 0));
    const cost = sum(chosen.map((x) => x.c));
    const close = ck - ship + (PROD[i] ?? C.prodDefault);
    rows.push({
      d,
      open: ck,
      prod: PROD[i] ?? C.prodDefault,
      ship,
      close,
      ids: P.ids,
      svc: chosen.map((x) => x.l.replace("Everest ", "E. ")).join(" + ") || "–",
      cpt: ship ? cost / ship : null,
      plan: P,
    });
    st = projectStock(ctx, st, d, P.u, ds[i + 1] || addDays(d, 1));
    ck = close;
  });
  return rows;
}