"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  N, Z, NEAR, FL, PK, GN, DAY,
  initialStock, initialExtras, initialCK, initialProd,
  stk, ckTot,
} from "./planner";
import {
  buildPlan, pick as pickOpt, planOptions, planCost, criticality,
  routeKm, routeMinutes, projectStock, weekRows as engineWeekRows, addDays, isoDate,
  dry, bcap, sum, r6, round6, fm, cpt, flPct, isClassic,
  allocate, vehicleOptions, orderStops,
} from "./engine";
import { normItem } from "./nameMatch";
import { generateDeliveryChallan } from "@/lib/plannerChallan";
import { fetchCKClosing } from "./ckStock";
import { fetchOutletStock } from "./outletStock";
import { fetchOutletConfig } from "./outletConfig";
import { supabase } from "@/lib/supabaseBrowser";
import { ENGINE_DEFAULTS, VEHICLES } from "./engine";

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

/* text sibling of NumInput (commit on blur / Enter); an empty value is ignored —
   vehicles.name is NOT NULL in the DB and a blank label would hide the vehicle */
function TextInput({ value, onCommit, w = "w-40", label }) {
  const [txt, setTxt] = useState(value);
  const [focus, setFocus] = useState(false);
  useEffect(() => {
    if (!focus) setTxt(value);
  }, [value, focus]);
  const commit = () => {
    const v = txt.trim();
    if (v && v !== value) onCommit(v);
  };
  return (
    <input
      type="text"
      aria-label={label}
      value={txt}
      onFocus={() => setFocus(true)}
      onChange={(e) => setTxt(e.target.value)}
      onBlur={() => { setFocus(false); commit(); }}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      className={`${inp} ${w}`}
    />
  );
}

/* numeric input that may be left empty: "" commits null (the outlets table
   stores NULL and the engine falls back to the global rules); a typed 0 is a
   real zero — max send 0 = nothing goes to that outlet, min send 0 = no
   forced minimum for it */
function OptNumInput({ value, onCommit, w = "w-16", label }) {
  const [txt, setTxt] = useState(value == null ? "" : String(value));
  const [focus, setFocus] = useState(false);
  useEffect(() => {
    if (!focus) setTxt(value == null ? "" : String(value));
  }, [value, focus]);
  const commit = () => {
    const raw = txt.trim();
    if (raw === "") {
      setTxt("");
      if (value != null) onCommit(null);
      return;
    }
    const v = Math.max(0, Number(raw) || 0);
    setTxt(String(v));
    if (v !== value) onCommit(v);
  };
  return (
    <input
      type="number"
      inputMode="numeric"
      min="0"
      aria-label={label}
      value={txt}
      onFocus={() => setFocus(true)}
      onChange={(e) => setTxt(e.target.value)}
      onBlur={() => { setFocus(false); commit(); }}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      className={`${inp} ${w}`}
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
                {!v.valid && <Badge t="red">{v.why || "won’t fit"}</Badge>}
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

/* ---------- persistence (localStorage) ---------- */

// Per-cell edits (production rows, stock corrections) are saved as diffs only, so
// fresh fetched values still flow in around them. Everything else — dispatch rules,
// outlet sales/capacity/send limits, days of stock, kitchen limit — lives in the
// database now (⚙ popup). The per-date plan (selection, vehicle picks, quantity
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

/* One trip's packing list. A return-run option has two legs (near first, then far);
   its boxes are aligned to the legs' stops, not to the trip's original order. */
function tripCopyText(ctx, ti, t, c, km, P, d) {
  const pk = c.pk ? ` + ${fm(c.pk)} ${c.m == "c" ? "cartons" : "ice"}` : "";
  const legs = c.returnRun ? c.runs : [{ ids: t.ids, bx: c.bx, label: null }];
  const lines = [
    `Trip ${ti + 1} · ${dateLabel(d)} — ${c.l} (${fm(c.veh)}${pk}) · ${Math.round(km)} km`,
  ];
  legs.forEach((leg, li) => {
    lines.push(
      (c.returnRun ? `${leg.label || "Leg " + (li + 1)}: K` : "K") + "itchen → " +
        leg.ids.map((o) => N[o]).join(" → ")
    );
    leg.ids.forEach((o, i) => {
      const bx = leg.bx[i];
      lines.push(
        "",
        `${N[o]} — ${P.u[o] || 0} tarts · ${c.m == "c" ? bx.c + (bx.c == 1 ? " carton" : " cartons") : bx.a + " × 60L + " + bx.b + " × 30L"}` +
          (c.m == "t" ? ` · ice ${dry(ctx, o, bx).toFixed(1)} kg` : "")
      );
      (P.q[o] || []).forEach((q, fi) => {
        if (q > 0) lines.push(`  ${FL[fi][0]} — ${q}`);
      });
    });
  });
  return lines.join("\n");
}

function allTripsCopyText(ctx, view, d) {
  const head =
    `Dispatch ${dateLabel(d)} · ${view.trips.length} trip${view.trips.length == 1 ? "" : "s"}` +
    ` · ${view.totU} tarts · ${fm(view.tot)}`;
  return [head].concat(view.trips.map(({ t, c, km }, ti) => tripCopyText(ctx, ti, t, c, km, view.P, d))).join("\n\n");
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
  // settings v8: every global value lives in the planner_settings DB row (editable in
  // the ⚙ popup — nothing in localStorage or code). R (below) merges the row over the
  // engine's built-in defaults while it loads / until the migration has run.
  const [S, setS] = useState(initialStock);
  const [PS, setPS] = useState(initialExtras);
  const [PQ, setPQ] = useState(initialExtras);
  const [CK, setCK] = useState(initialCK);
  const [PROD, setPROD] = useState(initialProd);
  // outlet sales averages + freezer capacity + send limits come only from the outlets
  // table (weekday_avg / weekend_avg / fridge_capacity / min_send_qty / max_send_qty);
  // null = still loading — the plan stays blocked until the whole config has arrived
  const [WD, setWD] = useState(null);
  const [WE, setWE] = useState(null);
  const [capw, setCapw] = useState(null);
  const [mins, setMins] = useState(null); // outlets.min_send_qty per outlet (null entry = off)
  const [maxs, setMaxs] = useState(null); // outlets.max_send_qty per outlet (null entry = off)
  // company + FSSAI for the delivery challans come from the brands table (Taatsu row)
  const [brand, setBrand] = useState(null);
  // source info for the Kitchen "In CK" values (last day's closing stock from the daily stock report)
  const [ckInfo, setCkInfo] = useState(null);
  // source info for the outlet stock table (stores_closing_stock entries, sheet fallback)
  const [stockInfo, setStockInfo] = useState(null);
  // outlet coordinates + freezer capacity come only from the `outlets` table (no built-in
  // copies in code — the table is the single source). Until a complete config arrives the
  // plan stays hidden behind a clear error card instead of falling back to stale numbers.
  const [LLS, setLLS] = useState(null);
  const [KITP, setKITP] = useState(null);
  const [configInfo, setConfigInfo] = useState(null);
  // outlets-table extras for the Send PO payload + delivery challans
  const [addr, setAddr] = useState(null);
  const [ids, setIds] = useState(null);
  const [poc, setPoc] = useState(null);
  // SKU codes from the items table (delivery challans); {} until the fetch lands
  const [skus, setSkus] = useState({});
  // Sunday emergency dispatch (spec section 13: kitchen closed — the page shows Monday's
  // plan and only dispatches today when the owner presses the button)
  const [forceSunday, setForceSunday] = useState(false);
  // Send PO state
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState(null);

  // dispatch rules — global values from `planner_settings` row 1 (radius km, minimum
  // tarts) and per-vehicle rows from the `vehicles` table (migration v7). null =
  // still loading, {} = nothing in the DB yet (the engine's built-in values apply).
  // The ⚙ popup in the page header edits both tables.
  const [rules, setRules] = useState(null);
  const [rulesInfo, setRulesInfo] = useState(null);
  const [VEH, setVEH] = useState(null);
  const [vehInfo, setVehInfo] = useState(null);
  const [rulesMsg, setRulesMsg] = useState(null);
  const [rulesOpen, setRulesOpen] = useState(false);

  const [optIdx, setOptIdx] = useState(0); // -1 = outlets picked by hand
  const [manual, setManual] = useState([]);
  const [SELV, setSELV] = useState({});
  const [OV, setOV] = useState({});
  const [OVB, setOVB] = useState({});
  const [OVT, setOVT] = useState({});
  // manual trips ("+ Add trip"): one entry per extra run the owner dispatches
  // themselves — { vk: vehicle key, ids: outlet indexes }. The outlets on a
  // manual trip leave the auto plan and its quantities; the vehicle is fixed
  // (stored here, not in SELV, so redo() cannot lose it). Saved per date.
  const [EXTRAS, setEXTRAS] = useState([]);
  // outlets the owner refused as a free extra drop for this date ("✕" on the trip
  // card): the engine's flat-fare trips auto-load nearby outlets from leftover
  // kitchen stock; NOEX keeps them off. Real (critical/auto-selected) stops are
  // never blocked by it. Survives redo() like EXTRAS — it is a per-date choice.
  const [NOEX, setNOEX] = useState([]);
  // the "+ Add trip" form: null = closed, else { vk, ids } while composing
  const [newTrip, setNewTrip] = useState(null);
  // quantities accordion: the one fold that is open (outlet index; -1 = none; null = not initialized yet)
  const [openOutlet, setOpenOutlet] = useState(null);
  // copy feedback: "all" or the trip index that just copied
  const [copied, setCopied] = useState(null);
  // the dispatch date whose saved plan was restored last (restore runs once per date)
  const restored = useRef(null);

  // date is set on the client only (avoids a server/client date mismatch)
  useEffect(() => setDate(nextWorkingDay()), []);

  // saved per-cell edits (production rows, stock corrections) are merged over the
  // fetched values on load. Everything else lives in the database now (⚙ popup).
  useEffect(() => {
    const p = readJSON(PKEY);
    if (p.prod) setPROD((a) => with1d(a, p.prod));
    if (p.stock) setS((m) => withEdits(m, p.stock));
  }, []);

  // challan company + FSSAI come from the brands table (the Taatsu row)
  useEffect(() => {
    supabase
      .from("brands")
      .select("brand_name,company,fssai_no")
      .eq("brand_name", "Taatsu")
      .maybeSingle()
      .then(({ data }) => setBrand(data || null));
  }, []);

  // SKU codes for the delivery challans come from the items table (anon-readable)
  useEffect(() => {
    fetch("/api/items")
      .then((r) => r.json())
      .then((j) => {
        const m = {};
        (j.items || []).forEach((it) => {
          if (it.sku) m[normItem(it.item_name)] = it.sku;
        });
        setSkus(m);
      })
      .catch(() => {});
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

  // outlet stock comes from the stores_closing_stock table (entries the outlet team
  // makes on the Closing Stock page); outlets without entries fall back to the shared
  // stock sheet. Changing the plan date re-fetches (newer entries may have appeared).
  useEffect(() => {
    if (!date) return;
    let alive = true;
    setStockInfo(null);
    fetchOutletStock(date).then((r) => {
      if (!alive) return;
      setStockInfo(r);
      if (r.ok && r.S) {
        // saved per-cell stock corrections stay on top of the fetched values
        setS(withEdits(r.S, readJSON(PKEY).stock));
        redo(); // stock changed -> re-pick outlets and drop overrides (same rule as manual edits)
      }
    }).catch(() => {
      if (alive) setStockInfo({ ok: false, S: null, closing: N.map(() => null), missing: [], unknownItems: [], sheet: { used: [], date: "", error: null }, error: "unexpected error" });
    });
    return () => {
      alive = false;
    };
  }, [date]);
  // load the outlets table config (coordinates, capacity, sales, send limits — also the
  // Retry button on the config card). A capacity change re-picks outlets, the same as a
  // manual edit. Runs before the plan restore below (its gate waits for configInfo).
  const loadConfig = () => {
    fetchOutletConfig().then((r) => {
      setConfigInfo(r);
      if (r.ok && r.cfg) {
        // a missing coordinate falls back to the kitchen's — the outlet still plans
        // (its routes are just approximate) and the gaps card below names it
        setLLS(r.cfg.ll.map((v) => v || r.cfg.kit || null));
        setKITP(r.cfg.kit);
        setAddr(r.cfg.addr);
        setIds(r.cfg.ids);
        setPoc(r.cfg.poc);
        setMins(r.cfg.mins);
        setMaxs(r.cfg.maxs);
        // real sales averages + freezer capacity + send limits from the outlets table
        // (no localStorage copies). A single missing sales value blocks the plan — the
        // config card below names the gaps instead of planning on stale numbers.
        if (Array.isArray(r.cfg.wd) && r.cfg.wd.every((v) => v != null)) setWD(r.cfg.wd);
        if (Array.isArray(r.cfg.we) && r.cfg.we.every((v) => v != null)) setWE(r.cfg.we);
        setCapw(r.cfg.capw);
        redo(); // capacity changed -> re-pick outlets and drop overrides
        restored.current = null; // re-apply the saved plan on top of the fresh config (Retry)
      }
    });
  };
  useEffect(() => {
    loadConfig();
  }, []);

  // global values from planner_settings row 1 (migrations v8 + v9): dispatch rules,
  // shelf life, route limit, challan expiry, kitchen storage limit, packaging
  // prices. select("*") so a migration that added columns but was not run yet is
  // not fatal — the missing keys fall back to the engine's built-in values.
  const loadRules = () => {
    supabase
      .from("planner_settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          setRules({});
          setRulesInfo({ ok: false, error: error.message });
          return;
        }
        setRules({
          ...(data && data.eco_radius_km != null ? { ecoRadiusKm: Number(data.eco_radius_km) } : {}),
          ...(data && data.min_tarts_per_outlet != null ? { minTartsPerOutlet: Number(data.min_tarts_per_outlet) } : {}),
          ...(data && data.days_of_stock != null ? { daysOfStock: Number(data.days_of_stock) } : {}),
          ...(data && data.shelf_life_days != null ? { shelfLifeDays: Number(data.shelf_life_days) } : {}),
          ...(data && data.cks_limit != null ? { cksLimit: Number(data.cks_limit) } : {}),
          // route_time_limit_min / challan_expiry_days are no longer settings:
          // the owner says a late shipment is not our concern, and the challan
          // expiry is a fixed 30 days (the engine's built-in values apply)
          ...(data && data.carton_rs != null ? { cartonRs: Number(data.carton_rs) } : {}),
          ...(data && data.dry_ice_rs_per_kg != null ? { dryIceRsPerKg: Number(data.dry_ice_rs_per_kg) } : {}),
          ...(data && data.trays_per_carton != null ? { traysPerCarton: Number(data.trays_per_carton) } : {}),
        });
        setRulesInfo({ ok: true, error: null });
      });
  };

  // per-vehicle rule rows from the `vehicles` table, keyed for the engine (ctx.VEH)
  const loadVehicles = () => {
    supabase
      .from("vehicles")
      .select("*")
      .eq("is_active", true)
      .then(({ data, error }) => {
        if (error) {
          setVEH({});
          setVehInfo({ ok: false, error: error.message });
          return;
        }
        const m = {};
        (data || []).forEach((r) => {
          m[r.key] = {
            ...(r.name ? { l: r.name } : {}),
            ...(r.box_capacity != null ? { cap: Number(r.box_capacity) } : {}),
            ...(r.flat_fare != null ? { flat: Number(r.flat_fare) } : {}),
            ...(r.pune_flat_fare != null ? { puneFlat: Number(r.pune_flat_fare) } : {}),
            ...(r.min_stops != null ? { minStops: Number(r.min_stops) } : {}),
            ...(r.max_stops != null ? { maxStops: Number(r.max_stops) } : {}),
            ...(r.max_near_stops != null ? { maxNear: Number(r.max_near_stops) } : {}),
            ...(r.max_far_stops != null ? { maxFar: Number(r.max_far_stops) } : {}),
          };
        });
        setVEH(m);
        setVehInfo({ ok: true, error: null, n: (data || []).length });
      });
  };
  useEffect(() => {
    loadRules();
    loadVehicles();
  }, []);

  // commit a global setting: apply locally (the plan updates immediately) and
  // persist to planner_settings row 1. On failure the badge says so and we re-read.
  const saveSetting = async (col, localKey, v) => {
    setRulesMsg({ ok: null, text: "saving…" });
    const { data: cur, error: e0 } = await supabase.from("planner_settings").select("*").eq("id", 1).maybeSingle();
    let error = e0;
    if (!error) {
      const row = { id: 1, ...(cur || {}), [col]: v, updated_at: new Date().toISOString() };
      ({ error } = await supabase.from("planner_settings").upsert(row));
    }
    if (error) {
      setRulesMsg({ ok: false, text: "save failed — " + error.message });
      loadRules();
      return;
    }
    setRules((r) => ({ ...(r || {}), [localKey]: v }));
    setRulesMsg({ ok: true, text: "saved ✓" });
  };

  // commit a vehicle row (col = name / box_capacity / flat_fare / pune_flat_fare /
  // max_stops / max_near_stops / max_far_stops). The fallback row only matters if
  // the vehicle's row is missing — it must satisfy the NOT NULLs.
  const saveVehicle = async (vk, col, localKey, v) => {
    setRulesMsg({ ok: null, text: "saving…" });
    const { data: cur, error: e0 } = await supabase.from("vehicles").select("*").eq("key", vk).maybeSingle();
    let error = e0;
    if (!error) {
      const row = { ...(cur || { key: vk, name: VEHICLES[vk].l, min_stops: 1, max_stops: VEHICLES[vk].maxStops, is_active: true }), [col]: v, updated_at: new Date().toISOString() };
      ({ error } = await supabase.from("vehicles").upsert(row));
    }
    if (error) {
      setRulesMsg({ ok: false, text: "save failed — " + error.message });
      loadVehicles();
      return;
    }
    setVEH((m) => ({ ...(m || {}), [vk]: { ...(m?.[vk] || {}), [localKey]: v } }));
    setRulesMsg({ ok: true, text: "saved ✓" });
  };

  // commit one outlets-table value (col = weekday_avg / weekend_avg / fridge_capacity /
  // min_send_qty / max_send_qty) for outlet index o. min/max 0 = off → stored as NULL.
  // Every commit re-picks outlets (sales or room changed) and the badge reports it.
  const saveOutlet = async (o, col, localKey, v) => {
    const id = ids?.[o];
    if (id == null) {
      setRulesMsg({ ok: false, text: N[o] + ": no row in the outlets table" });
      return;
    }
    setRulesMsg({ ok: null, text: "saving…" });
    // min/max send: empty commits null (off — the global rules apply); a typed 0
    // is a real zero (max 0 = send nothing, min 0 = no forced minimum)
    const off = localKey == "mins" || localKey == "maxs";
    const dbv = off ? (v == null ? null : v) : v;
    const { error } = await supabase.from("outlets").update({ [col]: dbv }).eq("id", id);
    if (error) {
      setRulesMsg({ ok: false, text: "save failed — " + error.message });
      loadConfig(); // re-read the table so the UI matches the database again
      return;
    }
    if (localKey == "wd") set1d(setWD, o, v);
    else if (localKey == "we") set1d(setWE, o, v);
    else if (localKey == "capw") set1d(setCapw, o, v);
    else if (localKey == "mins") set1d(setMins, o, dbv);
    else if (localKey == "maxs") set1d(setMaxs, o, dbv);
    redo();
    setRulesMsg({ ok: true, text: "saved ✓" });
  };

  const d = useMemo(() => (date ? new Date(date + "T00:00") : null), [date]);
  const sunday = d ? d.getDay() == 0 : false;

  // On Sunday the plan is built for Monday morning: existing stock minus Sunday's
  // expected sales, per flavour (weekend rate × the flavour's share of the mix).
  const mondayS = useMemo(() => {
    if (!sunday || !WE) return S;
    const tp = sum(FL.filter(isClassic).map(flPct)) || 1;
    return S.map((r, o) =>
      r.map((v, i) =>
        v == null ? null : Math.max(0, Math.round(v - (WE[o] || 0) * (isClassic(FL[i]) ? flPct(FL[i]) / tp : 0)))
      )
    );
  }, [S, sunday, WE]);
  const effS = mondayS;
  const effSt = useMemo(() => N.map((_n, o) => stk(effS, o)), [effS]);
  const effD = d && sunday ? addDays(d, 1) : d;

  // the global settings as shown everywhere on the page: the planner_settings DB row
  // over the engine's built-in defaults
  const R = { ...ENGINE_DEFAULTS, ...(rules || {}) };
  const D = R.daysOfStock;

  const ctx = useMemo(
    () => ({
      N, Z, NEAR, CITY: N.map((_n, o) => (Z[o] == "P" ? "Pune" : "Mumbai")), FL,
      S: effS, CK, WD, WE, CAPW: capw, LL: LLS, KIT: KITP, CKS: R.cksLimit, DAYS: D,
      MIN: mins, MAX: maxs, OV, OVB, OVT, VEH, NOEX,
      SET: { ...(rules || {}) },
    }),
    [effS, CK, WD, WE, capw, mins, maxs, D, R.cksLimit, LLS, KITP, OV, OVB, OVT, rules, VEH, NOEX]
  );

  // the mapped outlets-table config; the plan only renders once every outlet has
  // coordinates, freezer capacity and sales averages in the table (there are no
  // built-in fallback values)
  const cfg = configInfo && configInfo.ok ? configInfo.cfg : null;
  const configOk =
    !!LLS && LLS.every(Boolean) && !!KITP &&
    !!capw && capw.length == N.length && capw.every((v) => v != null) &&
    !!WD && WD.every((v) => v != null) &&
    !!WE && WE.every((v) => v != null);
  // one vehicle's effective row (DB `vehicles` row over the built-in constants)
  const V = (k) => ({ ...VEHICLES[k], ...(VEH?.[k] || {}) });
  const planning = !!d && (!sunday || forceSunday);

  // which outlets go today: the v6 options (critical-only, + low flavours, or the
  // fallbacks when nothing is critical). Sunday emergency builds them for Monday.
  const OPTS = useMemo(
    () => (planning ? planOptions(ctx, effSt, effD) : []),
    [planning, ctx, effSt, effD]
  );
  const SEL = optIdx >= 0 ? (OPTS[optIdx] ? OPTS[optIdx].ids : []) : manual;
  const FORCE = optIdx >= 0 && OPTS[optIdx] ? OPTS[optIdx].f : null;
  // outlets carried by a manual trip ("+ Add trip"): they left the auto plan and their
  // quantities come from the manual allocation — every fold that lists the plan's
  // outlets must include them too, or their numbers are invisible (2026-11-18 bug)
  const MOVED = (EXTRAS || []).flatMap((e) => e.ids || []);

  // restore this date's saved plan once every data source (outlets config, closing
  // stock, CK opening) has settled — the loaders' redo() above drops overrides, so
  // this runs after them.
  // Declared after OPTS because the deps array reads OPTS during render.
  useEffect(() => {
    if (!date || stockInfo == null || ckInfo == null || configInfo == null || restored.current === date) return;
    restored.current = date;
    const p = readJSON(planKey(date));
    if (p.OV) setOV(p.OV);
    if (p.OVB) setOVB(p.OVB);
    if (p.OVT) setOVT(p.OVT);
    if (p.SELV) setSELV(p.SELV);
    if (p.EXTRAS) setEXTRAS(Array.isArray(p.EXTRAS) ? p.EXTRAS : []);
    if (p.NOEX) setNOEX(Array.isArray(p.NOEX) ? p.NOEX : []);
    if (p.manual) { setManual(p.manual); setOptIdx(-1); }
    else if (typeof p.optIdx == "number" && p.optIdx >= 0 && (!p.optLabel || (OPTS[p.optIdx] ? OPTS[p.optIdx].l : null) == p.optLabel)) setOptIdx(p.optIdx);
    if (p.ck) setCK((a) => with1d(a, p.ck));
    if (p.ps) setPS((m) => withEdits(m, p.ps));
    if (p.pq) setPQ((m) => withEdits(m, p.pq));
  }, [date, stockInfo, ckInfo, configInfo, OPTS]);

  const view = useMemo(() => {
    if (!d || !planning || !configOk) return null;
    // manual trips: the outlets they carry leave the auto plan entirely (they
    // cannot ride both), and each extra run is one row in EXTRAS
    const moved = (EXTRAS || []).flatMap((e) => e.ids || []);
    const P = buildPlan(ctx, SEL.filter((o) => !moved.includes(o)), effSt, effD, true);
    // quantities for the manual runs: the same allocation rules (shelf-life
    // fill, per-outlet min/max, typed overrides) continuing from the auto
    // plan's leftover kitchen stock, so nothing is counted twice
    const mAlloc = moved.length
      ? allocate(ctx, moved, effSt, effD, true, P.ckLeft.slice())
      : { q: {}, u: {}, T: {}, left: P.ckLeft };
    const mTrips = (EXTRAS || []).map((e, i) => {
      const ids = orderStops(ctx, (e.ids || []).filter((o) => o != null));
      if (!ids.length) return null;
      const perOutlet = Object.fromEntries(ids.map((o) => [o, mAlloc.u[o] || 0]));
      const opts = vehicleOptions(ctx, ids, perOutlet, true, "mumbai");
      const c = opts.find((x) => x.k === e.vk) || opts[0];
      const U = sum(ids.map((o) => mAlloc.u[o] || 0));
      const t = { key: "x" + i, ids, kind: c.pune ? "pune" : "mumbai", manual: true, U, o: opts };
      t.noFit = !opts.some((x) => x.valid);
      return { t, c, stops: ids, km: routeKm(ctx, ids), mins: routeMinutes(ctx, ids), U, over: c.used - c.cap };
    }).filter(Boolean);
    // the merged plan the rest of the page works off (challans, PO, week table)
    const P2 = {
      ...P,
      q: { ...P.q, ...mAlloc.q },
      u: { ...P.u, ...mAlloc.u },
      trips: [...P.trips, ...mTrips.map((x) => x.t)],
      ids: [...P.ids, ...mTrips.flatMap((x) => x.stops)],
    };
    P2.tot = sum(P2.ids.map((o) => P2.u[o] || 0));
    let totU = 0, veh = 0, dkg = 0, dkc = 0, ctc = 0, tot = 0;
    const trips = P2.trips.map((t) => {
      const mt = t.manual ? mTrips.find((x) => x.t.key === t.key) : null;
      const c = mt ? mt.c : pickOpt(t, true, FORCE, SELV);
      const stops = c.returnRun ? c.runs.flatMap((r) => r.ids) : t.ids;
      const km = c.returnRun ? sum(c.runs.map((r) => routeKm(ctx, r.ids))) : routeKm(ctx, t.ids);
      const mins = c.returnRun ? sum(c.runs.map((r) => routeMinutes(ctx, r.ids))) : routeMinutes(ctx, t.ids);
      const U = c.returnRun ? c.U : t.U;
      totU += U; veh += c.veh; tot += c.c;
      if (c.m == "t") { dkg += c.pk / 90; dkc += c.pk; } else ctc += c.pk;
      return { t, c, stops, km, mins, U, over: c.used - c.cap };
    });
    const chosenIds = trips.flatMap((x) => x.stops);
    const snd = FL.map((_f, i) => sum(chosenIds.map((o) => (P2.q[o] || [])[i] || 0)));
    const ckT = ckTot(CK), sT = sum(snd);
    // tomorrow preview: stock after today's dispatch, then tomorrow's sales.
    // An outlet we are already serving today is never listed — the owner sees
    // only NEW problems left for tomorrow (owner rule 2026-11-18)
    const tmSt = projectStock(ctx, effSt, effD, Object.fromEntries(chosenIds.map((o) => [o, P2.u[o] || 0])), addDays(effD, 1));
    const tmInfo = criticality(ctx, tmSt, addDays(effD, 1));
    return {
      P: P2, trips, totU, veh, dkg, dkc, ctc, tot,
      snd, ckT, sT, left: ckT - sT,
      chosenIds,
      tmCritical: tmInfo.filter((x) => x.critical && !chosenIds.includes(x.o)),
      costs: OPTS.map((op) => {
        if (!op.ids.length) return null;
        const p2 = buildPlan(ctx, op.ids, effSt, effD, false);
        const cc = planCost(ctx, p2, {}, op.f);
        return cc.tarts ? cc.cpt : null;
      }),
      week: engineWeekRows(ctx, P2, PROD, { ...SELV, ...Object.fromEntries(mTrips.map((x) => [x.t.key, x.c.k])) }, FORCE, isoDate(effD)),
    };
  }, [d, planning, configOk, ctx, SEL, SELV, FORCE, EXTRAS, effSt, effD, capw, CK, PROD, OPTS, LLS, KITP]);

  // Sunday preview: which outlets would be critical on Monday (shown while the
  // kitchen is closed, before the owner decides on an emergency dispatch)
  const sunPreview = useMemo(
    () => (d && sunday ? criticality(ctx, effSt, effD).filter((x) => x.critical) : []),
    [d, sunday, ctx, effSt, effD]
  );

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

  /* ----- manual trips ("+ Add trip" in the Vehicles section) ----- */

  // persist EXTRAS and mirror it into this date's saved plan
  const saveExtras = (nE) => {
    setEXTRAS(nE);
    savePlan({ EXTRAS: nE });
  };
  // commit the "+ Add trip" form: { vk, ids } — the vehicle and the outlets
  const addExtra = () => {
    const ids = (newTrip.ids || []).filter((o) => o != null && !EXTRAS.some((e) => (e.ids || []).includes(o)));
    if (!newTrip.vk || !ids.length) return;
    saveExtras(EXTRAS.concat({ vk: newTrip.vk, ids }));
    setNewTrip(null);
  };
  const removeExtra = (i) => saveExtras(EXTRAS.filter((_e, j) => j != i));
  // refuse a free extra drop for today ("✕" next to it on the trip card): the
  // outlet stays home unless the planner picks it as a real stop on its own
  const removeExtraStop = (o) => {
    const n = NOEX.includes(o) ? NOEX : NOEX.concat(o);
    setNOEX(n);
    savePlan({ NOEX: n });
  };
  // change a manual trip's vehicle (stored in EXTRAS — redo() must not lose it)
  const setExtraVeh = (i, vk) => saveExtras(EXTRAS.map((e, j) => (j == i ? { ...e, vk } : e)));
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
  // drop an outlet's typed overrides (total / boxes) — the engine's own rules
  // (shelf-life fill, min/max) set the quantity again; e.g. clears a stale
  // typed total that kept forcing an odd number onto an outlet
  const clearOverride = (o) => {
    const nT = del(OVT, o);
    const nB = del(OVB, o);
    setOVT(nT); setOVB(nB);
    savePlan({ OVT: nT, OVB: nB });
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

  /* ----- Send PO + delivery challans (spec sections 15-16) ----- */

  const challanItems = (o) => [
    ...FL.map((f, i) => ({ name: f[0], sku: skus[normItem(f[0])] || null, qty: (view?.P.q[o] || [])[i] || 0, unit: "piece" })),
    ...PK.map((n, j) => ({ name: n, sku: null, qty: (PQ[o] || [])[j] || 0, unit: "piece" })),
    ...GN.map((n, k) => ({ name: n, sku: null, qty: (PQ[o] || [])[k + 4] || 0, unit: "gram" })),
  ].filter((x) => x.qty > 0);

  const downloadChallans = () => {
    if (!view) return;
    let n = 0;
    view.trips.forEach(({ t, c }) => {
      const stops = c.returnRun ? c.runs.flatMap((r) => r.ids) : t.ids;
      stops.forEach((o) => {
        const items = challanItems(o);
        if (!items.length) return;
        n++;
        generateDeliveryChallan({
          outletName: N[o],
          outletAddress: (addr && addr[o]) || "",
          outletContact: (poc && poc[o]) || "",
          items,
          dispatchDate: date,
          company: brand?.company || undefined,
          fssai: brand?.fssai_no != null ? String(brand.fssai_no) : "",
          expiryDays: R.challanExpiryDays,
        });
      });
    });
    return n;
  };

  const sendPo = async () => {
    if (!view || !view.trips.length) return;
    setSending(true);
    setSendMsg(null);
    const payload = {
      dispatch_date: date,
      total_tarts: view.totU,
      total_cost: view.tot,
      cost_per_tart: view.totU ? view.tot / view.totU : null,
      dry_ice_kg: view.dkg,
      challan_expiry_days: R.challanExpiryDays,
      plan_json: {
        date, sel: SEL, force: FORCE,
        trips: view.trips.map(({ t, c }) => ({ kind: t.kind, ids: t.ids, k: c.k, l: c.l })),
        q: view.P.q, u: view.P.u, tot: view.totU,
      },
      trips: view.trips.map(({ t, c }) => ({
        vehicle_key: c.k,
        vehicle_label: c.l,
        stops: (c.returnRun ? c.runs.flatMap((r) => r.ids) : t.ids).map((o) => ({
          outlet: N[o],
          outlet_id: (ids && ids[o]) ?? null,
          address: (addr && addr[o]) || null,
          contact: (poc && poc[o]) || null,
          tarts: view.P.u[o] || 0,
          items: FL.map((f, i) => ({ name: f[0], qty: (view.P.q[o] || [])[i] || 0 })).filter((x) => x.qty > 0),
          packaging: PK.map((n, j) => ({ name: n, qty: (PQ[o] || [])[j] || 0 })).filter((x) => x.qty > 0),
          garnishing: GN.map((n, k) => ({ name: n, qty: (PQ[o] || [])[k + 4] || 0 })).filter((x) => x.qty > 0),
        })),
      })),
    };
    try {
      const res = await fetch("/api/planner/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSendMsg({ ok: false, text: j.error || "Send failed (" + res.status + ")" });
      } else {
        const n = downloadChallans();
        setSendMsg({ ok: true, text: `Plan #${j.id} saved (${j.items_saved} item rows). ${n} challan${n == 1 ? "" : "s"} downloading…` });
      }
    } catch (e) {
      setSendMsg({ ok: false, text: e.message });
    }
    setSending(false);
  };

  if (!date) return <div className="full-bleed min-h-screen bg-slate-50 p-6 pt-20 text-sm text-slate-500 md:p-10">Loading…</div>;

  return (
    <div className="full-bleed min-h-screen bg-slate-50 pt-14 pb-20 text-base text-slate-900 md:pt-0">
      <div className="mx-auto max-w-[1100px] px-3 sm:px-5">
        {/* header */}
        <header className="flex flex-wrap items-center justify-between gap-3 py-4">
          <h1 className="text-lg font-semibold tracking-tight">Dispatch plan · {dateLabel(d)}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={date}
              onChange={(e) => { if (e.target.value) { restored.current = null; setForceSunday(false); setDate(e.target.value); redo(); } }}
              aria-label="Dispatch date"
              className="cursor-pointer rounded-full border border-slate-200 bg-white px-3 py-1.5 dark:border-slate-700 dark:bg-slate-900"
            />
            <label className="flex items-center gap-2 rounded-full border border-slate-200 bg-white py-1 pl-3 pr-1 dark:border-slate-700 dark:bg-slate-900">
              <span className={mute}>Days of stock</span>
              <NumInput
                value={D}
                step={0.5}
                label="Days of stock"
                onCommit={(v) => { const x = Math.max(0.5, v || 2); saveSetting("days_of_stock", "daysOfStock", x); redo(); if (date) writeJSON(planKey(date), clearedPlan()); }}
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
            <button
              onClick={() => setRulesOpen(true)}
              aria-label="Settings"
              title="Settings"
              className="cursor-pointer rounded-full border border-slate-200 bg-white px-3 py-1.5 text-lg leading-none hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
            >
              ⚙
            </button>
          </div>
        </header>

        {/* settings popup — opened from the header gear. Global values live in the
            planner_settings + vehicles DB rows, per-outlet values in the outlets
            table; every change applies to the plan instantly and saves to the DB */}
        {rulesOpen && (
          <div
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8"
            onClick={() => setRulesOpen(false)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Settings"
              onClick={(e) => e.stopPropagation()}
              className={`${card} w-full max-w-[760px]`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={title}>Settings</span>
                  <span className={mute}>
                    {VEH == null || rules == null
                      ? "database: loading…"
                      : (vehInfo && !vehInfo.ok) || (rulesInfo && !rulesInfo.ok)
                        ? "database unreachable — defaults in use (run supabase_migration_planner_v9.sql)"
                        : "stored in the database (planner_settings + vehicles + outlets)"}
                  </span>
                  {rulesMsg && (
                    <Badge t={rulesMsg.ok === false ? "red" : rulesMsg.ok ? "green" : "amber"}>{rulesMsg.text}</Badge>
                  )}
                </div>
                <button
                  onClick={() => setRulesOpen(false)}
                  aria-label="Close"
                  className="cursor-pointer rounded-full px-2 py-0.5 text-lg leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                >
                  ✕
                </button>
              </div>

              <div className="mt-3 font-semibold">Dispatch rules</div>
              <div className="mt-2 flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2">
                  <span className={mute}>Radius (km)</span>
                  <NumInput value={R.ecoRadiusKm} label="Radius km" onCommit={(v) => saveSetting("eco_radius_km", "ecoRadiusKm", Math.max(0.5, v || 5))} w="w-14" />
                </label>
                <label className="flex items-center gap-2">
                  <span className={mute}>Minimum tarts per outlet</span>
                  <NumInput value={R.minTartsPerOutlet} label="Minimum tarts per outlet" onCommit={(v) => saveSetting("min_tarts_per_outlet", "minTartsPerOutlet", Math.max(0, Math.round(v) || 0))} w="w-16" />
                </label>
              </div>

              <div className="mt-4 font-semibold">Vehicles</div>
              <div className={`${mute} mt-1`}>
                Name, capacity, fares and stop limits per vehicle — saved to the vehicles table. Tray vans count 60L-box slots; the freezer van counts cartons. The 3-wheeler is charged per drop; the freezer van&apos;s Pune fare is the two-drop total.
              </div>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className={th}>Vehicle</th>
                      <th className={th}>Capacity</th>
                      <th className={th}>Trip fare ₹</th>
                      <th className={th}>Pune fare ₹</th>
                      <th className={th}>Max stops</th>
                      <th className={th}>Eco within / beyond radius</th>
                    </tr>
                  </thead>
                  <tbody>
                    {["es", "el", "ef", "pv"].map((k) => {
                      const v = V(k);
                      return (
                        <tr key={k} className={row}>
                          <td className={td}>
                            <TextInput value={v.l} label={`${v.l} name`} onCommit={(s) => saveVehicle(k, "name", "l", s)} w="w-40" />
                          </td>
                          <td className={td}>
                            <div className="flex items-center gap-1">
                              <NumInput value={v.cap} label={`${v.l} capacity`} onCommit={(x) => saveVehicle(k, "box_capacity", "cap", Math.max(1, Math.round(x) || 1))} w="w-14" />
                              <span className="whitespace-nowrap text-sm text-slate-400">{v.m == "c" ? "cartons" : "slots"}</span>
                            </div>
                          </td>
                          <td className={td}>
                            {k == "pv" ? (
                              <span className={mute}>per drop</span>
                            ) : (
                              <NumInput value={v.flat} label={`${v.l} trip fare`} onCommit={(x) => saveVehicle(k, "flat_fare", "flat", Math.max(0, Math.round(x) || 0))} w="w-20" />
                            )}
                          </td>
                          <td className={td}>
                            {k == "ef" ? (
                              <NumInput value={v.puneFlat} label={`${v.l} Pune fare`} onCommit={(x) => saveVehicle(k, "pune_flat_fare", "puneFlat", Math.max(0, Math.round(x) || 0))} w="w-20" />
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className={td}>
                            <NumInput value={v.maxStops} label={`${v.l} max stops`} onCommit={(x) => saveVehicle(k, "max_stops", "maxStops", Math.max(1, Math.round(x) || 1))} w="w-12" />
                          </td>
                          <td className={td}>
                            {k == "es" ? (
                              <div className="flex items-center gap-1">
                                <NumInput value={v.maxNear} label="Eco max within radius" onCommit={(x) => saveVehicle(k, "max_near_stops", "maxNear", Math.max(0, Math.round(x) || 0))} w="w-12" />
                                <span className="text-slate-400">/</span>
                                <NumInput value={v.maxFar} label="Eco max beyond radius" onCommit={(x) => saveVehicle(k, "max_far_stops", "maxFar", Math.max(0, Math.round(x) || 0))} w="w-12" />
                              </div>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 font-semibold">Dispatch settings</div>
              <div className="mt-2 flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2">
                  <span className={mute}>Shelf life (days of stock to send)</span>
                  <NumInput value={R.shelfLifeDays} label="Shelf life days" onCommit={(v) => saveSetting("shelf_life_days", "shelfLifeDays", Math.max(1, v || 30))} w="w-16" />
                </label>
                <label className="flex items-center gap-2">
                  <span className={mute}>Kitchen storage limit</span>
                  <NumInput value={R.cksLimit} label="Kitchen storage limit" onCommit={(v) => saveSetting("cks_limit", "cksLimit", Math.max(0, Math.round(v) || 4000))} w="w-20" />
                </label>
              </div>

              <div className="mt-4 font-semibold">Packaging</div>
              <div className={`${mute} mt-1`}>
                Prices the packing lists — cartons for the freezer van, dry ice (kg, by trip distance) for the tray vans, and the trays-per-carton that sizes the freezer van&apos;s capacity (32 trays × 6 tarts = 192 per carton). Saved to planner_settings.
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2">
                  <span className={mute}>Carton ₹ / carton</span>
                  <NumInput value={R.cartonRs} label="Carton cost" onCommit={(v) => saveSetting("carton_rs", "cartonRs", Math.max(0, Math.round(v) || 0))} w="w-16" />
                </label>
                <label className="flex items-center gap-2">
                  <span className={mute}>Dry ice ₹ / kg</span>
                  <NumInput value={R.dryIceRsPerKg} label="Dry ice cost per kg" onCommit={(v) => saveSetting("dry_ice_rs_per_kg", "dryIceRsPerKg", Math.max(0, Math.round(v) || 0))} w="w-16" />
                </label>
                <label className="flex items-center gap-2">
                  <span className={mute}>Trays per carton</span>
                  <NumInput value={R.traysPerCarton} label="Trays per carton" onCommit={(v) => saveSetting("trays_per_carton", "traysPerCarton", Math.max(1, Math.round(v) || 32))} w="w-14" />
                </label>
              </div>

              <div className="mt-4 font-semibold">Outlets</div>
              <div className={`${mute} mt-1`}>
                Weekday avg sales / weekend daily avg sales / freezer capacity / min &amp; max send per outlet — saved to the outlets table (empty = the global rules apply; a typed 0 is a real zero: max 0 sends nothing, min 0 is no forced minimum). The company name and FSSAI number on the delivery challans come from the brands table.
              </div>
              {ids == null ? (
                <div className={`${mute} mt-2`}>loading the outlets table…</div>
              ) : (
                <div className="mt-2 max-h-80 overflow-y-auto rounded-xl border border-slate-100 dark:border-slate-800">
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        <th className={th}>Outlet</th>
                        <th className={th}>Weekday avg sales</th>
                        <th className={th}>Weekend daily avg</th>
                        <th className={th}>Freezer capacity</th>
                        <th className={th}>Min send</th>
                        <th className={th}>Max send</th>
                      </tr>
                    </thead>
                    <tbody>
                      {N.map((n, o) => (
                        <tr key={n} className={row}>
                          <td className={`${td} whitespace-nowrap font-medium`}>
                            {n}
                            {ids[o] == null && <Badge t="amber">no DB row</Badge>}
                          </td>
                          <td className={td}><NumInput value={WD?.[o] ?? 0} label={`${n} weekday avg sales`} onCommit={(v) => saveOutlet(o, "weekday_avg", "wd", v)} w="w-16" /></td>
                          <td className={td}><NumInput value={WE?.[o] ?? 0} label={`${n} weekend daily avg sales`} onCommit={(v) => saveOutlet(o, "weekend_avg", "we", v)} w="w-16" /></td>
                          <td className={td}><NumInput value={capw?.[o] ?? 0} label={`${n} freezer capacity`} onCommit={(v) => saveOutlet(o, "fridge_capacity", "capw", v)} w="w-20" /></td>
                          <td className={td}><OptNumInput value={mins?.[o] ?? null} label={`${n} min send quantity`} onCommit={(v) => saveOutlet(o, "min_send_qty", "mins", v == null ? null : Math.round(v))} w="w-16" /></td>
                          <td className={td}><OptNumInput value={maxs?.[o] ?? null} label={`${n} max send quantity`} onCommit={(v) => saveOutlet(o, "max_send_qty", "maxs", v == null ? null : Math.round(v))} w="w-16" /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className={`${mute} mt-2`}>
                Private 3-wheeler: 1–{V("pv").maxStops} stops. Eco (small van): at most {V("es").maxNear} stops within {R.ecoRadiusKm} km of the kitchen + {V("es").maxFar} beyond, {V("es").maxStops} total — on a full mixed load it drops the near stops first and comes back to the kitchen before the far run. Large van and freezer van: up to {V("el").maxStops}/{V("ef").maxStops} stops anywhere in Mumbai; when the load outgrows one van the planner switches to the next bigger one automatically, and a trip nothing can carry is flagged in red. Flat-fare trips may also top up nearby outlets from the kitchen leftover as free extra drops — only outlets that are running out qualify (total stock under the critical bar, or 2+ flavours under 2 days); a ✕ on the trip card refuses one for the day. Minimum tarts: an outlet the planner picks itself always receives at least this much when the freezer has room — typed manual numbers always win; a typed 0 is a real zero (min 0 = no forced minimum for that outlet). Shelf life caps how much an outlet gets in one go (sales over N days — the product lasts 30 days from manufacturing, made the day before dispatch); the challans show the expiry (30 days from manufacturing). Every change applies to the plan immediately and saves to the database, so it holds on every device.
              </div>
            </div>
          </div>
        )}

        {!configOk ? (
          configInfo == null ? (
            <div className={`${card} text-center font-medium text-slate-500`}>Loading outlet config…</div>
          ) : (
            <div className={card}>
              <div className="font-semibold text-rose-600">Outlet setup incomplete</div>
              <div className={`${mute} mt-1`}>
                The planner takes coordinates, freezer capacity and the sales averages only from the outlets table — fill in the missing values there (or in the ⚙ popup), then retry.
                <div className="mt-1">
                  {cfg ? (
                    <>
                      {cfg.colsMissing && <div>the table has no latitude/longitude columns yet — run outlets_add_coords.sql</div>}
                      {cfg.tableRows == 0 && <div>the table returned no active outlets</div>}
                      {cfg.missingRows.length > 0 && <div>no active row in the table for: {cfg.missingRows.join(", ")}</div>}
                      {cfg.missingCoords.length > 0 && <div>no coordinates for: {cfg.missingCoords.join(", ")}</div>}
                      {cfg.missingCap.length > 0 && <div>no freezer capacity for: {cfg.missingCap.join(", ")}</div>}
                      {cfg.missingSales.length > 0 && <div>no weekday/weekend sales for: {cfg.missingSales.join(", ")}</div>}
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
        ) : sunday && !forceSunday ? (
          /* Sunday: the kitchen is closed (spec section 13). Show Monday's plan and let
             the owner force an emergency dispatch with today's date. */
          <div className="flex flex-col gap-3">
            <div className={card}>
              <div className="font-semibold text-rose-600">Sunday — kitchen closed</div>
              <div className={`${mute} mt-1`}>
                Monday&apos;s plan is ready below ({dateLabel(effD)} dispatch). No dispatch happens today unless you press the emergency button — the delivery challans would then carry today&apos;s date.
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {sunPreview.length == 0 ? (
                  <span className={mute}>Nothing critical on Monday — no dispatch needed.</span>
                ) : (
                  <>
                    <span className={mute}>Monday needs:</span>
                    {sunPreview.map((x) => (
                      <Badge key={x.o} t="amber">⚡ {N[x.o]} · {x.reason}</Badge>
                    ))}
                  </>
                )}
              </div>
              <button
                onClick={() => setForceSunday(true)}
                className="mt-3 cursor-pointer rounded-full bg-rose-600 px-4 py-1.5 font-medium text-white hover:bg-rose-500"
              >
                Dispatch today anyway (emergency)
              </button>
            </div>
            <div className={`${card} ${mute}`}>The full Monday plan appears here after you force the dispatch.</div>
          </div>
        ) : !view ? (
          <div className={`${card} text-center font-medium text-rose-600`}>Plan unavailable — reload the page.</div>
        ) : (
          <>
            {view.trips.length == 0 && (
              /* "No dispatch today" (spec section 13). When outlets are selected but the
                 kitchen couldn't fill them, the message says so instead. */
              <div className={`${card} mb-3 border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300`}>
                <div className="font-semibold">{SEL.length > 0 ? "Nothing to load today" : "No dispatch today"}</div>
                <div className={`mt-1 ${mute}`}>
                  {SEL.length > 0
                    ? "Outlets are selected but the kitchen couldn't fill them (see the Kitchen card below). No vehicle is sent without at least one real drop."
                    : `Nothing is critical under ${D} days of stock. Pick outlets by hand below, or adjust “Days of stock”, “Shelf life” or the sales numbers in the ⚙ popup.`}
                </div>
              </div>
            )}

            {/* grid: cost + options share the top row on wide screens, everything
                else spans both columns one by one (order-* sets the sequence) */}
            <div className={`grid gap-3 lg:gap-x-5 ${OPTS.length > 0 ? "lg:grid-cols-2" : ""}`}>
              {/* all sections stack one by one (single column) */}
              <div className="contents">
                {/* outlets */}
                <section className={`${card} order-4 lg:col-span-2`}>
                  <div className="mb-2 flex items-center justify-between">
                    <h2 className={title}>Outlets{sunday && forceSunday ? " · Monday plan (emergency)" : ""}</h2>
                    <span className={mute}>⚡ under {D} days</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {N.map((n, o) => {
                      const info = view.P.info[o];
                      const cv = info ? info.cover : null;
                      const crit = info ? info.critical : false;
                      const on = SEL.includes(o);
                      const deferred = (view.P.deferred || []).some((x) => x.o === o);
                      return (
                        <button
                          key={o}
                          onClick={() => toggleOutlet(o)}
                          title={(info ? info.reason : "") + (NOEX.includes(o) ? " · free extra drop removed for today (✕ on the trip card)" : "")}
                          className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                            on
                              ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900"
                              : "border-slate-200 bg-white hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900"
                          }`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${crit ? "bg-rose-500" : cv != null && cv < D + 1 ? "bg-amber-400" : "bg-emerald-500"}`} />
                          {crit && "⚡"}
                          {n}
                          <span className="tabular-nums opacity-60">
                            {effSt[o]} · {cv == null || cv === Infinity ? "–" : cv.toFixed(1) + "d"}
                          </span>
                          {deferred && <Badge t="amber">waits</Badge>}
                          {MOVED.includes(o) && <Badge t="green">manual trip</Badge>}
                          {NOEX.includes(o) && !SEL.includes(o) && <Badge t="amber">extra removed</Badge>}
                        </button>
                      );
                    })}
                  </div>
                  {(view.P.deferred || []).length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {view.P.deferred.map((x) => (
                        <Badge key={x.o} t="amber">⏸ {N[x.o]}: {x.reason}</Badge>
                      ))}
                    </div>
                  )}
                  {view.chosenIds.length > 0 && view.tmCritical.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className={mute}>Tomorrow after this dispatch:</span>
                      {view.tmCritical.map((x) => (
                        <Badge key={x.o} t="red">⚡ {N[x.o]} · {x.reason}</Badge>
                      ))}
                    </div>
                  )}
                </section>

                {/* vehicles and boxes */}
                <section className="order-5 flex flex-col gap-3 lg:col-span-2">
                  <div className="flex items-center justify-between px-1">
                    <h2 className={title}>Vehicles</h2>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setNewTrip((o) => (o ? null : { vk: null, ids: [] }))}
                        className="cursor-pointer rounded-full bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-700 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                      >
                        {newTrip ? "Close" : "+ Add trip"}
                      </button>
                      {view.trips.length > 0 && (
                        <button
                          onClick={() => copyList("all", allTripsCopyText(ctx, view, d))}
                          className="cursor-pointer rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
                        >
                          {copied === "all" ? "Copied ✓" : "Copy all lists"}
                        </button>
                      )}
                    </div>
                  </div>
                  {newTrip && (
                    <div className={card}>
                      <div className="font-semibold">Add a trip</div>
                      <div className={`${mute} mt-1`}>
                        Send an extra run with a vehicle of your choice: pick the vehicle and the outlets. Their planned quantities move onto this run (and off the auto plan) — a fresh allocation rules the amount, still editable in each outlet&apos;s quantities fold (outlets on a manual trip are listed there too, tagged “manual trip”, and marked in the Outlets row). Trips on flat-fare vehicles can also pick up nearby outlets automatically as <span className="font-medium">free extra drops</span> (tagged “extra drop” on the trip card) — only outlets that are genuinely running low qualify (total stock under the critical bar, or 2+ flavours under 2 days), and the ✕ next to one refuses it for today.
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {["es", "el", "ef", "pv"].map((k) => (
                          <button
                            key={k}
                            onClick={() => setNewTrip((n) => ({ ...n, vk: k }))}
                            className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm font-medium ${newTrip.vk == k ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900" : "border-slate-200 bg-white hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"}`}
                          >
                            {V(k).l}
                          </button>
                        ))}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {N.map((name, o) => {
                          const on = newTrip.ids.includes(o);
                          const taken = !on && EXTRAS.some((e) => (e.ids || []).includes(o));
                          return (
                            <button
                              key={o}
                              disabled={taken}
                              onClick={() => setNewTrip((n) => ({ ...n, ids: on ? n.ids.filter((x) => x != o) : n.ids.concat(o) }))}
                              className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40 ${on ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900" : "border-slate-200 bg-white hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"}`}
                            >
                              {name}
                            </button>
                          );
                        })}
                      </div>
                      <div className="mt-3 flex justify-end gap-2">
                        <button
                          onClick={() => setNewTrip(null)}
                          className="cursor-pointer rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={addExtra}
                          disabled={!newTrip.vk || newTrip.ids.length == 0}
                          className="cursor-pointer rounded-full bg-slate-900 px-4 py-1.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                        >
                          Add trip
                        </button>
                      </div>
                    </div>
                  )}
                  {view.trips.length == 0 && <div className={`${card} ${mute}`}>No outlet selected.</div>}
                  {view.trips.map(({ t, c, stops, km, mins, U, over }, ti) => (
                    <div key={t.key} className={card} style={{ borderLeft: `4px solid ${COL[ti % 4]}` }}>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-semibold">
                            Trip {ti + 1}
                            {t.manual && <Badge t="green">manual run</Badge>}
                            {c.returnRun && <Badge t="amber">return run — 2 legs, 1 fare</Badge>}
                            {t.kind == "pune" && <Badge t="amber">Pune</Badge>}
                            {t.noFit && <Badge t="red">load over the biggest van — reduce quantities or split</Badge>}
                          </div>
                          <div className={mute}>
                            {c.returnRun
                              ? c.runs.map((r) => r.ids.map((o) => N[o]).join(" → ")).join("   ⟲   ")
                              : "Kitchen → " + t.ids.map((o) => N[o]).join(" → ")}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-semibold tabular-nums">{U} tarts</div>
                          <div className={mute}>
                            {Math.round(km)} km · ~{Math.round(mins)} min
                            {c.returnRun ? " · both legs" : ""}
                            {t.kind == "pune" ? " · Pune" : ""}
                          </div>
                        </div>
                      </div>

                      <VehicleSelect
                        options={t.o}
                        value={c.k}
                        onChange={(k) => {
                          if (t.manual) { setExtraVeh(Number(String(t.key).slice(1)), k); return; }
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
                        {c.k != "pv" && !c.returnRun && stops.length < 4 && <Badge t="amber">under 4 stops</Badge>}
                        {c.perDrop && stops.length > 5 && <Badge t="amber">{stops.length} drops — usually 4-5</Badge>}
                        {t.manual && (
                          <button
                            onClick={() => removeExtra(Number(String(t.key).slice(1)))}
                            className="cursor-pointer whitespace-nowrap rounded-full border border-rose-200 bg-white px-3 py-1.5 text-sm font-medium text-rose-600 hover:bg-rose-50 dark:border-rose-900 dark:bg-slate-900 dark:text-rose-300 dark:hover:bg-rose-950"
                          >
                            Remove trip
                          </button>
                        )}
                        <button
                          onClick={() => copyList(ti, tripCopyText(ctx, ti, t, c, km, view.P, d))}
                          className="ml-auto cursor-pointer whitespace-nowrap rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
                        >
                          {copied === ti ? "Copied ✓" : "Copy packing list"}
                        </button>
                      </div>

                      {c.returnRun && (
                        /* the two legs of a return run: near drops first, back to the
                           kitchen to reload, then the far run on the same flat fare */
                        <div className="mt-2 overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead><tr><th className={th}>Leg</th><th className={th}>Stops</th><th className={th}>Tarts</th><th className={th}>Boxes</th></tr></thead>
                            <tbody>
                              {c.runs.map((r, ri) => (
                                <tr key={ri} className={row}>
                                  <td className={td}>{r.label}</td>
                                  <td className={td}>{r.ids.map((o) => N[o]).join(" → ")}</td>
                                  <td className={`${td} tabular-nums`}>{r.U}</td>
                                  <td className={`${td} tabular-nums`}>{r.used}/{c.cap} slots</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      <div className="mt-2">
                        {stops.map((o, i) => {
                          const bx = c.returnRun
                            ? c.runs.map((r) => r.bx).flat()[i]
                            : c.bx[i];
                          const auto = !!c.returnRun;
                          return (
                            <div key={o} className={`${row} flex flex-wrap items-center justify-between gap-2 py-1.5`}>
                              <div>
                                <div className="font-medium">
                                  {N[o]}
                                  {auto && <span className={`${mute} font-normal`}> · auto</span>}
                                  {t.extras?.ids?.includes(o) && (
                                    <>
                                      {" "}
                                      <Badge t="green">extra drop</Badge>
                                      <button
                                        onClick={() => removeExtraStop(o)}
                                        title="Remove this free drop — the outlet stays home today (it can still be picked normally on another day)"
                                        className="ml-1 cursor-pointer rounded-full border border-slate-200 px-1.5 text-xs font-medium text-slate-400 hover:border-rose-300 hover:text-rose-600 dark:border-slate-700 dark:hover:border-rose-800 dark:hover:text-rose-300"
                                      >
                                        ✕
                                      </button>
                                    </>
                                  )}
                                  {(ctx.OVT?.[o] != null || ctx.OVB?.[o] != null) && <Badge t="amber">typed</Badge>}
                                </div>
                                <div className={mute}>
                                  {view.P.u[o] || 0} tarts · holds {bcap(bx)}{c.m == "t" ? ` · ${dry(ctx, o, bx).toFixed(1)} kg ice` : ""}
                                </div>
                              </div>
                              <div className="flex items-center gap-1 text-sm text-slate-500">
                                {c.m == "c" ? (
                                  <>
                                    <NumInput value={bx.c} label={`${N[o]} cartons`} onCommit={(v) => editBoxes(o, { m: "c", c: v })} w="w-14" />
                                    cartons
                                  </>
                                ) : auto ? (
                                  <span className="tabular-nums">{bx.a} × 60L + {bx.b} × 30L</span>
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
                          {fm(c.c)} <span className="font-normal text-slate-500">· {cpt(U ? c.c / U : NaN)}/tart</span>
                        </span>
                      </div>
                    </div>
                  ))}
                </section>

                {/* send PO + challans */}
                <section className="order-6 lg:col-span-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-slate-900 p-3 text-white shadow-sm dark:bg-slate-800">
                    <div>
                      <div className="font-semibold">Send PO</div>
                      <div className="text-sm text-slate-400">
                        Saves the plan to dispatch history, then prints one delivery challan per outlet
                        {sunday && forceSunday ? " (dated TODAY — emergency)" : ""}.
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={downloadChallans}
                        disabled={view.trips.length == 0}
                        className="cursor-pointer rounded-full border border-white/30 px-3 py-1.5 text-sm font-medium hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Challans only
                      </button>
                      <button
                        onClick={sendPo}
                        disabled={sending || view.trips.length == 0}
                        className="cursor-pointer rounded-full bg-emerald-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {sending ? "Sending…" : "Send PO"}
                      </button>
                    </div>
                  </div>
                  {sendMsg && (
                    <div className={`mt-2 text-sm font-medium ${sendMsg.ok ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                      {sendMsg.text}
                    </div>
                  )}
                </section>

                {/* quantities and stock */}
                <section className="order-7 flex flex-col gap-3 lg:col-span-2">
                  <h2 className={`${title} px-1`}>Quantities</h2>
                  {SEL.length == 0 && MOVED.length == 0 && <div className={`${card} ${mute}`}>No outlet selected.</div>}
                  {/* manual-trip outlets ride at the end: their quantities come from the
                     manual allocation and they are only visible/editable here */}
                  {SEL.concat(MOVED.filter((o) => !SEL.includes(o))).map((o) => {
                    const U = view.P.u[o] || 0, after = effSt[o] + U, rm = (capw[o] || 0) - after;
                    const info = view.P.info[o];
                    const cv = info ? info.cover : NaN;
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
                              {U < r6((capw[o] || 0) - effSt[o]) && <Badge t="amber">partial fill</Badge>}
                              {info && info.low.length > 0 && <Badge t="amber">{info.low.length} low flavour{info.low.length == 1 ? "" : "s"}</Badge>}
                              {MOVED.includes(o) && <Badge t="green">manual trip</Badge>}
                              {ctx.OVT?.[o] != null && <Badge t="amber">typed total</Badge>}
                              {ctx.OVB?.[o] != null && <Badge t="amber">typed boxes</Badge>}
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
                            {(ctx.OVT?.[o] != null || ctx.OVB?.[o] != null) && (
                              <button
                                onClick={() => clearOverride(o)}
                                title="Remove the typed number — the planner's own rules (shelf life, min/max, stock) set this outlet's total again"
                                className="cursor-pointer rounded-full border border-slate-200 px-2 py-0.5 text-xs font-medium text-slate-500 hover:border-slate-400 hover:text-slate-700 dark:border-slate-700 dark:hover:border-slate-500 dark:hover:text-slate-300"
                              >
                                auto
                              </button>
                            )}
                          </label>
                          <span className={mute}>
                            {info ? info.reason : `${isNaN(cv) ? "–" : cv.toFixed(1)} days left`} · {WD[o]}/day · {WE[o]} weekends
                          </span>
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
                                    <td className={td}><NumInput value={(view.P.q[o] || [])[i] || 0} step={6} label={`${f[0]} send`} onCommit={(v) => editFlavour(o, i, v)} /></td>
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
                        <Badge t={view.left < 0 ? "red" : "green"}>{view.left} left</Badge>
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
                <section className={`${card} order-8 lg:col-span-2`}>
                  <h2 className={`${title} mb-2`}>Route</h2>
                  <RouteMap
                    trips={view.trips.map(({ stops }) => ({ ids: stops }))}
                    ll={LLS}
                    kit={KITP}
                  />
                </section>
              </aside>
            </div>

            {/* week plan */}
            <section className={`${card} mt-5`}>
              <h2 className={`${title} mb-2`}>Next 6 working days{sunday ? " (from Monday)" : ""}</h2>
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
                        <td className={`${td} tabular-nums ${r.close < 0 || r.close > R.cksLimit ? "font-semibold text-rose-600" : ""}`}>{Math.round(r.close)}</td>
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
              <Fold
                head={
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={title}>Stock of every outlet</span>
                    <span className={mute}>
                      {stockInfo == null
                        ? "closing stock: loading…"
                        : stockInfo.ok
                          ? "from the outlet team's closing-stock entries"
                          : "couldn't read stock"}
                    </span>
                    {stockInfo?.ok && stockInfo.sheet.used.length > 0 && (
                      <Badge t="amber">sheet fallback: {stockInfo.sheet.used.join(", ")}</Badge>
                    )}
                    {stockInfo?.ok && stockInfo.missing.length > 0 && (
                      <Badge t="amber">no entries: {stockInfo.missing.length}</Badge>
                    )}
                    {stockInfo?.ok && stockInfo.unknownItems.length > 0 && (
                      <Badge t="amber">unmatched items: {stockInfo.unknownItems.length}</Badge>
                    )}
                  </div>
                }
              >
                {stockInfo != null && !stockInfo.ok && (
                  <div className={`${mute} mb-2`}>
                    couldn&apos;t read stores_closing_stock{stockInfo.error ? ": " + stockInfo.error : ""} — run supabase_migration_planner_v8.sql in Supabase, then reload. The outlet team enters closing stock on the <a href="/shipment-planning/closing-stock" className="underline">Outlet Closing Stock</a> page.
                  </div>
                )}
                {stockInfo?.ok && (stockInfo.missing.length > 0 || stockInfo.sheet.used.length > 0 || stockInfo.unknownItems.length > 0 || stockInfo.sheet.error) && (
                  <div className={`${mute} mb-2`}>
                    {stockInfo.missing.length > 0 && <div>no closing-stock entries (shown as 0): {stockInfo.missing.join(", ")}</div>}
                    {stockInfo.sheet.used.length > 0 && <div>no entries yet — from the shared stock sheet ({stockInfo.sheet.date || "no date"}): {stockInfo.sheet.used.join(", ")}</div>}
                    {stockInfo.unknownItems.length > 0 && <div>entered but not matched to a planner flavour: {stockInfo.unknownItems.join(", ")}</div>}
                    {stockInfo.sheet.error && <div>sheet fallback failed: {stockInfo.sheet.error}</div>}
                  </div>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        <th className={th}>Product</th>
                        {N.map((n, o) => (
                          <th key={n} className={`${th} whitespace-nowrap`}>
                            {n}
                            <div className="font-normal">
                              {stockInfo == null
                                ? "…"
                                : stockInfo.ok
                                  ? stockInfo.closing[o] != null
                                    ? `closing ${stockInfo.closing[o]}`
                                    : stockInfo.sheet.used.includes(N[o])
                                      ? "from sheet"
                                      : "no entry"
                                  : "—"}
                            </div>
                          </th>
                        ))}
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
                <div className={`${mute} mt-2`}>
                  The numbers are the outlet team&apos;s daily closing-stock entries (newest at or before the dispatch date — entered on the <a href="/shipment-planning/closing-stock" className="underline">Outlet Closing Stock</a> page; outlets without entries fall back to the shared stock sheet). Typed cells are manual corrections.
                </div>
              </Fold>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
