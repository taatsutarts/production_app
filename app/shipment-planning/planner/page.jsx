"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import {
  N, CAPW, TRIG, RNG, Z, LL, KIT, FL, PK, GN, DAY,
  initialStock, initialExtras, initialCK, initialProd,
  stk, ckTot, sum, fm, cpt, hv, bcap, dry,
  dayPlan, pick, weekRows,
} from "./planner";

// Leaflet touches `window`, so it only loads in the browser
const RouteMap = dynamic(() => import("./RouteMap"), {
  ssr: false,
  loading: () => <div className="h-72 animate-pulse rounded-lg bg-slate-200 sm:h-96 dark:bg-slate-700" />,
});

const COL = ["#e4572e", "#2e86de", "#27ae60", "#8e44ad"];

const card = "rounded-xl border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-800";
const h2 = "mb-1 mt-5 text-sm font-bold";
const muted = "text-xs text-slate-500 dark:text-slate-400";
const th = "px-1.5 py-1 text-left font-medium text-slate-500 dark:text-slate-400";
const td = "px-1.5 py-1";
const inp =
  "w-16 rounded-md border border-slate-300 bg-white px-1.5 py-1 text-right text-xs tabular-nums dark:border-slate-600 dark:bg-slate-900";

const todayStr = () => new Date().toLocaleDateString("en-CA");
const nextWorkingDay = () => {
  const d = new Date();
  if (d.getDay() == 0) d.setDate(d.getDate() + 1);
  return d.toLocaleDateString("en-CA");
};

/* Number input that commits on blur / Enter, like the HTML's "change" event,
   so typing never fights the computed value. */
function NumInput({ value, onCommit, step, className = inp, label }) {
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
      className={className}
    />
  );
}

export default function PlannerPage() {
  const [date, setDate] = useState("");
  const [S, setS] = useState(initialStock);
  const [PS, setPS] = useState(initialExtras);
  const [PQ, setPQ] = useState(initialExtras);
  const [CK, setCK] = useState(initialCK);
  const [PROD, setPROD] = useState(initialProd);
  const [SEL, setSEL] = useState([]);
  const [SELV, setSELV] = useState({});
  const [OV, setOV] = useState({});
  const [OVB, setOVB] = useState({});
  const [OVT, setOVT] = useState({});

  const autoSel = (stock) => N.map((_n, o) => o).filter((o) => stk(stock, o) <= TRIG[o]);

  // set the date on the client only (avoids a server/client date mismatch)
  useEffect(() => {
    setDate(nextWorkingDay());
    setSEL(autoSel(S));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // date change or Reset: re-pick outlets, drop all overrides (stock edits stay)
  const resetEdits = () => {
    setSEL(autoSel(S));
    setOV({}); setOVB({}); setOVT({}); setSELV({});
  };
  const onDate = (v) => {
    if (!v) return;
    setDate(v);
    resetEdits();
  };

  const dow = date ? new Date(date + "T00:00").getDay() : -1;

  const view = useMemo(() => {
    if (!date || dow == 0) return null;
    const ctx = { S, OV, OVB, OVT, CK };
    const P = dayPlan(ctx, SEL, true);
    let totU = 0, veh = 0, dkg = 0, dkc = 0, ctc = 0;
    const trips = P.trips.map((t) => {
      const c = pick(t, true, SELV);
      const km = sum(t.ids.map((o, i) => hv(i ? LL[t.ids[i - 1]] : KIT, LL[o])));
      veh += c.veh; totU += t.U;
      if (c.m == "t") { dkg += c.pk / 90; dkc += c.pk; } else ctc += c.pk;
      return { t, c, over: c.used - c.cap, km };
    });
    const snd = FL.map((_f, i) => sum(SEL.map((o) => P.q[o][i])));
    const sT = sum(snd);
    return {
      P, trips, totU, veh, dkg, dkc, ctc,
      tot: veh + dkc + ctc,
      snd, sT, ckT: ckTot(CK), left: ckTot(CK) - sT,
      week: weekRows(ctx, P, PROD, SELV, date),
    };
  }, [date, dow, S, OV, OVB, OVT, CK, SEL, SELV, PROD]);

  /* ----- edit handlers (same rules as the HTML) ----- */

  const toggleOutlet = (o) => {
    setSEL((s) => (s.includes(o) ? s.filter((x) => x != o) : s.concat(o)));
    setSELV({});
  };
  const dropKeys = (obj, key) => { const n = { ...obj }; delete n[key]; return n; };
  const editTotal = (o, v) => { setOVT((p) => ({ ...p, [o]: v })); setOVB((p) => dropKeys(p, o)); };
  const editFlavour = (o, i, v) => {
    setOV((p) => ({ ...p, [o + "|" + i]: v }));
    setOVT((p) => dropKeys(p, o)); setOVB((p) => dropKeys(p, o));
  };
  const editBoxes = (o, box) => { setOVB((p) => ({ ...p, [o]: box })); setOVT((p) => dropKeys(p, o)); };
  const editStock = (o, i, v) => setS((s) => s.map((row, oi) => (oi == o ? row.map((x, fi) => (fi == i ? v : x)) : row)));
  const editExtra = (setter, o, j, v) => setter((s) => s.map((row, oi) => (oi == o ? row.map((x, ji) => (ji == j ? v : x)) : row)));

  if (!date) return <div className="mx-auto max-w-3xl p-3 text-sm text-slate-500">Loading planner…</div>;

  return (
    <div className="mx-auto max-w-3xl p-3 pb-16 text-sm text-slate-900 dark:text-slate-100">
      <h1 className="text-lg font-bold">🍰 Taatsu Shipment Planner</h1>

      {/* 1 · header */}
      <div className={`${card} mt-2 flex flex-wrap items-end gap-3`}>
        <div>
          <label className={muted}>Dispatch date</label>
          <br />
          <input
            type="date"
            value={date}
            onChange={(e) => onDate(e.target.value)}
            className="cursor-pointer rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900"
          />
        </div>
        <button
          onClick={resetEdits}
          className="cursor-pointer rounded-md border border-slate-300 px-3 py-1 text-sm dark:border-slate-600"
        >
          Reset edits
        </button>
      </div>

      {!view ? (
        <div className={`${card} mt-3 font-semibold text-red-600`}>Sunday: kitchen closed. Pick another date.</div>
      ) : (
        <>
          {/* 2 · cost box */}
          <div className={`${card} mt-3`}>
            <div className={muted}>Cost of this shipment</div>
            <div className="text-xl font-bold">{view.totU ? cpt(view.tot / view.totU) + " per tart" : "–"}</div>
            {view.trips.length == 0 && <div className={muted}>No trips yet.</div>}
            {view.trips.map(({ c }, ti) => (
              <div key={ti}>
                Trip {ti + 1} · {c.l} · <b>{fm(c.veh)}</b>
              </div>
            ))}
            {view.dkg > 0 && <div>Dry ice: <b>{view.dkg.toFixed(1)} kg</b> · <b>{fm(view.dkc)}</b></div>}
            {view.ctc > 0 && <div>Cartons: <b>{fm(view.ctc)}</b></div>}
            <div>Total <b>{fm(view.tot)}</b> for {view.totU} tarts</div>
          </div>

          {/* 3 · central kitchen stock */}
          <h2 className={h2}>1 · Central kitchen stock</h2>
          <details open className={card}>
            <summary className="cursor-pointer">
              <b>{view.ckT} in CK</b> · sending {view.sT} ·{" "}
              {view.left < 0 ? (
                <span className="font-semibold text-red-600">−{-view.left} short</span>
              ) : (
                <span className="font-semibold text-green-600">{view.left} left</span>
              )}
            </summary>
            <div className="mt-1 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr><th className={th}>Flavour</th><th className={th}>In CK</th><th className={th}>Sending</th><th className={th}>Left</th></tr>
                </thead>
                <tbody>
                  {FL.map((f, i) => (
                    <tr key={f[0]} className="border-t border-slate-100 dark:border-slate-700">
                      <td className={td}>{f[0]}</td>
                      <td className={td}>
                        <NumInput value={CK[i]} step={6} label={`${f[0]} in CK`} onCommit={(v) => setCK((c) => c.map((x, k) => (k == i ? v : x)))} />
                      </td>
                      <td className={td}>{view.snd[i]}</td>
                      <td className={`${td} ${CK[i] - view.snd[i] < 0 ? "font-semibold text-red-600" : ""}`}>{CK[i] - view.snd[i]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={muted}>Example: 3,800 split by sales mix. Replace with your real closing stock.</div>
          </details>

          {/* 4 · outlets */}
          <h2 className={h2}>2 · Outlets</h2>
          <div className={card}>
            <div className="flex flex-wrap gap-1.5">
              {N.map((n, o) => (
                <button
                  key={o}
                  onClick={() => toggleOutlet(o)}
                  className={`cursor-pointer rounded-full border px-2.5 py-1 text-xs ${
                    SEL.includes(o)
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-slate-300 dark:border-slate-600"
                  }`}
                >
                  {stk(S, o) <= TRIG[o] ? "⚡ " : ""}{n} {stk(S, o)}/{TRIG[o]}
                </button>
              ))}
            </div>
            <div className={`${muted} mt-1`}>
              ⚡ = stock at or below its reorder point (stock/trigger). These are auto-picked. Tap to add or remove.
            </div>
          </div>

          {/* 5 · vehicle and boxes */}
          <h2 className={h2}>3 · Vehicle and boxes</h2>
          <div className={muted}>
            Everest small: 5×60L+2×30L or 6×60L · Everest large (no freezer): 14×60L · Everest freezer: 21 cartons · Private 3-wheeler: 12×60L. Freezer van uses cartons only; other vehicles use thermocol and dry ice.
          </div>
          {view.trips.length == 0 && <div className={`${card} ${muted} mt-1`}>No outlet selected.</div>}
          {view.trips.map(({ t, c, over, km }, ti) => (
            <div key={t.key} className={`${card} mt-1.5`}>
              <b style={{ color: COL[ti % 4] }}>Trip {ti + 1}</b> · {t.ids.map((o, i) => `${i + 1}. ${N[o]}`).join(" → ")}
              <div className={muted}>
                {t.U} tarts · ~{Math.round(km)} km{Z[t.ids[0]] == "P" ? " · Pune run" : ""}
              </div>
              <select
                value={c.k}
                onChange={(e) => setSELV((p) => ({ ...p, [t.key]: e.target.value }))}
                className="my-1 w-full cursor-pointer rounded-md border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-900"
              >
                {t.o.map((v) => (
                  <option key={v.k} value={v.k}>
                    {v.l} · {fm(v.c)}{v.valid ? "" : " · won’t fit"}
                  </option>
                ))}
              </select>
              <div>
                {c.m == "c" ? "Cartons" : "Space (60L slots; 30L = ½)"}: <b>{c.used}</b> of {c.cap}{" "}
                {over > 0 ? (
                  <span className="font-semibold text-red-600">−{over} over, won’t fit</span>
                ) : (
                  <span className="font-semibold text-green-600">{c.cap - c.used} free</span>
                )}
              </div>
              {t.ids.map((o, i) => {
                const bx = c.bx[i];
                return (
                  <div key={o} className="border-t border-slate-100 py-1 dark:border-slate-700">
                    <b>{N[o]}</b> · {view.P.u[o]} tarts →{" "}
                    {c.m == "c" ? (
                      <>
                        <NumInput value={bx.c} label={`${N[o]} cartons`} onCommit={(v) => editBoxes(o, { m: "c", c: v })} /> cartons
                      </>
                    ) : (
                      <>
                        <NumInput value={bx.a} label={`${N[o]} 60L boxes`} onCommit={(v) => editBoxes(o, { m: "t", a: v, b: bx.b })} />×60L{" "}
                        <NumInput value={bx.b} label={`${N[o]} 30L boxes`} onCommit={(v) => editBoxes(o, { m: "t", a: bx.a, b: v })} />×30L
                      </>
                    )}
                    <div className={muted}>
                      boxes hold up to {bcap(bx)} tarts{c.m == "t" ? ` · dry ice ${dry(o, bx).toFixed(1)} kg` : ""}
                    </div>
                  </div>
                );
              })}
              <div>
                Vehicle {fm(c.veh)} + {c.m == "c" ? "cartons" : "dry ice"} {fm(c.pk)} = <b>{fm(c.c)}</b> ·{" "}
                <b>{cpt(c.c / t.U)}</b> per tart
              </div>
            </div>
          ))}

          {/* 6 · quantities and stock */}
          <h2 className={h2}>4 · Quantities and stock</h2>
          {SEL.map((o) => {
            const st = stk(S, o), U = view.P.u[o], after = st + U, rm = CAPW[o] - after;
            const minDrop = o == 13 || o == 14 ? 600 : o > 9 && o < 12 ? 800 : o == 9 ? 200 : 500;
            return (
              <details key={o} className={`${card} mt-1.5`}>
                <summary className="cursor-pointer">
                  <b>{N[o]}</b> · send {U} ({U / 6} trays) · stock {st}/{CAPW[o]}{" "}
                  {rm < 0 ? (
                    <span className="font-semibold text-red-600">−{-rm} over</span>
                  ) : (
                    <span className="font-semibold text-green-600">{rm} space</span>
                  )}
                </summary>
                <div className={muted}>Usual drop {RNG[o]} · reorder at {TRIG[o]}</div>
                {U > 0 && U < minDrop && <div className="font-semibold text-amber-600">Below your usual minimum drop.</div>}
                {Z[o] == "P" && after > 918 && rm >= 0 && (
                  <div className="font-semibold text-amber-600">Above official 918, within real ~1,150 capacity.</div>
                )}
                <div className="my-1">
                  Total tarts to send{" "}
                  <NumInput value={U} step={6} label={`${N[o]} total tarts`} onCommit={(v) => editTotal(o, v)} />{" "}
                  <span className={muted}>edits scale all flavours</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="mb-2 w-full text-xs">
                    <thead><tr><th className={th}>Tarts</th><th className={th}>Stock</th><th className={th}>Send</th></tr></thead>
                    <tbody>
                      {FL.map((f, i) =>
                        S[o][i] == null ? null : (
                          <tr key={f[0]} className="border-t border-slate-100 dark:border-slate-700">
                            <td className={td}>{f[0]}</td>
                            <td className={td}><NumInput value={S[o][i]} label={`${f[0]} stock at ${N[o]}`} onCommit={(v) => editStock(o, i, v)} /></td>
                            <td className={td}><NumInput value={view.P.q[o][i]} step={6} label={`${f[0]} send to ${N[o]}`} onCommit={(v) => editFlavour(o, i, v)} /></td>
                          </tr>
                        )
                      )}
                    </tbody>
                  </table>
                  <table className="mb-2 w-full text-xs">
                    <thead><tr><th className={th}>Packaging (pcs)</th><th className={th}>Stock</th><th className={th}>Send</th></tr></thead>
                    <tbody>
                      {PK.map((n, j) => (
                        <tr key={n} className="border-t border-slate-100 dark:border-slate-700">
                          <td className={td}>{n}</td>
                          <td className={td}><NumInput value={PS[o][j]} label={`${n} stock`} onCommit={(v) => editExtra(setPS, o, j, v)} /></td>
                          <td className={td}><NumInput value={PQ[o][j]} label={`${n} send`} onCommit={(v) => editExtra(setPQ, o, j, v)} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <table className="w-full text-xs">
                    <thead><tr><th className={th}>Garnishing (grams)</th><th className={th}>Stock</th><th className={th}>Send</th></tr></thead>
                    <tbody>
                      {GN.map((n, k) => {
                        const j = k + 4;
                        return (
                          <tr key={n} className="border-t border-slate-100 dark:border-slate-700">
                            <td className={td}>{n}</td>
                            <td className={td}><NumInput value={PS[o][j]} label={`${n} stock`} onCommit={(v) => editExtra(setPS, o, j, v)} /></td>
                            <td className={td}><NumInput value={PQ[o][j]} label={`${n} send`} onCommit={(v) => editExtra(setPQ, o, j, v)} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className={muted}>* seasonal: you decide. Packaging and garnishing do not affect cost.</div>
              </details>
            );
          })}

          {/* 7 · route map */}
          <h2 className={h2}>5 · Route map</h2>
          <div className={card}>
            <RouteMap trips={view.P.trips.map((t) => ({ ids: t.ids }))} />
          </div>

          {/* 8 · week plan */}
          <h2 className={h2}>6 · Week plan</h2>
          <div className={`${card} overflow-x-auto`}>
            <table className="w-full text-xs">
              <thead>
                <tr>
                  {["Day", "Open", "Prod", "Outlets", "Sent", "Close", "Service", "₹/tart"].map((h) => (
                    <th key={h} className={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {view.week.map((r, i) => (
                  <tr key={i} className="border-t border-slate-100 dark:border-slate-700">
                    <td className={`${td} whitespace-nowrap`}>{DAY[r.d.getDay()]} {r.d.getDate()}</td>
                    <td className={td}>{Math.round(r.open)}</td>
                    <td className={td}>
                      <NumInput value={r.prod} label={`Production day ${i + 1}`} onCommit={(v) => setPROD((p) => p.map((x, k) => (k == i ? v : x)))} />
                    </td>
                    <td className={td}>{r.ids.map((o) => N[o]).join(", ") || "–"}</td>
                    <td className={td}>{r.ship}</td>
                    <td className={`${td} ${r.close < 0 || r.close > 4000 ? "font-semibold text-red-600" : ""}`}>{Math.round(r.close)}</td>
                    <td className={`${td} whitespace-nowrap`}>{r.svc}</td>
                    <td className={td}>{r.cpt == null ? "–" : cpt(r.cpt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className={`${muted} mt-1`}>
              Close = open − sent + production, and each close is the next day’s open. Today uses this page’s plan. Later days send to outlets at or below their reorder point, lowest stock first, limited by kitchen stock. Outlet sales are estimated from the performance %, assuming about 1,500 tarts sold a day in total. Sundays are skipped. Close turns red if it goes below 0 or above the 4,000 kitchen storage.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
