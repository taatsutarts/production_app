"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseBrowser";

/* ---------- helpers ---------- */

const CK_OUTLET = 6; // central kitchen: only its spoilage counts as wastage here

const prettyName = (s) => {
  let t = (s || "").replace(/^#_#\s*/, "").replace(/\s*-\s*Taatsu$/i, "").replace(/^TTS\s+/i, "").trim();
  if (t && t === t.toUpperCase()) {
    t = t.toLowerCase().split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  }
  return t;
};

const todayStr = () => new Date().toLocaleDateString("en-CA");

const shiftDate = (str, days) => {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

const fmtDate = (str) => {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
};

// zero shows as "-" like the sheet
const fmt = (v) => (Number(v) ? Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "-");

const packSize = (batch_size) => {
  const n = parseFloat(String(batch_size || "").replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 1;
};

const ORDER = ["TARTS", "MINIS", "TART SHELLS", "DOUGH", "BLENDS & COMPOTE"];
const catRank = (c) => (ORDER.includes(c) ? ORDER.indexOf(c) : ORDER.length);

// { item_id: sum }
const sumMap = (list, valueFn) => {
  const m = new Map();
  for (const r of list || []) m.set(r.item_id, (m.get(r.item_id) || 0) + valueFn(r));
  return m;
};

const EMPTY = { disp: [], phys: [], prod: [], spoil: [], pPhys: [], pProd: [], pSpoil: [] };

const COLS = [
  { key: "opening", label: "Opening", head: "bg-sky-50 text-sky-700", cell: "bg-sky-50/50" },
  { key: "dispatch", label: "Dispatch", head: "bg-purple-50 text-purple-700", cell: "bg-purple-50/50" },
  { key: "post", label: "Opening Post Dispatch", head: "bg-purple-50 text-purple-700", cell: "bg-purple-50/50" },
  { key: "phys", label: "Physical Opening", head: "bg-purple-50 text-purple-700", cell: "bg-purple-50/50" },
  { key: "prod", label: "Production", head: "bg-emerald-50 text-emerald-700", cell: "bg-emerald-50/50" },
  { key: "waste", label: "Wastage", head: "bg-orange-50 text-orange-700", cell: "bg-orange-50/50" },
  { key: "closing", label: "Closing", head: "bg-emerald-100 text-emerald-800", cell: "bg-emerald-100/60 font-semibold" },
  { key: "variance", label: "Variance", head: "bg-amber-50 text-amber-700", cell: "bg-amber-50/50" },
];

/* ---------- page ---------- */

export default function DailyProductionReportPage() {
  const [date, setDate] = useState(todayStr());
  const [cat, setCat] = useState("TARTS");
  const [items, setItems] = useState([]);
  const [raw, setRaw] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState(null);

  /* ----- load ----- */

  // items: once
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("items")
        .select("id,item_name,category,batch_size")
        .eq("is_active", true)
        .order("item_name");
      if (error) setMsg({ type: "err", text: error.message });
      setItems(data || []);
    })();
  }, []);

  // everything for the date + the previous day, all in parallel
  const load = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    const prev = shiftDate(date, -1);
    const start = `${date}T00:00:00+00:00`;
    const end = `${shiftDate(date, 1)}T00:00:00+00:00`;

    const res = await Promise.all([
      supabase.from("dispatches").select("item_id,qty").not("item_id", "is", null).gte("dispatched_at", start).lt("dispatched_at", end),
      supabase.from("physical_opening").select("item_id,opening_qty").eq("opening_date", date),
      supabase.from("production").select("item_id,production_qty").eq("production_date", date),
      supabase.from("spoilages").select("item_id,full_qty,open_qty").eq("spoilage_date", date).eq("outlet_id", CK_OUTLET),
      supabase.from("physical_opening").select("item_id,opening_qty").eq("opening_date", prev),
      supabase.from("production").select("item_id,production_qty").eq("production_date", prev),
      supabase.from("spoilages").select("item_id,full_qty,open_qty").eq("spoilage_date", prev).eq("outlet_id", CK_OUTLET),
    ]);

    const failed = res.find((r) => r.error);
    if (failed) setMsg({ type: "err", text: failed.error.message });
    const [disp, phys, prod, spoil, pPhys, pProd, pSpoil] = res.map((r) => r.data || []);
    setRaw({ disp, phys, prod, spoil, pPhys, pProd, pSpoil });
    setLoading(false);
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  /* ----- derived ----- */

  const cats = useMemo(
    () => [...new Set(items.map((i) => i.category || "OTHER"))].sort((a, b) => catRank(a) - catRank(b) || a.localeCompare(b)),
    [items]
  );

  const table = useMemo(() => {
    const batch = new Map(items.map((i) => [i.id, i.batch_size]));
    const wasteOf = (r) => Number(r.full_qty) * packSize(batch.get(r.item_id)) + Number(r.open_qty);

    const dispatch = sumMap(raw.disp, (r) => Number(r.qty));
    const phys = sumMap(raw.phys, (r) => Number(r.opening_qty));
    const prod = sumMap(raw.prod, (r) => Number(r.production_qty));
    const waste = sumMap(raw.spoil, wasteOf);
    const pPhys = sumMap(raw.pPhys, (r) => Number(r.opening_qty));
    const pProd = sumMap(raw.pProd, (r) => Number(r.production_qty));
    const pWaste = sumMap(raw.pSpoil, wasteOf);

    const rows = items
      .filter((i) => (i.category || "OTHER") === cat)
      .map((i) => {
        const opening = (pPhys.get(i.id) || 0) + (pProd.get(i.id) || 0) - (pWaste.get(i.id) || 0);
        const d = dispatch.get(i.id) || 0;
        const p = phys.get(i.id) || 0;
        const pr = prod.get(i.id) || 0;
        const w = waste.get(i.id) || 0;
        const post = opening - d;
        return {
          id: i.id,
          name: prettyName(i.item_name),
          opening, dispatch: d, post, phys: p, prod: pr, waste: w,
          closing: p + pr - w,
          variance: p - post,
        };
      });

    const total = Object.fromEntries(COLS.map((c) => [c.key, rows.reduce((s, r) => s + r[c.key], 0)]));
    return { rows, total };
  }, [items, raw, cat]);

  const isToday = date === todayStr();
  const noPhysical = !loading && raw.phys.length === 0;

  /* ---------- render ---------- */

  const pointer = "cursor-pointer disabled:cursor-not-allowed";

  const cellText = (key, v) =>
    key === "variance" && Math.abs(v) > 0.0001 ? (v < 0 ? "text-rose-600 font-semibold" : "text-amber-700 font-semibold") : "";

  return (
    <div className="mx-auto max-w-7xl pb-16">
      {/* header */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Daily Stock Report</h1>
          <p className="text-sm text-slate-500">{fmtDate(date)}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-stretch overflow-hidden rounded-lg border border-slate-200 bg-white text-sm">
            <button
              aria-label="Previous day"
              onClick={() => setDate(shiftDate(date, -1))}
              className={`px-3 text-lg text-slate-600 hover:bg-slate-50 ${pointer}`}
            >
              ‹
            </button>
            <input
              type="date"
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              aria-label="Report date"
              className={`border-x border-slate-200 px-3 py-2 outline-none ${pointer}`}
            />
            <button
              aria-label="Next day"
              onClick={() => setDate(shiftDate(date, 1))}
              className={`px-3 text-lg text-slate-600 hover:bg-slate-50 ${pointer}`}
            >
              ›
            </button>
          </div>
          {!isToday && (
            <button
              onClick={() => setDate(todayStr())}
              className={`rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 ${pointer}`}
            >
              Today
            </button>
          )}
        </div>
      </div>

      {/* category pills */}
      {cats.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {cats.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${pointer} ${
                cat === c ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-500"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {msg && (
        <div role="alert" className="mb-4 flex items-center justify-between rounded-lg bg-rose-50 px-4 py-2.5 text-sm text-rose-700">
          <span>{msg.text}</span>
          <button onClick={() => setMsg(null)} className={`ml-4 text-xs underline ${pointer}`}>
            Dismiss
          </button>
        </div>
      )}

      {noPhysical && (
        <div className="mb-4 rounded-lg bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
          No physical opening entered for this date, so closing and variance are incomplete.
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-500">
          Loading report…
        </div>
      ) : table.rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-500">
          No items in this category.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th colSpan={COLS.length + 1} className="px-4 py-3 text-left text-base font-bold">
                  {fmtDate(date)} · {cat}
                </th>
              </tr>
              <tr>
                <th className="bg-slate-50 px-4 py-3 text-left font-semibold text-slate-700">Product</th>
                {COLS.map((c) => (
                  <th key={c.key} className={`px-3 py-3 text-center font-semibold ${c.head}`}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {table.rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap bg-blue-50/60 px-4 py-2 font-medium">{r.name}</td>
                  {COLS.map((c) => (
                    <td key={c.key} className={`px-3 py-2 text-center tabular-nums ${c.cell} ${cellText(c.key, r[c.key])}`}>
                      {fmt(r[c.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-300 font-bold">
                <td className="bg-blue-50 px-4 py-3 text-center">TOTAL</td>
                {COLS.map((c) => (
                  <td key={c.key} className={`px-3 py-3 text-center tabular-nums ${c.cell} ${cellText(c.key, table.total[c.key])}`}>
                    {fmt(table.total[c.key])}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}