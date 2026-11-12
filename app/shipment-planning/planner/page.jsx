"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import {
  N, Z, KIT, LL, FL, PK, GN, DAY,
  initialStock, initialExtras, initialCK, initialProd, initialWD, initialWE, initialCapw,
  stk, ckTot, sum, r6, fm, cpt, hv, bcap, dry,
  cover, rule, optCost, dayPlan, pick, weekRows,
} from "./planner";

// Leaflet touches `window`, so the map only loads in the browser
const RouteMap = dynamic(() => import("./RouteMap"), {
  ssr: false,
  loading: () => <div className="h-72 animate-pulse rounded-xl bg-slate-100 sm:h-96 dark:bg-slate-800" />,
});

const COL = ["#e4572e", "#2e86de", "#27ae60", "#8e44ad"];

/* ---------- small ui pieces ---------- */

const card = "rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900";
const title = "text-sm font-semibold";
const mute = "text-xs text-slate-500 dark:text-slate-400";
const th = "px-2 py-1.5 text-left text-xs font-medium text-slate-500 dark:text-slate-400";
const td = "px-2 py-1.5";
const row = "border-t border-slate-100 dark:border-slate-800";
const inp =
  "rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-right text-xs tabular-nums outline-none focus:border-slate-400 focus:bg-white dark:border-slate-700 dark:bg-slate-800 dark:focus:bg-slate-900";

const TONE = {
  red: "bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  amber: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  green: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
};
const Badge = ({ t, children }) => (
  <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${TONE[t]}`}>{children}</span>
);

function Bar({ value, max, over }) {
  const p = Math.min(100, max ? (value / max) * 100 : 0);
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
      <div className={`h-full rounded-full ${over ? "bg-rose-500" : p > 85 ? "bg-amber-400" : "bg-emerald-500"}`} style={{ width: p + "%" }} />
    </div>
  );
}

// collapsible card with a rotating chevron
function Fold({ head, children, open }) {
  return (
    <details open={open} className={`group ${card}`}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0 flex-1">{head}</div>
        <span className="text-lg leading-none text-slate-400 transition group-open:rotate-90">›</span>
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

/* number input that saves on blur or Enter (like the HTML's "change" event),
   so typing never fights the calculated value */
function NumInput({ value, onCommit, step, w = "w-16", pill, label }) {
  const [txt, setTxt] = useState(String(value));
  const [focus, setFocus] = useState(false);
  useEffect(() => {
    if (!focus) setTxt(String(value));
  }, [value, focus]);
  const commit = () => {
    const v = Math.max(0, Number(txt) || 0);
    setTxt(String(v));
    if (v !== value) onCommit(v);
  };
  return (
    <input
      type="number"
      inputMode="numeric"
      min="0"
      step={step}
      aria-label={label}
      value={txt}
      onFocus={() => setFocus(true)}
      onChange={(e) => setTxt(e.target.value)}
      onBlur={() => { setFocus(false); commit(); }}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      className={`${inp} ${w} ${pill ? "rounded-full" : ""}`}
    />
  );
}

const nextWorkingDay = () => {
  const d = new Date();
  if (d.getDay() == 0) d.setDate(d.getDate() + 1);
  return d.toLocaleDateString("en-CA");
};
const round6 = (v) => Math.round(v / 6) * 6;

/* ---------- page ---------- */

export default function PlannerPage() {
  const [date, setDate] = useState("");
  const [days, setDays] = useState(2);
  const [S, setS] = useState(initialStock);
  const [PS, setPS] = useState(initialExtras);
  const [PQ, setPQ] = useState(initialExtras);
  const [CK, setCK] = useState(initialCK);
  const [PROD, setPROD] = useState(initialProd);
  const [WD, setWD] = useState(initialWD);
  const [WE, setWE] = useState(initialWE);
  const [capw, setCapw] = useState(initialCapw);
  const [CKS, setCKS] = useState(4000);

  const [optIdx, setOptIdx] = useState(0); // -1 = outlets picked by hand
  const [manual, setManual] = useState([]);
  const [SELV, setSELV] = useState({});
  const [OV, setOV] = useState({});
  const [OVB, setOVB] = useState({});
  const [OVT, setOVT] = useState({});

  // date is set on the client only (avoids a server/client date mismatch)
  useEffect(() => setDate(nextWorkingDay()), []);

  const d = useMemo(() => (date ? new Date(date + "T00:00") : null), [date]);
  const st = useMemo(() => N.map((_n, o) => stk(S, o)), [S]);
  const ctx = useMemo(() => ({ S, OV, OVB, OVT, CK, WD, WE, CAPW: capw, DAYS: days }), [S, OV, OVB, OVT, CK, WD, WE, capw, days]);
  const sunday = d ? d.getDay() == 0 : false;

  // outlet options come straight from the stock, sales rates and days-of-stock setting
  const OPTS = useMemo(() => (d && !sunday ? rule({ WD, WE, DAYS: days }, st, d) : []), [d, sunday, st, WD, WE, days]);
  const SEL = optIdx >= 0 ? (OPTS[optIdx] ? OPTS[optIdx].ids : []) : manual;
  const FORCE = optIdx >= 0 && OPTS[optIdx] ? OPTS[optIdx].f : null;

  const view = useMemo(() => {
    if (!d || sunday) return null;
    const P = dayPlan(ctx, SEL, true, st, d);
    let totU = 0, veh = 0, dkg = 0, dkc = 0, ctc = 0;
    const trips = P.trips.map((t) => {
      const c = pick(t, true, FORCE, SELV);
      const km = sum(t.ids.map((o, i) => hv(i ? LL[t.ids[i - 1]] : KIT, LL[o])));
      veh += c.veh; totU += t.U;
      if (c.m == "t") { dkg += c.pk / 90; dkc += c.pk; } else ctc += c.pk;
      return { t, c, over: c.used - c.cap, km };
    });
    const snd = FL.map((_f, i) => sum(SEL.map((o) => P.q[o][i])));
    const ckT = ckTot(CK), sT = sum(snd);
    const fillNeed = sum(SEL.map((o) => r6(capw[o] - st[o])));
    return {
      P, trips, totU, veh, dkg, dkc, ctc, tot: veh + dkc + ctc,
      snd, ckT, sT, left: ckT - sT, short: Math.max(0, fillNeed - ckT),
      costs: OPTS.map((op) => optCost(ctx, op, st, d)),
      week: weekRows(ctx, P, PROD, SELV, FORCE, date),
    };
  }, [d, sunday, ctx, SEL, SELV, FORCE, st, capw, CK, PROD, OPTS, date]);

  /* ----- edits (same rules as the HTML) ----- */

  // stock, sales rates, capacity, days of stock or date: re-pick outlets and drop overrides
  const redo = () => { setOptIdx(0); setOV({}); setOVB({}); setOVT({}); setSELV({}); };
  const pickOption = (i) => redo() || setOptIdx(i);
  const toggleOutlet = (o) => {
    setManual(SEL.includes(o) ? SEL.filter((x) => x != o) : SEL.concat(o));
    setOptIdx(-1);
    setSELV({});
  };
  const del = (obj, k) => { const n = { ...obj }; delete n[k]; return n; };
  const editTotal = (o, v) => { setOVT((p) => ({ ...p, [o]: round6(v) })); setOVB((p) => del(p, o)); };
  const editFlavour = (o, i, v) => {
    setOV((p) => ({ ...p, [o + "|" + i]: round6(v) }));
    setOVT((p) => del(p, o)); setOVB((p) => del(p, o));
  };
  const editBoxes = (o, box) => { setOVB((p) => ({ ...p, [o]: box })); setOVT((p) => del(p, o)); };
  const set2d = (setter, o, j, v) => setter((s) => s.map((r, oi) => (oi == o ? r.map((x, ji) => (ji == j ? v : x)) : r)));
  const set1d = (setter, i, v) => setter((a) => a.map((x, k) => (k == i ? v : x)));
  const editStock = (o, i, v) => { set2d(setS, o, i, v); redo(); };

  if (!date) return <div className="p-6 text-sm text-slate-500">Loading…</div>;

  return (
    <div className="min-h-screen bg-slate-50 pb-20 text-sm text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="mx-auto max-w-[1500px] px-3 sm:px-5">
        {/* header */}
        <header className="flex flex-wrap items-center justify-between gap-3 py-4">
          <h1 className="text-lg font-semibold tracking-tight">Shipment planner</h1>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={date}
              onChange={(e) => { if (e.target.value) { setDate(e.target.value); redo(); } }}
              aria-label="Dispatch date"
              className="cursor-pointer rounded-full border border-slate-200 bg-white px-3 py-1.5 dark:border-slate-700 dark:bg-slate-900"
            />
            <label className="flex items-center gap-2 rounded-full border border-slate-200 bg-white py-1 pl-3 pr-1 dark:border-slate-700 dark:bg-slate-900">
              <span className={mute}>Days of stock</span>
              <NumInput value={days} step={0.5} label="Days of stock" onCommit={(v) => { setDays(Math.max(0.5, v || 2)); redo(); }} w="w-14" pill />
            </label>
            <button
              onClick={redo}
              className="cursor-pointer rounded-full border border-slate-200 bg-white px-3 py-1.5 font-medium hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
            >
              Reset
            </button>
          </div>
        </header>

        {!view ? (
          <div className={`${card} text-center font-medium text-rose-600`}>Sunday: kitchen closed. Pick another date.</div>
        ) : (
          <>
            <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[1.1fr_1fr] lg:items-start lg:gap-5">
              {/* left column on desktop */}
              <div className="contents lg:flex lg:flex-col lg:gap-3">
                {/* outlets */}
                <section className={`${card} order-4`}>
                  <div className="mb-2 flex items-center justify-between">
                    <h2 className={title}>Outlets</h2>
                    <span className={mute}>⚡ under {days} days</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {N.map((n, o) => {
                      const cv = cover(ctx, o, d, st[o]);
                      const crit = cv < days;
                      const on = SEL.includes(o);
                      return (
                        <button
                          key={o}
                          onClick={() => toggleOutlet(o)}
                          className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                            on
                              ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900"
                              : "border-slate-200 bg-white hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900"
                          }`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${crit ? "bg-rose-500" : cv < days + 1 ? "bg-amber-400" : "bg-emerald-500"}`} />
                          {crit && "⚡"}
                          {n}
                          <span className="tabular-nums opacity-60">{st[o]} · {cv.toFixed(1)}d</span>
                        </button>
                      );
                    })}
                  </div>
                </section>

                {/* vehicles and boxes */}
                <section className="order-5 flex flex-col gap-3">
                  <h2 className={`${title} px-1`}>Vehicles</h2>
                  {view.trips.length == 0 && <div className={`${card} ${mute}`}>No outlet selected.</div>}
                  {view.trips.map(({ t, c, over, km }, ti) => (
                    <div key={t.key} className={card} style={{ borderLeft: `4px solid ${COL[ti % 4]}` }}>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-semibold">Trip {ti + 1}</div>
                          <div className={mute}>{t.ids.map((o) => N[o]).join(" → ")}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-semibold tabular-nums">{t.U} tarts</div>
                          <div className={mute}>{Math.round(km)} km{Z[t.ids[0]] == "P" ? " · Pune" : ""}</div>
                        </div>
                      </div>

                      <select
                        value={c.k}
                        onChange={(e) => setSELV((p) => ({ ...p, [t.key]: e.target.value }))}
                        className="mt-2 w-full cursor-pointer rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800"
                      >
                        {t.o.map((v) => (
                          <option key={v.k} value={v.k}>
                            {v.l} · {fm(v.c)}{v.valid ? "" : " · won’t fit"}
                          </option>
                        ))}
                      </select>

                      <div className="mt-2 flex items-center gap-2">
                        <Bar value={c.used} max={c.cap} over={over > 0} />
                        <span className="whitespace-nowrap text-xs tabular-nums">
                          {c.used}/{c.cap} {c.m == "c" ? "cartons" : "slots"}
                        </span>
                        {over > 0 && <Badge t="red">−{over}</Badge>}
                        {c.k != "pv" && t.ids.length < 4 && <Badge t="amber">under 4 stops</Badge>}
                      </div>

                      <div className="mt-2">
                        {t.ids.map((o, i) => {
                          const bx = c.bx[i];
                          return (
                            <div key={o} className={`${row} flex flex-wrap items-center justify-between gap-2 py-1.5`}>
                              <div>
                                <div className="font-medium">{N[o]}</div>
                                <div className={mute}>
                                  {view.P.u[o]} tarts · holds {bcap(bx)}{c.m == "t" ? ` · ${dry(o, bx).toFixed(1)} kg ice` : ""}
                                </div>
                              </div>
                              <div className="flex items-center gap-1 text-xs text-slate-500">
                                {c.m == "c" ? (
                                  <>
                                    <NumInput value={bx.c} label={`${N[o]} cartons`} onCommit={(v) => editBoxes(o, { m: "c", c: v })} w="w-14" />
                                    cartons
                                  </>
                                ) : (
                                  <>
                                    <NumInput value={bx.a} label={`${N[o]} 60L boxes`} onCommit={(v) => editBoxes(o, { m: "t", a: v, b: bx.b })} w="w-12" />
                                    ×60L
                                    <NumInput value={bx.b} label={`${N[o]} 30L boxes`} onCommit={(v) => editBoxes(o, { m: "t", a: bx.a, b: v })} w="w-12" />
                                    ×30L
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div className={`${row} mt-1 flex items-center justify-between pt-2`}>
                        <span className={mute}>
                          {fm(c.veh)} + {c.m == "c" ? "cartons" : "ice"} {fm(c.pk)}
                        </span>
                        <span className="font-semibold tabular-nums">
                          {fm(c.c)} <span className="font-normal text-slate-500">· {cpt(c.c / t.U)}/tart</span>
                        </span>
                      </div>
                    </div>
                  ))}
                </section>

                {/* quantities and stock */}
                <section className="order-6 flex flex-col gap-3">
                  <h2 className={`${title} px-1`}>Quantities</h2>
                  {SEL.length == 0 && <div className={`${card} ${mute}`}>No outlet selected.</div>}
                  {SEL.map((o) => {
                    const U = view.P.u[o], after = st[o] + U, rm = capw[o] - after;
                    const cv = cover(ctx, o, d, st[o]);
                    return (
                      <Fold
                        key={o}
                        head={
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold">{N[o]}</span>
                              <span className="tabular-nums">{U} <span className={mute}>({U / 6} trays)</span></span>
                              {rm < 0 && <Badge t="red">−{-rm} over</Badge>}
                              {Z[o] == "P" && after > 918 && rm >= 0 && <Badge t="amber">above 918</Badge>}
                              {U < r6(capw[o] - st[o]) && <Badge t="amber">partial fill</Badge>}
                            </div>
                            <div className="mt-1.5 flex items-center gap-2">
                              <Bar value={after} max={capw[o]} over={rm < 0} />
                              <span className="whitespace-nowrap text-xs tabular-nums text-slate-500">{after}/{capw[o]}</span>
                            </div>
                          </div>
                        }
                      >
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <label className="flex items-center gap-2">
                            <span className={mute}>Total</span>
                            <NumInput value={U} step={6} label={`${N[o]} total tarts`} onCommit={(v) => editTotal(o, v)} w="w-20" />
                          </label>
                          <span className={mute}>{cv.toFixed(1)} days left · {WD[o]}/day · {WE[o]} weekends</span>
                        </div>

                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead><tr><th className={th}>Tarts</th><th className={th}>Stock</th><th className={th}>Send</th></tr></thead>
                            <tbody>
                              {FL.map((f, i) =>
                                S[o][i] == null ? null : (
                                  <tr key={f[0]} className={row}>
                                    <td className={td}>{f[0]}</td>
                                    <td className={td}><NumInput value={S[o][i]} label={`${f[0]} stock`} onCommit={(v) => editStock(o, i, v)} /></td>
                                    <td className={td}><NumInput value={view.P.q[o][i]} step={6} label={`${f[0]} send`} onCommit={(v) => editFlavour(o, i, v)} /></td>
                                  </tr>
                                )
                              )}
                            </tbody>
                          </table>

                          <table className="mt-3 w-full text-xs">
                            <thead><tr><th className={th}>Packaging</th><th className={th}>Stock</th><th className={th}>Send</th></tr></thead>
                            <tbody>
                              {PK.map((n, j) => (
                                <tr key={n} className={row}>
                                  <td className={td}>{n}</td>
                                  <td className={td}><NumInput value={PS[o][j]} label={`${n} stock`} onCommit={(v) => set2d(setPS, o, j, v)} /></td>
                                  <td className={td}><NumInput value={PQ[o][j]} label={`${n} send`} onCommit={(v) => set2d(setPQ, o, j, v)} /></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>

                          <table className="mt-3 w-full text-xs">
                            <thead><tr><th className={th}>Garnishing (g)</th><th className={th}>Stock</th><th className={th}>Send</th></tr></thead>
                            <tbody>
                              {GN.map((n, k) => (
                                <tr key={n} className={row}>
                                  <td className={td}>{n}</td>
                                  <td className={td}><NumInput value={PS[o][k + 4]} label={`${n} stock`} onCommit={(v) => set2d(setPS, o, k + 4, v)} /></td>
                                  <td className={td}><NumInput value={PQ[o][k + 4]} label={`${n} send`} onCommit={(v) => set2d(setPQ, o, k + 4, v)} /></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </Fold>
                    );
                  })}
                </section>
              </div>

              {/* right column on desktop: sticky, scrolls inside */}
              <aside className="contents lg:sticky lg:top-3 lg:flex lg:max-h-[calc(100vh-1.5rem)] lg:flex-col lg:gap-3 lg:overflow-y-auto">
                {/* cost */}
                <section className="order-1 rounded-2xl bg-slate-900 p-4 text-white shadow-sm dark:bg-slate-800">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <div className="text-xs text-slate-400">Cost per tart</div>
                      <div className="text-4xl font-semibold tabular-nums tracking-tight">
                        {view.totU ? cpt(view.tot / view.totU) : "–"}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xl font-semibold tabular-nums">{fm(view.tot)}</div>
                      <div className="text-xs text-slate-400">{view.totU} tarts</div>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
                    {view.trips.map(({ c }, ti) => (
                      <span key={ti} className="flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1">
                        <span className="h-2 w-2 rounded-full" style={{ background: COL[ti % 4] }} />
                        {c.l} · {fm(c.veh)}
                      </span>
                    ))}
                    {view.dkg > 0 && (
                      <span className="rounded-full bg-white/10 px-2.5 py-1">Dry ice {view.dkg.toFixed(1)} kg · {fm(view.dkc)}</span>
                    )}
                    {view.ctc > 0 && <span className="rounded-full bg-white/10 px-2.5 py-1">Cartons {fm(view.ctc)}</span>}
                    {view.trips.length == 0 && <span className="text-slate-400">No trips</span>}
                  </div>
                </section>

                {/* options */}
                {OPTS.length > 0 && (
                  <section className={`${card} order-2`}>
                    <h2 className={`${title} mb-2`}>Options</h2>
                    <div className="flex flex-col gap-1.5">
                      {OPTS.map((op, i) => (
                        <button
                          key={i}
                          onClick={() => pickOption(i)}
                          className={`flex cursor-pointer items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-xs transition ${
                            i == optIdx
                              ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900"
                              : "border-slate-200 hover:border-slate-400 dark:border-slate-700"
                          }`}
                        >
                          <span className="font-medium">{op.l}</span>
                          <span className="whitespace-nowrap tabular-nums opacity-70">
                            {op.ids.length} outlets{view.costs[i] == null ? "" : ` · ${cpt(view.costs[i])}/tart`}
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                )}

                {/* kitchen stock */}
                <div className="order-3">
                  <Fold
                    head={
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={title}>Kitchen</span>
                        <span className="tabular-nums">{view.ckT} in stock</span>
                        <span className={mute}>sending {view.sT}</span>
                        {view.short > 0 ? <Badge t="red">short {view.short}</Badge> : <Badge t="green">{view.left} left</Badge>}
                      </div>
                    }
                  >
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead><tr><th className={th}>Flavour</th><th className={th}>In CK</th><th className={th}>Sending</th><th className={th}>Left</th></tr></thead>
                        <tbody>
                          {FL.map((f, i) => (
                            <tr key={f[0]} className={row}>
                              <td className={td}>{f[0]}</td>
                              <td className={td}><NumInput value={CK[i]} step={6} label={`${f[0]} in CK`} onCommit={(v) => set1d(setCK, i, v)} /></td>
                              <td className={`${td} tabular-nums`}>{view.snd[i]}</td>
                              <td className={`${td} tabular-nums ${CK[i] - view.snd[i] < 0 ? "font-semibold text-rose-600" : ""}`}>{CK[i] - view.snd[i]}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Fold>
                </div>

                {/* map */}
                <section className={`${card} order-7`}>
                  <h2 className={`${title} mb-2`}>Route</h2>
                  <RouteMap trips={view.P.trips.map((t) => ({ ids: t.ids }))} />
                </section>
              </aside>
            </div>

            {/* week plan */}
            <section className={`${card} mt-5`}>
              <h2 className={`${title} mb-2`}>Next 6 working days</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr>{["Day", "Open", "Prod", "Outlets", "Sent", "Close", "Service", "₹/tart"].map((h) => <th key={h} className={th}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {view.week.map((r, i) => (
                      <tr key={i} className={`${row} hover:bg-slate-50 dark:hover:bg-slate-800/50`}>
                        <td className={`${td} whitespace-nowrap font-medium`}>{DAY[r.d.getDay()]} {r.d.getDate()}</td>
                        <td className={`${td} tabular-nums`}>{Math.round(r.open)}</td>
                        <td className={td}><NumInput value={r.prod} label={`Production day ${i + 1}`} onCommit={(v) => set1d(setPROD, i, v)} /></td>
                        <td className={td}>{r.ids.map((o) => N[o]).join(", ") || "–"}</td>
                        <td className={`${td} tabular-nums`}>{r.ship}</td>
                        <td className={`${td} tabular-nums ${r.close < 0 || r.close > CKS ? "font-semibold text-rose-600" : ""}`}>{Math.round(r.close)}</td>
                        <td className={`${td} whitespace-nowrap`}>{r.svc}</td>
                        <td className={`${td} tabular-nums`}>{r.cpt == null ? "–" : cpt(r.cpt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* data */}
            <section className="mt-3 flex flex-col gap-3">
              <Fold head={<span className={title}>Sales and freezer capacity</span>}>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr><th className={th}>Outlet</th><th className={th}>Weekday</th><th className={th}>Weekend</th><th className={th}>Freezer</th></tr></thead>
                    <tbody>
                      {N.map((n, o) => (
                        <tr key={n} className={row}>
                          <td className={td}>{n}</td>
                          <td className={td}><NumInput value={WD[o]} label={`${n} weekday sales`} onCommit={(v) => { set1d(setWD, o, v); redo(); }} /></td>
                          <td className={td}><NumInput value={WE[o]} label={`${n} weekend sales`} onCommit={(v) => { set1d(setWE, o, v); redo(); }} /></td>
                          <td className={td}><NumInput value={capw[o]} label={`${n} freezer capacity`} onCommit={(v) => { set1d(setCapw, o, v); redo(); }} w="w-20" /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <label className="mt-3 flex items-center gap-2">
                  <span className={mute}>Kitchen storage limit</span>
                  <NumInput value={CKS} label="Kitchen storage limit" onCommit={setCKS} w="w-20" />
                </label>
              </Fold>

              <Fold head={<span className={title}>Stock of every outlet</span>}>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr>
                        <th className={th}>Outlet</th>
                        {FL.map((f) => <th key={f[0]} className={`${th} whitespace-nowrap`}>{f[0]}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {N.map((n, o) => (
                        <tr key={n} className={row}>
                          <td className={`${td} whitespace-nowrap font-medium`}>{n}</td>
                          {FL.map((f, i) => (
                            <td key={f[0]} className={td}>
                              {S[o][i] == null ? "–" : <NumInput value={S[o][i]} label={`${n} ${f[0]} stock`} onCommit={(v) => editStock(o, i, v)} w="w-14" />}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Fold>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
