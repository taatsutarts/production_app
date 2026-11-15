"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  N, Z, FL, PK, GN, DAY,
  initialStock, initialExtras, initialCK, initialProd, initialWD, initialWE,
  stk, ckTot, sum, r6, fm, cpt, hv, bcap, dry,
  cover, rule, optCost, dayPlan, pick, weekRows,
} from "./planner";
import { fetchCKClosing } from "./ckStock";
import { fetchOutletStock } from "./outletStock";
import { fetchOutletConfig } from "./outletConfig";

// Leaflet touches `window`, so the map only loads in the browser
const RouteMap = dynamic(() => import("./RouteMap"), {
  ssr: false,
  loading: () => <div className="h-72 animate-pulse rounded-xl bg-slate-100 sm:h-96 dark:bg-slate-800" />,
});

const COL = ["#e4572e", "#2e86de", "#27ae60", "#8e44ad"];

/* ---------- small ui pieces ---------- */

const card = "rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900";
const title = "text-base font-semibold";
const mute = "text-sm text-slate-500 dark:text-slate-400";
const th = "px-2 py-1.5 text-left text-sm font-medium text-slate-500 dark:text-slate-400";
const td = "px-2 py-1.5";
const row = "border-t border-slate-100 dark:border-slate-800";
const inp =
  "rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-right text-sm tabular-nums outline-none focus:border-slate-400 focus:bg-white dark:border-slate-700 dark:bg-slate-800 dark:focus:bg-slate-900";

const TONE = {
  red: "bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  amber: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  green: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
};
const Badge = ({ t, children }) => (
  <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-sm font-medium ${TONE[t]}`}>{children}</span>
);

function Bar({ value, max, over }) {
  const p = Math.min(100, max ? (value / max) * 100 : 0);
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
      <div className={`h-full rounded-full ${over ? "bg-rose-500" : p > 85 ? "bg-amber-400" : "bg-emerald-500"}`} style={{ width: p + "%" }} />
    </div>
  );
}

// collapsible card with a rotating chevron.
// Uncontrolled by default (native <details> behavior). Pass `open` + `onToggle` to make
// it a controlled accordion — React 19's canonical pattern: `onToggle` receives the
// requested open state from the DOM so the `open` prop stays the single source of truth.
function Fold({ head, children, open, onToggle }) {
  return (
    <details
      open={open}
      onToggle={onToggle ? (e) => onToggle(e.currentTarget.open) : undefined}
      className={`group ${card}`}
    >
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

/* vehicle dropdown: native <select> popups are OS-drawn and can't be styled, so this
   listbox gives the popup rounded corners, comfortable text and a won't-fit badge */
function VehicleSelect({ options, value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null), listRef = useRef(null);
  const cur = options.find((v) => v.k == value) || options[0];
  useEffect(() => {
    if (!open) return;
    const doc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const key = (e) => {
      if (e.key === "Escape") {
        setOpen(false);
        const b = ref.current && ref.current.querySelector("button");
        if (b) b.focus();
      }
    };
    document.addEventListener("mousedown", doc);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", doc);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  // focus the selected option when the list opens (arrow keys then walk the options)
  useEffect(() => {
    if (open && listRef.current) {
      const el = listRef.current.querySelector("[aria-selected='true']") || listRef.current.firstChild;
      if (el) el.focus();
    }
  }, [open]);
  return (
    <div ref={ref} className="relative mt-2">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full cursor-pointer items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-left text-sm font-medium outline-none hover:bg-slate-100 focus:border-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700"
      >
        <span>{cur ? cur.l : "–"}</span>
        <span className={`ml-2 text-base leading-none text-slate-400 transition ${open ? "rotate-180" : ""}`}>⌄</span>
      </button>
      {open && (
        <div
          ref={listRef}
          role="listbox"
          className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800"
        >
          {options.map((v) => {
            const on = v.k == value;
            return (
              <button
                key={v.k}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => { onChange(v.k); setOpen(false); }}
                onKeyDown={(e) => {
                  if (e.key == "ArrowDown" || e.key == "ArrowUp") {
                    e.preventDefault();
                    const all = [...listRef.current.querySelectorAll("[role='option']")];
                    const i = all.indexOf(e.currentTarget) + (e.key == "ArrowDown" ? 1 : -1);
                    all[Math.max(0, Math.min(all.length - 1, i))].focus();
                  } else if (e.key == "Tab") setOpen(false);
                }}
                className={`flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left text-sm transition ${
                  on
                    ? "bg-slate-900 font-medium text-white dark:bg-white dark:text-slate-900"
                    : "hover:bg-slate-50 dark:hover:bg-slate-700"
                }`}
              >
                <span>{v.l}</span>
                {!v.valid && <Badge t="red">won’t fit</Badge>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const nextWorkingDay = () => {
  const d = new Date();
  if (d.getDay() == 0) d.setDate(d.getDate() + 1);
  return d.toLocaleDateString("en-CA");
};
const round6 = (v) => Math.round(v / 6) * 6;

/* ---------- persistence (localStorage) ---------- */

// Standing parameter edits (stock corrections, sales rates, capacities, days, CKS,
// production) are saved as per-cell diffs only, so fresh sheet/fetched values still
// flow in around them. The per-date plan (selection, vehicle picks, quantity
// overrides, CK/packaging corrections) lives under its own key per dispatch date.
const PKEY = "planner_params_v1";
const planKey = (date) => "planner_plan_v1_" + date;

const readJSON = (k) => {
  try { return JSON.parse(localStorage.getItem(k) || "null") || {}; } catch { return {}; }
};
const writeJSON = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
};

// apply {"o|i": v} cell edits over a 2d matrix
const withEdits = (m, ed) =>
  ed && Object.keys(ed).length ? m.map((r, o) => r.map((v, i) => (ed[o + "|" + i] != null ? ed[o + "|" + i] : v))) : m;
// apply {"i": v} edits over a 1d array
const with1d = (a, ed) => (ed ? a.map((v, i) => (ed[i] != null ? ed[i] : v)) : a);

/* ---------- packing-list text (kitchen + drivers) ---------- */

const dateLabel = (d) => DAY[d.getDay()] + " " + d.toLocaleDateString("en-GB");

function tripCopyText(ti, t, c, km, P, d) {
  const pk = c.pk ? ` + ${fm(c.pk)} ${c.m == "c" ? "cartons" : "ice"}` : "";
  const lines = [
    `Trip ${ti + 1} · ${dateLabel(d)} — ${c.l} (${fm(c.veh)}${pk}) · ${Math.round(km)} km`,
    "Kitchen → " + t.ids.map((o) => N[o]).join(" → "),
  ];
  t.ids.forEach((o, i) => {
    const bx = c.bx[i];
    lines.push(
      "",
      `${N[o]} — ${P.u[o]} tarts · ${c.m == "c" ? bx.c + (bx.c == 1 ? " carton" : " cartons") : bx.a + " × 60L + " + bx.b + " × 30L"}` +
        (c.m == "t" ? ` · ice ${dry(o, bx).toFixed(1)} kg` : "")
    );
    FL.forEach((f, fi) => {
      if (P.q[o][fi] > 0) lines.push(`  ${f[0]} — ${P.q[o][fi]}`);
    });
  });
  return lines.join("\n");
}

function allTripsCopyText(view, d) {
  const head =
    `Dispatch ${dateLabel(d)} · ${view.trips.length} trip${view.trips.length == 1 ? "" : "s"}` +
    ` · ${view.totU} tarts · ${fm(view.tot)}`;
  return [head].concat(view.trips.map(({ t, c, km }, ti) => tripCopyText(ti, t, c, km, view.P, d))).join("\n\n");
}

// same fallback pattern as the Shopify orders page (kept local on purpose — small)
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch {}
    document.body.removeChild(ta);
    return ok;
  }
}

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
  const [capw, setCapw] = useState(() => N.map(() => null)); // filled from the outlets table
  const [CKS, setCKS] = useState(4000);
  // source info for the Kitchen "In CK" values (last day's closing stock from the daily stock report)
  const [ckInfo, setCkInfo] = useState(null);
  // source info for the outlet stock table (shared stock sheet, same import as the PO page)
  const [sheetInfo, setSheetInfo] = useState(null);
  // outlet coordinates + freezer capacity come only from the `outlets` table (no built-in
  // copies in code — the table is the single source). Until a complete config arrives the
  // plan stays hidden behind a clear error card instead of falling back to stale numbers.
  const [LLS, setLLS] = useState(null);
  const [KITP, setKITP] = useState(null);
  const [configInfo, setConfigInfo] = useState(null);

  const [optIdx, setOptIdx] = useState(0); // -1 = outlets picked by hand
  const [manual, setManual] = useState([]);
  const [SELV, setSELV] = useState({});
  const [OV, setOV] = useState({});
  const [OVB, setOVB] = useState({});
  const [OVT, setOVT] = useState({});
  // quantities accordion: the one fold that is open (outlet index; -1 = none; null = not initialized yet)
  const [openOutlet, setOpenOutlet] = useState(null);
  // copy feedback: "all" or the trip index that just copied
  const [copied, setCopied] = useState(null);
  // the dispatch date whose saved plan was restored last (restore runs once per date)
  const restored = useRef(null);

  // date is set on the client only (avoids a server/client date mismatch)
  useEffect(() => setDate(nextWorkingDay()), []);

  // saved parameter edits are merged over the defaults on load (per-cell diffs only,
  // so the sheet and the stock report stay the live sources for everything else)
  useEffect(() => {
    const p = readJSON(PKEY);
    if (p.days) setDays(p.days);
    if (p.CKS) setCKS(p.CKS);
    if (p.wd) setWD((a) => with1d(a, p.wd));
    if (p.we) setWE((a) => with1d(a, p.we));
    if (p.capw) setCapw((a) => with1d(a, p.capw));
    if (p.prod) setPROD((a) => with1d(a, p.prod));
    if (p.stock) setS((m) => withEdits(m, p.stock));
  }, []);

  // Kitchen "In CK" starts from the real last-day closing stock (daily stock report "Opening",
  // TARTS only) for the day before the plan date. Changing the plan date re-fetches.
  useEffect(() => {
    if (!date) return;
    let alive = true;
    setCkInfo(null);
    fetchCKClosing(date)
      .then((r) => {
        if (!alive) return;
        setCkInfo(r);
        if (r.ok) setCK(r.qty);
      })
      .catch(() => {
        if (alive) setCkInfo({ ok: false, date: null, qty: null, missing: [], extra: [] });
      });
    return () => {
      alive = false;
    };
  }, [date]);

  // outlet stock comes from the shared stock sheet (same import as the PO page); the sheet
  // lists every SKU an outlet carries, so a missing outlet+flavour row means "not carried"
  useEffect(() => {
    let alive = true;
    fetchOutletStock().then((r) => {
      if (!alive) return;
      setSheetInfo(r);
      if (r.ok && r.S) {
        // saved per-cell stock corrections stay on top of the fresh sheet values
        setS(withEdits(r.S, readJSON(PKEY).stock));
        redo(); // stock changed -> re-pick outlets and drop overrides (same rule as manual edits)
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  // load outlet coordinates + freezer capacity from the `outlets` table (also the Retry
  // button on the config card). A capacity change re-picks outlets, the same as a manual
  // edit. Runs before the plan restore below (its gate waits for configInfo).
  const loadConfig = () => {
    fetchOutletConfig().then((r) => {
      setConfigInfo(r);
      if (r.ok && r.cfg) {
        setLLS(r.cfg.ll);
        setKITP(r.cfg.kit);
        // saved per-cell capacity corrections stay on top of the DB values
        setCapw(with1d(r.cfg.capw, readJSON(PKEY).capw));
        redo(); // capacity changed -> re-pick outlets and drop overrides
        restored.current = null; // re-apply the saved plan on top of the fresh config (Retry)
      }
    });
  };
  useEffect(() => {
    loadConfig();
  }, []);

  const d = useMemo(() => (date ? new Date(date + "T00:00") : null), [date]);
  const st = useMemo(() => N.map((_n, o) => stk(S, o)), [S]);
  const ctx = useMemo(() => ({ S, OV, OVB, OVT, CK, WD, WE, CAPW: capw, DAYS: days, LL: LLS, KIT: KITP }), [S, OV, OVB, OVT, CK, WD, WE, capw, days, LLS, KITP]);
  const sunday = d ? d.getDay() == 0 : false;
  // the mapped outlets-table config; the plan only renders once every outlet has
  // coordinates and freezer capacity in the table (there are no built-in fallback values)
  const cfg = configInfo && configInfo.ok ? configInfo.cfg : null;
  const configOk = !!LLS && LLS.every(Boolean) && !!KITP && capw.length == N.length && capw.every((v) => v != null);

  // outlet options come straight from the stock, sales rates and days-of-stock setting
  const OPTS = useMemo(() => (d && !sunday ? rule({ WD, WE, DAYS: days }, st, d) : []), [d, sunday, st, WD, WE, days]);
  const SEL = optIdx >= 0 ? (OPTS[optIdx] ? OPTS[optIdx].ids : []) : manual;
  const FORCE = optIdx >= 0 && OPTS[optIdx] ? OPTS[optIdx].f : null;

  // restore this date's saved plan once every data source (outlets config, stock sheet,
  // CK opening) has settled — the sheet/config loads' redo() above drops overrides, so
  // this runs after them.
  // Declared after OPTS because the deps array reads OPTS during render.
  useEffect(() => {
    if (!date || sheetInfo == null || ckInfo == null || configInfo == null || restored.current === date) return;
    restored.current = date;
    const p = readJSON(planKey(date));
    if (p.OV) setOV(p.OV);
    if (p.OVB) setOVB(p.OVB);
    if (p.OVT) setOVT(p.OVT);
    if (p.SELV) setSELV(p.SELV);
    if (p.manual) { setManual(p.manual); setOptIdx(-1); }
    else if (typeof p.optIdx == "number" && p.optIdx >= 0 && (!p.optLabel || (OPTS[p.optIdx] ? OPTS[p.optIdx].l : null) == p.optLabel)) setOptIdx(p.optIdx);
    if (p.ck) setCK((a) => with1d(a, p.ck));
    if (p.ps) setPS((m) => withEdits(m, p.ps));
    if (p.pq) setPQ((m) => withEdits(m, p.pq));
  }, [date, sheetInfo, ckInfo, configInfo, OPTS]);

  const view = useMemo(() => {
    if (!d || sunday || !configOk) return null;
    const P = dayPlan(ctx, SEL, true, st, d);
    let totU = 0, veh = 0, dkg = 0, dkc = 0, ctc = 0;
    const trips = P.trips.map((t) => {
      const c = pick(t, true, FORCE, SELV);
      const km = sum(t.ids.map((o, i) => hv(i ? LLS[t.ids[i - 1]] : KITP, LLS[o])));
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
  }, [d, sunday, ctx, SEL, SELV, FORCE, st, capw, CK, PROD, OPTS, date, LLS, KITP, configOk]);

  /* ----- edits (same rules as the HTML) ----- */

  // storage helpers: user edits are mirrored into localStorage at the moment they happen
  // (never blanket-save state, or fetched values would be written back as "edits")
  const savePlan = (patch) => {
    if (!date) return;
    const k = planKey(date);
    writeJSON(k, { ...readJSON(k), ...patch });
  };
  const savePlanMap = (field, key, v) => {
    if (!date) return;
    const k = planKey(date);
    const p = readJSON(k);
    p[field] = p[field] || {};
    p[field][key] = v;
    writeJSON(k, p);
  };
  const saveParam = (field, key, v) => {
    const p = readJSON(PKEY);
    p[field] = p[field] || {};
    p[field][key] = v;
    writeJSON(PKEY, p);
  };
  const saveParamS = (key, v) => {
    const p = readJSON(PKEY);
    p[key] = v;
    writeJSON(PKEY, p);
  };
  // the stored plan with overrides cleared — mirrors what redo() does to state
  // (ck/ps/pq corrections survive: redo() never cleared those in state either)
  const clearedPlan = (extra) => {
    const p = date ? readJSON(planKey(date)) : {};
    return { ...p, optIdx: 0, optLabel: null, OV: {}, OVB: {}, OVT: {}, SELV: {}, ...extra };
  };

  // stock, sales rates, capacity, days of stock or date: re-pick outlets and drop overrides
  const redo = () => { setOptIdx(0); setOV({}); setOVB({}); setOVT({}); setSELV({}); };
  // default the quantities accordion to the first (most critical) outlet once outlets are picked
  useEffect(() => {
    if (openOutlet == null && SEL.length) setOpenOutlet(SEL[0]);
  }, [SEL, openOutlet]);
  const pickOption = (i) => {
    redo();
    setOptIdx(i);
    if (date) writeJSON(planKey(date), clearedPlan({ optIdx: i, optLabel: OPTS[i] ? OPTS[i].l : null }));
  };
  const toggleOutlet = (o) => {
    const m = SEL.includes(o) ? SEL.filter((x) => x != o) : SEL.concat(o);
    setManual(m);
    setOptIdx(-1);
    setSELV({});
    savePlan({ optIdx: -1, optLabel: null, manual: m, SELV: {} });
  };
  const del = (obj, k) => { const n = { ...obj }; delete n[k]; return n; };
  const editTotal = (o, v) => {
    const nT = { ...OVT, [o]: round6(v) };
    const nB = del(OVB, o);
    setOVT(nT); setOVB(nB);
    savePlan({ OVT: nT, OVB: nB });
  };
  const editFlavour = (o, i, v) => {
    const nV = { ...OV, [o + "|" + i]: round6(v) };
    const nT = del(OVT, o);
    const nB = del(OVB, o);
    setOV(nV); setOVT(nT); setOVB(nB);
    savePlan({ OV: nV, OVT: nT, OVB: nB });
  };
  const editBoxes = (o, box) => {
    const nB = { ...OVB, [o]: box };
    const nT = del(OVT, o);
    setOVB(nB); setOVT(nT);
    savePlan({ OVB: nB, OVT: nT });
  };
  const set2d = (setter, o, j, v) => setter((s) => s.map((r, oi) => (oi == o ? r.map((x, ji) => (ji == j ? v : x)) : r)));
  const set1d = (setter, i, v) => setter((a) => a.map((x, k) => (k == i ? v : x)));
  const editStock = (o, i, v) => {
    set2d(setS, o, i, v);
    redo(); // stock changed -> overrides dropped, same as before
    saveParam("stock", o + "|" + i, v);
    if (date) writeJSON(planKey(date), clearedPlan());
  };
  const editPS = (o, j, v) => { set2d(setPS, o, j, v); savePlanMap("ps", o + "|" + j, v); };
  const editPQ = (o, j, v) => { set2d(setPQ, o, j, v); savePlanMap("pq", o + "|" + j, v); };
  // copy feedback + packing lists
  const copyList = async (key, text) => {
    const ok = await copyToClipboard(text);
    if (!ok) return;
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1600);
  };

  if (!date) return <div className="full-bleed min-h-screen bg-slate-50 p-6 pt-20 text-sm text-slate-500 md:p-10">Loading…</div>;

  return (
    <div className="full-bleed min-h-screen bg-slate-50 pt-14 pb-20 text-base text-slate-900 md:pt-0">
      <div className="mx-auto max-w-[1100px] px-3 sm:px-5">
        {/* header */}
        <header className="flex flex-wrap items-center justify-between gap-3 py-4">
          <h1 className="text-lg font-semibold tracking-tight">Shipment planner</h1>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={date}
              onChange={(e) => { if (e.target.value) { restored.current = null; setDate(e.target.value); redo(); } }}
              aria-label="Dispatch date"
              className="cursor-pointer rounded-full border border-slate-200 bg-white px-3 py-1.5 dark:border-slate-700 dark:bg-slate-900"
            />
            <label className="flex items-center gap-2 rounded-full border border-slate-200 bg-white py-1 pl-3 pr-1 dark:border-slate-700 dark:bg-slate-900">
              <span className={mute}>Days of stock</span>
              <NumInput
                value={days}
                step={0.5}
                label="Days of stock"
                onCommit={(v) => { setDays(Math.max(0.5, v || 2)); redo(); saveParamS("days", Math.max(0.5, v || 2)); if (date) writeJSON(planKey(date), clearedPlan()); }}
                w="w-14"
                pill
              />
            </label>
            <button
              onClick={() => { if (date) writeJSON(planKey(date), clearedPlan()); redo(); }}
              className="cursor-pointer rounded-full border border-slate-200 bg-white px-3 py-1.5 font-medium hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
            >
              Reset
            </button>
          </div>
        </header>

        {!configOk ? (
          configInfo == null ? (
            <div className={`${card} text-center font-medium text-slate-500`}>Loading outlet config…</div>
          ) : (
            <div className={card}>
              <div className="font-semibold text-rose-600">Outlet setup incomplete</div>
              <div className={`${mute} mt-1`}>
                The planner takes coordinates and freezer capacity only from the outlets table — fill in the missing values there, then retry.
                <div className="mt-1">
                  {cfg ? (
                    <>
                      {cfg.colsMissing && <div>the table has no latitude/longitude columns yet — run outlets_add_coords.sql</div>}
                      {cfg.tableRows == 0 && <div>the table returned no active outlets</div>}
                      {cfg.missingRows.length > 0 && <div>no active row in the table for: {cfg.missingRows.join(", ")}</div>}
                      {cfg.missingCoords.length > 0 && <div>no coordinates for: {cfg.missingCoords.join(", ")}</div>}
                      {cfg.missingCap.length > 0 && <div>no freezer capacity for: {cfg.missingCap.join(", ")}</div>}
                      {!cfg.kit && <div>no coordinates for the kitchen row (CK)</div>}
                    </>
                  ) : (
                    <div>couldn&apos;t read the outlets table{configInfo.error ? ": " + configInfo.error : ""}</div>
                  )}
                </div>
              </div>
              <button
                onClick={loadConfig}
                className="mt-3 cursor-pointer rounded-full border border-slate-200 bg-white px-3 py-1.5 font-medium hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
              >
                Retry
              </button>
            </div>
          )
        ) : !view ? (
          <div className={`${card} text-center font-medium text-rose-600`}>Sunday: kitchen closed. Pick another date.</div>
        ) : (
          <>
            {/* grid: cost + options share the top row on wide screens, everything
                else spans both columns one by one (order-* sets the sequence) */}
            <div className={`grid gap-3 lg:gap-x-5 ${OPTS.length > 0 ? "lg:grid-cols-2" : ""}`}>
              {/* all sections stack one by one (single column) */}
              <div className="contents">
                {/* outlets */}
                <section className={`${card} order-4 lg:col-span-2`}>
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
                          className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition ${
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
                <section className="order-5 flex flex-col gap-3 lg:col-span-2">
                  <div className="flex items-center justify-between px-1">
                    <h2 className={title}>Vehicles</h2>
                    {view.trips.length > 0 && (
                      <button
                        onClick={() => copyList("all", allTripsCopyText(view, d))}
                        className="cursor-pointer rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
                      >
                        {copied === "all" ? "Copied ✓" : "Copy all lists"}
                      </button>
                    )}
                  </div>
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

                      <VehicleSelect
                        options={t.o}
                        value={c.k}
                        onChange={(k) => {
                          const nS = { ...SELV, [t.key]: k };
                          setSELV(nS);
                          savePlan({ SELV: nS });
                        }}
                      />

                      <div className="mt-2 flex items-center gap-2">
                        <Bar value={c.used} max={c.cap} over={over > 0} />
                        <span className="whitespace-nowrap text-sm tabular-nums">
                          {c.used}/{c.cap} {c.m == "c" ? "cartons" : "slots"}
                        </span>
                        {over > 0 && <Badge t="red">−{over}</Badge>}
                        {c.k != "pv" && t.ids.length < 4 && <Badge t="amber">under 4 stops</Badge>}
                        <button
                          onClick={() => copyList(ti, tripCopyText(ti, t, c, km, view.P, d))}
                          className="ml-auto cursor-pointer whitespace-nowrap rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
                        >
                          {copied === ti ? "Copied ✓" : "Copy packing list"}
                        </button>
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
                              <div className="flex items-center gap-1 text-sm text-slate-500">
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
                <section className="order-6 flex flex-col gap-3 lg:col-span-2">
                  <h2 className={`${title} px-1`}>Quantities</h2>
                  {SEL.length == 0 && <div className={`${card} ${mute}`}>No outlet selected.</div>}
                  {SEL.map((o) => {
                    const U = view.P.u[o], after = st[o] + U, rm = capw[o] - after;
                    const cv = cover(ctx, o, d, st[o]);
                    return (
                      <Fold
                        key={o}
                        open={openOutlet === o}
                        onToggle={(requested) => setOpenOutlet((cur) => (requested ? o : cur === o ? -1 : cur))}
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
                              <span className="whitespace-nowrap text-sm tabular-nums text-slate-500">{after}/{capw[o]}</span>
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
                          <table className="w-full text-sm">
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

                          <table className="mt-3 w-full text-sm">
                            <thead><tr><th className={th}>Packaging</th><th className={th}>Stock</th><th className={th}>Send</th></tr></thead>
                            <tbody>
                              {PK.map((n, j) => (
                                <tr key={n} className={row}>
                                  <td className={td}>{n}</td>
                                  <td className={td}><NumInput value={PS[o][j]} label={`${n} stock`} onCommit={(v) => editPS(o, j, v)} /></td>
                                  <td className={td}><NumInput value={PQ[o][j]} label={`${n} send`} onCommit={(v) => editPQ(o, j, v)} /></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>

                          <table className="mt-3 w-full text-sm">
                            <thead><tr><th className={th}>Garnishing (g)</th><th className={th}>Stock</th><th className={th}>Send</th></tr></thead>
                            <tbody>
                              {GN.map((n, k) => (
                                <tr key={n} className={row}>
                                  <td className={td}>{n}</td>
                                  <td className={td}><NumInput value={PS[o][k + 4]} label={`${n} stock`} onCommit={(v) => editPS(o, k + 4, v)} /></td>
                                  <td className={td}><NumInput value={PQ[o][k + 4]} label={`${n} send`} onCommit={(v) => editPQ(o, k + 4, v)} /></td>
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

              {/* cost / options / kitchen / route join the same single column */}
              <aside className="contents">
                {/* cost */}
                <section className="order-1 rounded-2xl bg-slate-900 p-4 text-white shadow-sm dark:bg-slate-800">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <div className="text-sm text-slate-400">Cost per tart</div>
                      <div className="text-4xl font-semibold tabular-nums tracking-tight">
                        {view.totU ? cpt(view.tot / view.totU) : "–"}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xl font-semibold tabular-nums">{fm(view.tot)}</div>
                      <div className="text-sm text-slate-400">{view.totU} tarts</div>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5 text-sm">
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
                          className={`flex cursor-pointer items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-sm transition ${
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
                <div className="order-3 lg:col-span-2">
                  <Fold
                    head={
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={title}>Kitchen</span>
                        <span className={mute}>
                          {ckInfo == null
                            ? "opening: loading…"
                            : ckInfo.ok
                              ? `opening ${ckInfo.date}`
                              : "opening: no stock entry — manual values"}
                        </span>
                        <span className="tabular-nums">{view.ckT} in stock</span>
                        <span className={mute}>sending {view.sT}</span>
                        {view.short > 0 ? <Badge t="red">short {view.short}</Badge> : <Badge t="green">{view.left} left</Badge>}
                      </div>
                    }
                  >
                    {ckInfo?.ok && (ckInfo.missing.length > 0 || ckInfo.extra.length > 0) && (
                      <div className={`${mute} mb-2`}>
                        {ckInfo.missing.length > 0 && <div>no stock entry for: {ckInfo.missing.join(", ")}</div>}
                        {ckInfo.extra.length > 0 && <div>in stock report but not in planner: {ckInfo.extra.join(", ")}</div>}
                      </div>
                    )}
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead><tr><th className={th}>Flavour</th><th className={th}>In CK</th><th className={th}>Sending</th><th className={th}>Left</th></tr></thead>
                        <tbody>
                          {FL.map((f, i) => (
                            <tr key={f[0]} className={row}>
                              <td className={td}>{f[0]}</td>
                              <td className={td}><NumInput value={CK[i]} step={6} label={`${f[0]} in CK`} onCommit={(v) => { set1d(setCK, i, v); savePlanMap("ck", i, v); }} /></td>
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
                <section className={`${card} order-7 lg:col-span-2`}>
                  <h2 className={`${title} mb-2`}>Route</h2>
                  <RouteMap trips={view.P.trips.map((t) => ({ ids: t.ids }))} ll={LLS} kit={KITP} />
                </section>
              </aside>
            </div>

            {/* week plan */}
            <section className={`${card} mt-5`}>
              <h2 className={`${title} mb-2`}>Next 6 working days</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>{["Day", "Open", "Prod", "Outlets", "Sent", "Close", "Service", "₹/tart"].map((h) => <th key={h} className={th}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {view.week.map((r, i) => (
                      <tr key={i} className={`${row} hover:bg-slate-50 dark:hover:bg-slate-800/50`}>
                        <td className={`${td} whitespace-nowrap font-medium`}>{DAY[r.d.getDay()]} {r.d.getDate()}</td>
                        <td className={`${td} tabular-nums`}>{Math.round(r.open)}</td>
                        <td className={td}><NumInput value={r.prod} label={`Production day ${i + 1}`} onCommit={(v) => { set1d(setPROD, i, v); saveParam("prod", i, v); }} /></td>
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
                  <table className="w-full text-sm">
                    <thead><tr><th className={th}>Outlet</th><th className={th}>Weekday</th><th className={th}>Weekend</th><th className={th}>Freezer</th></tr></thead>
                    <tbody>
                      {N.map((n, o) => (
                        <tr key={n} className={row}>
                          <td className={td}>{n}</td>
                          <td className={td}><NumInput value={WD[o]} label={`${n} weekday sales`} onCommit={(v) => { set1d(setWD, o, v); redo(); saveParam("wd", o, v); if (date) writeJSON(planKey(date), clearedPlan()); }} /></td>
                          <td className={td}><NumInput value={WE[o]} label={`${n} weekend sales`} onCommit={(v) => { set1d(setWE, o, v); redo(); saveParam("we", o, v); if (date) writeJSON(planKey(date), clearedPlan()); }} /></td>
                          <td className={td}><NumInput value={capw[o]} label={`${n} freezer capacity`} onCommit={(v) => { set1d(setCapw, o, v); redo(); saveParam("capw", o, v); if (date) writeJSON(planKey(date), clearedPlan()); }} w="w-20" /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <label className="mt-3 flex items-center gap-2">
                  <span className={mute}>Kitchen storage limit</span>
                  <NumInput value={CKS} label="Kitchen storage limit" onCommit={(v) => { setCKS(v); saveParamS("CKS", v); }} w="w-20" />
                </label>
              </Fold>

              <Fold
                head={
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={title}>Stock of every outlet</span>
                    <span className={mute}>
                      {sheetInfo == null
                        ? "sheet: loading…"
                        : sheetInfo.ok
                          ? `sheet ${sheetInfo.date || "(no date)"}`
                          : "sheet failed — manual values"}
                    </span>
                    {sheetInfo?.ok && sheetInfo.missing.length > 0 && (
                      <Badge t="amber">no sheet data: {sheetInfo.missing.length}</Badge>
                    )}
                    {sheetInfo?.ok && sheetInfo.manual.length > 0 && (
                      <Badge t="amber">manual stock: {sheetInfo.manual.length}</Badge>
                    )}
                  </div>
                }
              >
                {sheetInfo?.ok && (sheetInfo.missing.length > 0 || sheetInfo.manual.length > 0 || sheetInfo.unknownOutlets.length > 0 || sheetInfo.unknownItems.length > 0) && (
                  <div className={`${mute} mb-2`}>
                    {sheetInfo.missing.length > 0 && <div>no stock rows in sheet: {sheetInfo.missing.join(", ")}</div>}
                    {sheetInfo.manual.length > 0 && <div>hardcoded stock (not reporting in sheet yet): {sheetInfo.manual.join(", ")}</div>}
                    {sheetInfo.unknownOutlets.length > 0 && <div>in sheet but not in planner: {sheetInfo.unknownOutlets.join(", ")}</div>}
                    {sheetInfo.unknownItems.length > 0 && <div>stock items not matched to a planner flavour: {sheetInfo.unknownItems.join(", ")}</div>}
                  </div>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        <th className={th}>Product</th>
                        {N.map((n) => <th key={n} className={`${th} whitespace-nowrap`}>{n}</th>)}
                        <th className={th}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {FL.map((f, i) => (
                        <tr key={f[0]} className={row}>
                          <td className={`${td} whitespace-nowrap font-medium`}>{f[0]}</td>
                          {N.map((n, o) => (
                            <td key={n} className={td}>
                              <NumInput value={S[o][i] ?? 0} label={`${f[0]} ${n} stock`} onCommit={(v) => editStock(o, i, v)} w="w-14" />
                            </td>
                          ))}
                          <td className={`${td} tabular-nums`}>{sum(N.map((_n, o) => S[o][i] || 0))}</td>
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
