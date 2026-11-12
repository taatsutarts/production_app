/* Taatsu Shipment Planner: pure logic, ported 1:1 from shipment_planner_v4.html.
   No React in here. Functions that used globals in the HTML take a `ctx`:
   ctx = { S, OV, OVB, OVT, CK, WD, WE, CAPW, DAYS } */

const _ = null;

/* ---------- data ---------- */

export const N = ["Gamdevi","Worli","Juhu","Andheri West","Goregaon","Malad","Borivali West","Marol","Powai","Thane","Baner","Kalyani Nagar","Bandra","Matunga","Kandivali"];
export const CAP  = [918,918,918,918,918,918,918,918,918,918,918,918,810,1500,1500];
export const CAPW0 = CAP.map((c, o) => (o == 10 || o == 11 ? 1150 : c));
export const PERF = [9,8,7,9,4,4,2,7,5,2,7,8,9,12,8];

// real coordinates from the owner (same order as N); KIT = central kitchen, Tardeo
export const LL = [
  [18.9592286, 72.8129089], // Gamdevi
  [18.9945254, 72.8220039], // Worli
  [19.0890198, 72.8360391], // Juhu
  [19.1252344, 72.8318347], // Andheri West
  [19.128224, 72.8261697],  // Goregaon
  [19.1888664, 72.7782226], // Malad
  [19.2335, 72.853],        // Borivali West
  [19.1122481, 72.8803645], // Marol
  [19.1126571, 72.9112707], // Powai
  [19.2537495, 72.9821635], // Thane
  [18.5566043, 73.7410824], // Baner
  [18.5479783, 73.9180992], // Kalyani Nagar
  [19.052706, 72.827826],   // Bandra
  [19.0269716, 72.8561727], // Matunga
  [19.2099865, 72.8731943], // Kandivali
];
export const KIT = [18.9769534, 72.8121371];

export const Z = "CCWWWWWEEEPPWCW"; // C central, W west, E east, P Pune
export const NEAR = [1,1,0,0,0,0,0,0,0,0,0,0,1,1,0];
export const DAY = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

// [name, sales mix %, stock per outlet (null = not carried)]
export const FL = [
  ["Kunafa Chocolate",5.5,[17,24,27,19,29,24,5,30,25,3,26,30,24,14,21]],
  ["Apple Crumble",6.8,[29,35,18,22,29,25,5,41,24,8,18,37,106,168,146]],
  ["Belgian Chocolate",22.1,[66,91,15,27,122,99,57,125,111,46,130,110,_,_,_]],
  ["Blueberry",7.6,[30,28,6,16,36,19,8,39,37,8,42,3,30,50,72]],
  ["Brownie",6.4,[22,26,29,16,19,19,8,34,28,10,43,23,43,58,55]],
  ["Lemon Mousse",10.4,[22,42,32,7,55,45,23,57,46,3,38,5,30,90,65]],
  ["Nutella",12.6,[40,42,52,34,68,49,29,72,67,33,42,44,44,114,97]],
  ["Original Vanilla",17,[69,66,56,36,85,83,29,97,86,18,87,29,55,114,91]],
  ["Salted Caramel",11.2,[16,41,24,21,56,45,22,56,47,8,51,15,70,90,69]],
  ["Jalapeno Cheddar*",0,[23,28,17,0,0,0,0,21,0,0,0,0,36,66,40]],
  ["Biscoff*",0,[0,0,0,0,0,0,0,0,0,0,0,0,38,56,85]],
  ["Mushroom Cheddar*",0,[0,0,0,0,0,0,0,0,0,0,0,0,34,50,30]],
  ["Black Forest*",0,[22,26,27,27,0,0,0,18,0,0,2,5,25,19,14]],
  ["Choc Coconut*",0,[32,48,28,39,37,33,0,46,32,6,36,12,25,25,26]],
  ["PB&J*",0,[0,14,0,0,0,0,0,0,0,0,0,0,34,60,49]],
  ["Tiramisu*",0,[37,72,40,38,56,61,7,51,47,20,57,10,_,_,_]],
  ["Motichoor*",0,[37,18,10,26,35,30,0,26,25,2,33,3,_,_,_]],
];

export const PK = ["Box of 1","Box of 3","Small doggy bag","Large doggy bag"];
export const GN = ["Cocoa powder","Icing sugar","Cinnamon powder"];
export const XI = PK.concat(GN);

/* ---------- helpers ---------- */

export const sum = (a) => a.reduce((x, y) => x + y, 0);
export const r6 = (v) => Math.floor(Math.max(0, v) / 6) * 6;
export const fm = (n) => "₹" + Math.round(n).toLocaleString("en-IN");
export const cpt = (n) => "₹" + n.toFixed(1);
// straight-line distance x 1.35 road factor
export const hv = (a, b) => 111 * Math.hypot(a[0] - b[0], (a[1] - b[1]) * 0.95) * 1.35;

/* ---------- initial editable state ---------- */

// negative values are system errors: treat as 0
export const initialStock = () => N.map((_n, o) => FL.map((f) => (f[2][o] == null ? null : Math.max(0, f[2][o]))));
export const initialExtras = () => N.map(() => XI.map(() => 0));
export const initialCK = () => FL.map((f) => (f[1] ? r6((3800 * f[1]) / 99.6) : 0));
export const initialProd = () => [1500, 1500, 1500, 1500, 1500, 1500];
// examples scaled from Gamdevi (140 weekday, 210 weekend) by performance %
export const initialWD = () => PERF.map((p) => Math.round((140 * p) / 9));
export const initialWE = () => PERF.map((p) => Math.round((210 * p) / 9));
export const initialCapw = () => CAPW0.slice();

export const stk = (S, o) => sum(S[o].map((v) => Math.max(0, v || 0)));
export const ckTot = (CK) => sum(CK);

/* ---------- sales and cover ---------- */

export const sales = (ctx, o, d) => (d.getDay() == 0 || d.getDay() == 6 ? ctx.WE[o] : ctx.WD[o]);

// days of stock left, walking forward day by day (weekend rate Sat and Sun)
export function cover(ctx, o, d, s) {
  const x = new Date(d);
  let c = 0;
  for (let i = 0; i < 14; i++) {
    const q = sales(ctx, o, x) || 1;
    if (s >= q) { s -= q; c++; }
    else { c += s / q; break; }
    x.setDate(x.getDate() + 1);
  }
  return c;
}

/* ---------- boxes ---------- */

// 60L = 50 trays (300 tarts), 30L = 17 trays (102 tarts)
export function thA(U) {
  const tr = Math.ceil(U / 6);
  let a = Math.floor(tr / 50), r = tr % 50, b = 0;
  if (r > 0) { if (r <= 17) b = 1; else a++; }
  return { m: "t", a, b };
}
export const bcap = (b) => (b.m == "c" ? b.c * 192 : b.a * 300 + b.b * 102);
export const dry = (o, b) =>
  Z[o] == "P" ? b.a * 3.5 + b.b * 2 : NEAR[o] ? b.a * 0.225 + b.b * 0.1 : b.a * 0.55 + b.b * 0.4;

export function box(ctx, o, U, m, ov) {
  const x = ov && ctx.OVB[o];
  if (x && x.m == m) return x;
  return m == "t" ? thA(U) : { m: "c", c: Math.ceil(U / 192) };
}

/* ---------- flavour split (largest remainder, kitchen limit per flavour) ---------- */

export function split(ctx, o, TOT, ov, lim) {
  const { S, OV } = ctx;
  const q = FL.map(() => 0);
  const cl = FL.map((f, i) => f[1] && S[o][i] != null);
  const ss = sum(FL.map((f, i) => (!f[1] && S[o][i] != null && ov && OV[o + "|" + i] != null ? OV[o + "|" + i] : 0)));
  const bt = Math.max(0, Math.round((TOT - ss) / 6));
  const cp = sum(FL.map((f, i) => (cl[i] ? f[1] : 0)));
  const sc = sum(FL.map((f, i) => (cl[i] ? S[o][i] : 0)));
  const L = sc + bt * 6;
  const w = FL.map((f, i) => (cl[i] ? Math.max(0, (L * f[1]) / cp - S[o][i]) : 0));
  const ws = sum(w);
  const id = FL.map((f, i) => (cl[i] ? (ws ? w[i] / ws : f[1] / cp) * bt : 0));
  const base = id.map((v) => Math.floor(v));
  let rem = bt - sum(base);
  id.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]).forEach((x) => {
    if (rem > 0 && cl[x[1]]) { base[x[1]]++; rem--; }
  });
  FL.forEach((f, i) => {
    if (S[o][i] == null) return;
    if (cl[i]) {
      q[i] = base[i] * 6;
      if (lim) q[i] = Math.min(q[i], r6(lim[i]));
    }
    if (ov && OV[o + "|" + i] != null) q[i] = OV[o + "|" + i];
  });
  return q;
}

/* ---------- trips ---------- */

export function order(ids) {
  const out = [];
  let cur = KIT, rest = ids.slice();
  while (rest.length) {
    rest.sort((a, b) => hv(cur, LL[a]) - hv(cur, LL[b]));
    const n = rest.shift();
    out.push(n);
    cur = LL[n];
  }
  return out;
}

// west+central and east never share a trip (so Goregaon and Thane are always apart); Pune alone; max 5 drops
export function mkTrips(ids) {
  const pu = ids.filter((o) => Z[o] == "P");
  const mu = ids.filter((o) => Z[o] != "P");
  const W = mu.filter((o) => Z[o] == "W");
  const E = mu.filter((o) => Z[o] == "E");
  const C = mu.filter((o) => Z[o] == "C");
  const g = W.length && E.length ? [W.concat(C), E] : [mu];
  if (pu.length) g.push(pu);
  const out = [];
  g.forEach((x) => {
    const od = order(x);
    for (let i = 0; i < od.length; i += 5) out.push(od.slice(i, i + 5));
  });
  return out;
}

// vehicle options for one trip: valid first, then cheapest
export function opts(ctx, ids, U, ov) {
  const pu = Z[ids[0]] == "P", n = ids.length;
  const vs = pu
    ? [["ef", "Everest freezer van", "c", 21], ["pv", "Private 3-wheeler", "t", 12]]
    : [["es", "Everest small van", "t", 6], ["el", "Everest large van", "t", 14], ["ef", "Everest freezer van", "c", 21], ["pv", "Private 3-wheeler", "t", 12]];
  const r = vs.map(([k, l, m, cap]) => {
    const bx = ids.map((o) => box(ctx, o, U[o], m, ov));
    const used = sum(bx.map((b) => (m == "c" ? b.c : b.a + b.b / 2)));
    const pk = m == "c" ? sum(bx.map((b) => b.c)) * 55 : sum(bx.map((b, i) => dry(ids[i], b))) * 90;
    const veh = k == "es" ? 3000 : k == "el" ? 3500 : k == "ef" ? (pu ? 6750 * n : 6500) : sum(ids.map((o) => (pu ? 4000 : o < 2 ? 400 : 800)));
    return { k, l, m, cap, used, bx, veh, pk, c: veh + pk, valid: used <= cap };
  });
  return r.sort((a, b) => b.valid - a.valid || a.c - b.c);
}

/* ---------- day plan ---------- */

// st = current stock per outlet, d = dispatch date. Fills each outlet to its freezer capacity,
// lowest days-of-stock first, limited by kitchen stock (also per flavour).
export function dayPlan(ctx, sel, ov, st, d) {
  const { OVB, OVT, CK, CAPW } = ctx;
  const T = {};
  const urg = sel.slice().sort((a, b) => cover(ctx, a, d, st[a]) - cover(ctx, b, d, st[b]));
  let left = ckTot(CK);
  urg.forEach((o) => {
    const g = Math.min(r6(CAPW[o] - st[o]), r6(left));
    T[o] = g;
    left -= g;
  });
  if (ov)
    sel.forEach((o) => {
      if (OVB[o]) T[o] = Math.min(bcap(OVB[o]), r6(CAPW[o] - st[o]));
      if (OVT[o] != null) T[o] = OVT[o];
    });
  const q = {}, u = {}, lim = CK.slice();
  urg.forEach((o) => {
    q[o] = split(ctx, o, T[o], ov, lim);
    q[o].forEach((v, i) => (lim[i] -= v));
    u[o] = sum(q[o]);
  });
  const ids = urg.filter((o) => u[o] > 0);
  return {
    q, u, ids,
    tot: sum(sel.map((o) => u[o])),
    trips: mkTrips(ids).map((t) => ({ ids: t, key: t.join("-"), U: sum(t.map((o) => u[o])), o: opts(ctx, t, u, ov) })),
  };
}

export function pick(t, us, force, SELV) {
  const x = us && SELV[t.key] && t.o.find((v) => v.k == SELV[t.key]);
  if (x) return x;
  const f = force && t.o.find((v) => v.k == force && v.valid);
  return f || t.o.find((z) => z.valid) || t.o[0];
}

/* ---------- which outlets go (decision rule) ---------- */

export function rule(ctx, st, d) {
  const r = N.map((_n, o) => o).sort((a, b) => cover(ctx, a, d, st[a]) - cover(ctx, b, d, st[b]));
  const crit = r.filter((o) => cover(ctx, o, d, st[o]) < ctx.DAYS);
  const mu = crit.every((o) => Z[o] != "P");
  const pad = r.slice(0, 4);
  if (!crit.length)
    return [{ l: "Skip dispatch", ids: [], f: null }, { l: "Send to the 4 lowest", ids: pad, f: null }];
  if (crit.length >= 4) return [{ l: "All critical outlets", ids: crit, f: null }];
  const A = { l: "Critical only, private 3-wheeler", ids: crit, f: "pv" };
  const B = { l: "Add lowest stock to reach 4", ids: pad, f: null };
  return crit.length <= 2 && mu ? [A, B] : [B].concat(mu ? [A] : []);
}

export function optCost(ctx, op, st, d) {
  const P = dayPlan(ctx, op.ids, false, st, d);
  let c = 0, u = 0;
  P.trips.forEach((t) => { c += pick(t, false, op.f, {}).c; u += t.U; });
  return u ? c / u : null;
}

/* ---------- week plan ---------- */

// 6 working days from the dispatch date, Sundays skipped
export function wdays(dateStr) {
  const d = new Date(dateStr + "T00:00");
  const out = [];
  while (out.length < 6) {
    if (d.getDay() != 0) out.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

export function weekRows(ctx, P, PROD, SELV, FORCE, dateStr) {
  const { S, CK, CAPW } = ctx;
  const st = N.map((_n, o) => stk(S, o));
  const rows = [];
  const ds = wdays(dateStr);
  let ck = ckTot(CK);
  ds.forEach((d, i) => {
    let U = {}, trips, force = null;
    if (i == 0) { U = P.u; trips = P.trips; force = FORCE; }
    else {
      const op = rule(ctx, st, d)[0];
      force = op.f;
      let left = ck;
      op.ids.slice().sort((a, b) => cover(ctx, a, d, st[a]) - cover(ctx, b, d, st[b])).forEach((o) => {
        const g = Math.min(r6(CAPW[o] - st[o]), r6(left));
        if (g > 0) { U[o] = g; left -= g; }
      });
      trips = mkTrips(Object.keys(U).map(Number)).map((t) => ({ ids: t, key: t.join("-"), U: sum(t.map((o) => U[o])), o: opts(ctx, t, U, false) }));
    }
    const ids = Object.keys(U).map(Number).filter((o) => U[o] > 0);
    const ship = sum(ids.map((o) => U[o]));
    const ch = trips.map((t) => pick(t, i == 0, force, SELV));
    const c = sum(ch.map((x) => x.c));
    const close = ck - ship + PROD[i];
    rows.push({
      d, open: ck, prod: PROD[i], ship, close, ids,
      svc: ch.map((x) => x.l.replace("Everest ", "E. ")).join(" + ") || "–",
      cpt: ship ? c / ship : null,
    });
    ids.forEach((o) => (st[o] += U[o]));
    // outlets keep selling every calendar day, Sundays included
    const nx = ds[i + 1] || new Date(d.getTime() + 864e5);
    for (let x = new Date(d); x < nx; x.setDate(x.getDate() + 1))
      N.forEach((_n, o) => (st[o] = Math.max(0, st[o] - sales(ctx, o, x))));
    ck = close;
  });
  return rows;
}
