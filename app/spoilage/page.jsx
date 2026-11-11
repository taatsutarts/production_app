"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseBrowser";

/* ---------- helpers ---------- */

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

const fmt = (v) => Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 3 });

const parseQty = (v) => {
  if (v === "" || v == null) return 0;
  const x = Number(v);
  return Number.isFinite(x) && x >= 0 ? x : null;
};

// "2000gms" -> 2000 | "gms" or empty -> 1
const packSize = (batch_size) => {
  const n = parseFloat(String(batch_size || "").replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 1;
};
// "2000gms" -> "gms"
const unitLabel = (batch_size) => String(batch_size || "").replace(/^[\d.,\s]+/, "").trim();

const DEFAULT_OUTLET = 6;

const ORDER = ["TARTS", "MINIS", "TART SHELLS", "DOUGH", "BLENDS & COMPOTE"];
const catRank = (c) => (ORDER.includes(c) ? ORDER.indexOf(c) : ORDER.length);

// relationships are named explicitly so duplicate/stale FKs can't cause embed errors
const SELECT =
  "id,spoilage_date,full_qty,open_qty,reason,outlet_id,item_id,outlets!spoilages_outlet_id_fkey(name),items!spoilages_item_id_fkey(item_name,category,batch_size)";

const mapRow = (r) => {
  const batch_size = r.items?.batch_size || "";
  const full = Number(r.full_qty);
  const open = Number(r.open_qty);
  return {
    id: r.id,
    date: r.spoilage_date,
    name: prettyName(r.items?.item_name) || "Unknown item",
    category: r.items?.category || "OTHER",
    batch_size,
    outletId: r.outlet_id,
    reason: r.reason,
    full,
    open,
    total: full * packSize(batch_size) + open,
  };
};

const RANGES = [
  { days: 7, label: "Last 7 days" },
  { days: 30, label: "Last 30 days" },
  { days: 90, label: "Last 90 days" },
];

/* ---------- page ---------- */

export default function SpoilagePage() {
  const [outletId, setOutletId] = useState(String(DEFAULT_OUTLET));
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState([]);
  const [items, setItems] = useState([]);
  const [outlets, setOutlets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ date: todayStr(), itemId: "", full: "", open: "", reason: "" });
  const [adding, setAdding] = useState(false);
  const [confirmId, setConfirmId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [msg, setMsg] = useState(null);

  /* ----- load ----- */

  useEffect(() => {
    (async () => {
      const [i, o] = await Promise.all([
        supabase.from("items").select("id,item_name,category,batch_size").eq("is_active", true).order("item_name"),
        supabase.from("outlets").select("id,name").order("name"),
      ]);
      if (i.error) setMsg({ type: "err", text: i.error.message });
      setOutlets(o.data || []);
      setItems(
        (i.data || []).map((x) => ({
          id: String(x.id),
          name: prettyName(x.item_name),
          category: x.category || "OTHER",
          batch_size: x.batch_size || "",
        }))
      );
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    setConfirmId(null);
    const { data, error } = await supabase
      .from("spoilages")
      .select(SELECT)
      .eq("outlet_id", Number(outletId))
      .gte("spoilage_date", shiftDate(todayStr(), -days))
      .order("spoilage_date", { ascending: false })
      .order("id", { ascending: false });
    if (error) {
      setMsg({ type: "err", text: error.message });
      setRows([]);
    } else {
      setRows((data || []).map(mapRow));
    }
    setLoading(false);
  }, [outletId, days]);

  useEffect(() => {
    load();
  }, [load]);

  /* ----- derived ----- */

  // one block per date, newest first
  const dateGroups = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      if (!map.has(r.date)) map.set(r.date, []);
      map.get(r.date).push(r);
    }
    return [...map.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, list]) => ({
        date,
        rows: list.sort((a, b) => catRank(a.category) - catRank(b.category) || a.name.localeCompare(b.name)),
      }));
  }, [rows]);

  const itemCats = useMemo(
    () => [...new Set(items.map((x) => x.category))].sort((a, b) => catRank(a) - catRank(b) || a.localeCompare(b)),
    [items]
  );

  const selected = items.find((x) => x.id === form.itemId);
  const outletName = outlets.find((o) => String(o.id) === outletId)?.name || `Outlet #${outletId}`;

  /* ----- actions ----- */

  const addSpoilage = async () => {
    const full = parseQty(form.full);
    const open = parseQty(form.open);
    if (!form.date) return setMsg({ type: "err", text: "Choose a date." });
    if (!selected) return setMsg({ type: "err", text: "Choose an item." });
    if (full === null || open === null) return setMsg({ type: "err", text: "Quantities must be 0 or more." });
    if (full === 0 && open === 0) return setMsg({ type: "err", text: "Enter a full or open quantity." });

    setAdding(true);
    setMsg(null);
    const { data, error } = await supabase
      .from("spoilages")
      .insert({
        spoilage_date: form.date,
        outlet_id: Number(outletId),
        item_id: Number(form.itemId),
        full_qty: full,
        open_qty: open,
        reason: form.reason.trim() || null,
      })
      .select(SELECT)
      .single();
    setAdding(false);
    if (error) return setMsg({ type: "err", text: error.message });
    if (form.date >= shiftDate(todayStr(), -days)) setRows((rs) => [...rs, mapRow(data)]);
    setForm((p) => ({ ...p, itemId: "", full: "", open: "", reason: "" }));
    setMsg({ type: "ok", text: `Added ${selected.name} to ${outletName}` });
  };

  const deleteRow = async (r) => {
    setDeletingId(r.id);
    const { error } = await supabase.from("spoilages").delete().eq("id", r.id);
    setDeletingId(null);
    setConfirmId(null);
    if (error) return setMsg({ type: "err", text: error.message });
    setRows((rs) => rs.filter((x) => x.id !== r.id));
    setMsg({ type: "ok", text: `Deleted ${r.name}` });
  };

  /* ---------- render ---------- */

  const input = "rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm";
  const pointer = "cursor-pointer disabled:cursor-not-allowed";

  return (
    <div className="mx-auto max-w-4xl pb-16">
      {/* header */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Spoilage</h1>
          <p className="text-sm text-slate-500">{outletName}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={outletId}
            onChange={(e) => setOutletId(e.target.value)}
            aria-label="Outlet"
            className={`${input} font-medium ${pointer}`}
          >
            {outlets.length === 0 && <option value={outletId}>Outlet #{outletId}</option>}
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>

          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            aria-label="Date range"
            className={`${input} ${pointer}`}
          >
            {RANGES.map((r) => (
              <option key={r.days} value={r.days}>
                {r.label}
              </option>
            ))}
          </select>

          <button
            onClick={() => setShowAdd((s) => !s)}
            className={`rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white ${pointer}`}
          >
            {showAdd ? "Close" : "+ Add spoilage"}
          </button>
        </div>
      </div>

      {/* messages */}
      {msg && (
        <div
          role={msg.type === "err" ? "alert" : "status"}
          className={`mb-4 flex items-center justify-between rounded-lg px-4 py-2.5 text-sm ${
            msg.type === "err" ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"
          }`}
        >
          <span>{msg.text}</span>
          <button onClick={() => setMsg(null)} className={`ml-4 text-xs underline ${pointer}`}>
            Dismiss
          </button>
        </div>
      )}

      {/* add form */}
      {showAdd && (
        <div className="mb-6 rounded-xl border border-slate-900 bg-white p-5 ring-1 ring-slate-900">
          <h2 className="mb-3 font-semibold">Add spoilage for {outletName}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              type="date"
              value={form.date}
              max={todayStr()}
              onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))}
              aria-label="Spoilage date"
              className={`${input} sm:col-span-2 ${pointer}`}
            />

            <select
              value={form.itemId}
              onChange={(e) => setForm((p) => ({ ...p, itemId: e.target.value }))}
              aria-label="Item"
              className={`${input} sm:col-span-2 ${pointer}`}
            >
              <option value="">{items.length ? "Choose an item…" : "Loading items…"}</option>
              {itemCats.map((cat) => (
                <optgroup key={cat} label={cat}>
                  {items
                    .filter((x) => x.category === cat)
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                        {x.batch_size ? ` (${x.batch_size})` : ""}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>

            <input
              type="number" min="0" step="any" inputMode="decimal"
              placeholder="Batch Size (full qty)"
              value={form.full}
              onChange={(e) => setForm((p) => ({ ...p, full: e.target.value }))}
              className={input}
            />
            <input
              type="number" min="0" step="any" inputMode="decimal"
              placeholder={selected && unitLabel(selected.batch_size) ? `Open qty (${unitLabel(selected.batch_size)})` : "Open qty"}
              value={form.open}
              onChange={(e) => setForm((p) => ({ ...p, open: e.target.value }))}
              className={input}
            />
            <input
              placeholder="Reason (optional)"
              value={form.reason}
              onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))}
              className={`${input} sm:col-span-2`}
            />
            <button
              onClick={addSpoilage}
              disabled={adding}
              className={`rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 sm:col-span-2 ${pointer}`}
            >
              {adding ? "Saving…" : "Save spoilage"}
            </button>
          </div>
        </div>
      )}

      {/* list, grouped by date */}
      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-500">
          Loading spoilage…
        </div>
      ) : dateGroups.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-500">
          No spoilage recorded for {outletName} in this period.
        </div>
      ) : (
        <div className="space-y-4">
          {dateGroups.map((g) => (
            <div key={g.date} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b bg-slate-50 px-5 py-3 text-sm">
                <span className="font-semibold">{fmtDate(g.date)}</span>
                <span className="text-xs text-slate-500">
                  {g.rows.length} {g.rows.length === 1 ? "entry" : "entries"}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-100 text-slate-600">
                    <tr>
                      <th className="px-5 py-3">Item</th>
                      <th className="px-3 py-3">Reason</th>
                      <th className="px-3 py-3 text-right">Full</th>
                      <th className="px-3 py-3 text-right">Open</th>
                      <th className="px-3 py-3 text-right">Total</th>
                      <th className="px-5 py-3 text-right">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {g.rows.map((r) => (
                      <tr key={r.id}>
                        <td className="px-5 py-3 font-medium">
                          {r.name}
                          {r.batch_size && <span className="ml-1 text-xs font-normal text-slate-400">({r.batch_size})</span>}
                          <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                            {r.category}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-slate-500">{r.reason || "—"}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{fmt(r.full)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{fmt(r.open)}</td>
                        <td className="px-3 py-3 text-right font-semibold tabular-nums">
                          {fmt(r.total)}
                          {unitLabel(r.batch_size) && (
                            <span className="ml-1 text-xs font-normal text-slate-400">{unitLabel(r.batch_size)}</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 text-right">
                          {confirmId === r.id ? (
                            <span className="inline-flex items-center gap-2">
                              <button
                                onClick={() => deleteRow(r)}
                                disabled={deletingId === r.id}
                                className={`rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 ${pointer}`}
                              >
                                {deletingId === r.id ? "Deleting…" : "Confirm"}
                              </button>
                              <button
                                onClick={() => setConfirmId(null)}
                                className={`rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 ${pointer}`}
                              >
                                Cancel
                              </button>
                            </span>
                          ) : (
                            <button
                              onClick={() => setConfirmId(r.id)}
                              className={`rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-rose-600 hover:border-rose-300 hover:bg-rose-50 ${pointer}`}
                            >
                              Delete
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}