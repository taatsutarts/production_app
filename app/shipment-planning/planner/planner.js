/* Taatsu Shipment Planner: pure logic, ported 1:1 from shipment_planner_v3.html.
   No React in here. Every function that used a global in the HTML now takes
   a `ctx` = { S, OV, OVB, OVT, CK } instead. */

const _ = null;

/* ---------- data (from the HTML) ---------- */

export const N = ["Gamdevi","Worli","Juhu","Andheri West","Goregaon","Malad","Borivali West","Marol","Powai","Thane","Baner","Kalyani Nagar","Bandra","Matunga","Kandivali"];
export const CAP  = [918,918,918,918,918,918,918,918,918,918,918,918,810,1500,1500];
export const CAPW = CAP.map((c, o) => (o == 10 || o == 11 ? 1150 : c));
export const PERF = [9,8,7,9,4,4,2,7,5,2,7,8,9,12,8];
export const TRIG = N.map((_n, o) => (o == 13 || o == 14 ? 450 : o == 5 || o == 6 ? 250 : o == 9 ? 120 : 300));
export const DROP = N.map((_n, o) => (o == 13 || o == 14 ? 700 : o == 10 || o == 11 ? 850 : o == 9 ? 300 : 550));
export const RNG  = N.map((_n, o) => (o == 13 || o == 14 ? "600–800" : o == 10 || o == 11 ? "800–900" : o == 9 ? "~300" : "500–600"));
export const LL = [[18.96,72.81],[19.017,72.818],[19.1,72.827],[19.136,72.83],[19.165,72.85],[19.187,72.848],[19.229,72.857],[19.116,72.88],[19.118,72.905],[19.218,72.978],[18.559,73.787],[18.548,73.902],[19.06,72.836],[19.027,72.85],[19.205,72.855]];
export const Z = "CCWWWWWEEEPPWCW";
export const NEAR = [1,1,0,0,0,0,0,0,0,0,0,0,1,1,0];
export const KIT = [18.969, 72.813];
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

/* ---------- initial editable state ---------- */

// negative values are system errors: treat as 0
export const initialStock = () => N.map((_n, o) => FL.map((f) => (f[2][o] == null ? null : Math.max(0, f[2][o]))));
export const initialExtras = () => N.map(() => XI.map(() => 0));
export const r6 = (v) => Math.floor(Math.max(0, v) / 6) * 6;
export const initialCK = () => FL.map((f) => (f[1] ? r6((3800 * f[1]) / 99.6) : 0));
export const initialProd = () => [1500, 1500, 1500, 1500, 1500, 1500];

/* ---------- helpers ---------- */

export const sum = (a) => a.reduce((x, y) => x + y, 0);
export const stk = (S, o) => sum(S[o].map((v) => Math.max(0, v || 0)));
export const ckTot = (CK) => sum(CK);
export const SALES = PERF.map((p) => (1500 * p) / 101);
export const fm = (n) => "₹" + Math.round(n).toLocaleString("en-IN");
export const cpt = (n) => "₹" + n.toFixed(1);

// straight-line distance estimate x 1.35 road factor
export const hv = (a, b) => 111 * Math.hypot(a[0] - b[0], (a[1] - b[1]) * 0.95) * 1.35;

/* ---------- boxes ---------- */

// thermocol boxes for U tarts: a = 60L boxes, b = 30L boxes
export function thA(U) {
  const tr = Math.ceil(U / 6);
  let a = Math.floor(tr / 48), r = tr % 48, b = 0;
  if (r > 0) { if (r <= 16) b = 1; else a++; }
  return { m: "t", a, b };
}
export const bcap = (b) => (b.m == "c" ? b.c * 192 : b.a * 288 + b.b * 96);
export const dry = (o, b) =>
  Z[o] == "P" ? b.a * 3.5 + b.b * 2 : NEAR[o] ? b.a * 0.225 + b.b * 0.1 : b.a * 0.55 + b.b * 0.4;

export function box(ctx, o, U, m, ov) {
  const x = ov && ctx.OVB[o];
  if (x && x.m == m) return x;
  return m == "t" ? thA(U) : { m: "c", c: Math.ceil(U / 192) };
}

/* ---------- flavour split ---------- */

export function split(ctx, o, TOT, ov) {
  const { S, OV } = ctx;
  const q = FL.map(() => 0);
  const cl = FL.map((f, i) => f[1] && S[o][i] != null);
  const ss = sum(FL.map((f, i) => (!f[1] && S[o][i] != null && ov && OV[o + "|" + i] != null ? OV[o + "|" + i] : 0)));
  const bud = Math.max(0, TOT - ss);
  const cp = sum(FL.map((f, i) => (cl[i] ? f[1] : 0)));
  const sc = sum(FL.map((f, i) => (cl[i] ? S[o][i] : 0)));
  const L = sc + bud;
  const w = FL.map((f, i) => (cl[i] ? Math.max(0, (L * f[1]) / cp - S[o][i]) : 0));
  const ws = sum(w);
  FL.forEach((f, i) => {
    if (S[o][i] == null) return;
    if (cl[i]) q[i] = r6(ws ? (w[i] / ws) * bud : (bud * f[1]) / cp);
    if (ov && OV[o + "|" + i] != null) q[i] = OV[o + "|" + i];
  });
  return q;
}

/* ---------- trips ---------- */

// nearest-neighbour from the kitchen
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

// west+central and east never share a trip when both are present; Pune is its own trip; max 5 drops
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

// vehicle options for one trip, valid first then cheapest
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

export function dayPlan(ctx, sel, ov) {
  const { S, OVB, OVT, CK } = ctx;
  const T = {};
  sel.forEach((o) => (T[o] = r6(Math.min(DROP[o], CAPW[o] - stk(S, o)))));
  const need = sum(sel.map((o) => T[o])), av = ckTot(CK);
  if (need > av && need > 0) sel.forEach((o) => (T[o] = r6((T[o] * av) / need)));
  if (ov)
    sel.forEach((o) => {
      if (OVB[o]) T[o] = Math.min(bcap(OVB[o]), r6(CAPW[o] - stk(S, o)));
      if (OVT[o] != null) T[o] = OVT[o];
    });
  const q = {}, u = {};
  sel.forEach((o) => { q[o] = split(ctx, o, T[o], ov); u[o] = sum(q[o]); });
  const ids = sel.filter((o) => u[o] > 0);
  return {
    q, u,
    tot: sum(sel.map((o) => u[o])),
    trips: mkTrips(ids).map((t) => ({ ids: t, key: t.join("-"), U: sum(t.map((o) => u[o])), o: opts(ctx, t, u, ov) })),
  };
}

export function pick(t, us, SELV) {
  const x = us && SELV[t.key] && t.o.find((v) => v.k == SELV[t.key]);
  return x || t.o.find((z) => z.valid) || t.o[0];
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

export function weekRows(ctx, P, PROD, SELV, dateStr) {
  const { S, CK } = ctx;
  const st = N.map((_n, o) => stk(S, o));
  const rows = [];
  let ck = ckTot(CK);
  wdays(dateStr).forEach((d, i) => {
    let U = {}, trips;
    if (i == 0) { U = P.u; trips = P.trips; }
    else {
      let left = ck;
      N.map((_n, o) => o)
        .filter((o) => st[o] <= TRIG[o])
        .sort((a, b) => st[a] / TRIG[a] - st[b] / TRIG[b])
        .forEach((o) => {
          const g = Math.min(r6(DROP[o]), r6(CAPW[o] - st[o]), r6(left));
          if (g > 0) { U[o] = g; left -= g; }
        });
      trips = mkTrips(Object.keys(U).map(Number)).map((t) => ({ ids: t, key: t.join("-"), U: sum(t.map((o) => U[o])), o: opts(ctx, t, U, false) }));
    }
    const ids = Object.keys(U).map(Number).filter((o) => U[o] > 0);
    const ship = sum(ids.map((o) => U[o]));
    const ch = trips.map((t) => pick(t, i == 0, SELV));
    const c = sum(ch.map((x) => x.c));
    const close = ck - ship + PROD[i];
    rows.push({
      d, open: ck, prod: PROD[i], ship, close, ids,
      svc: ch.map((x) => x.l.replace("Everest ", "E. ")).join(" + ") || "–",
      cpt: ship ? c / ship : null,
    });
    ids.forEach((o) => (st[o] += U[o]));
    N.forEach((_n, o) => (st[o] = Math.max(0, st[o] - SALES[o])));
    ck = close;
  });
  return rows;
}