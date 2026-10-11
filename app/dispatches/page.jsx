"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseBrowser";

/* ---------- helpers ---------- */

// "#_# Kunafa Chocolate Tart - Taatsu" -> "Kunafa Chocolate Tart", "BELGIAN CHEESE TART" -> "Belgian Cheese Tart"
const prettyName = (s) => {
  let t = (s || "").replace(/^#_#\s*/, "").replace(/\s*-\s*Taatsu$/i, "").replace(/^TTS\s+/i, "").trim();
  if (t && t === t.toUpperCase()) {
    t = t
      .toLowerCase()
      .split(" ")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }
  return t;
};

const todayStr = () => new Date().toLocaleDateString("en-CA"); // yyyy-mm-dd, local

const shiftDate = (str, days) => {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

const fmtDate = (str) => {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
};

// timestamps were stored exactly as in the CSV (+00), so read them back as UTC
const fmtTime = (ts) =>
  new Date(ts).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "UTC",
  });

const fmt = (v) => Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 3 });

// null when blank / not a number / negative
const parseQty = (v) => {
  if (v === "" || v === undefined || v === null) return null;
  const x = Number(v);
  return Number.isFinite(x) && x >= 0 ? x : null;
};

const CAT_ORDER = ["Tart", "Packaging", "Beverages", "Dairy", "Garnishing"];
const catRank = (c) => (CAT_ORDER.includes(c) ? CAT_ORDER.indexOf(c) : CAT_ORDER.length);

const CAT_STYLE = {
  Tart: "bg-emerald-100 text-emerald-700",
  Packaging: "bg-sky-100 text-sky-700",
  Beverages: "bg-violet-100 text-violet-700",
  Dairy: "bg-amber-100 text-amber-700",
  Garnishing: "bg-rose-100 text-rose-700",
};

const SELECT =
  "id,qty,dispatched_at,outlet_id,item_id,purchase_item_id,outlets(name),items(item_name),purchase_items(item_name,uom,category)";

const mapRow = (r) => {
  const isTart = r.item_id != null;
  return {
    id: r.id,
    qty: Number(r.qty),
    at: r.dispatched_at,
    outletId: r.outlet_id,
    outlet: r.outlets?.name || `Outlet #${r.outlet_id}`,
    key: isTart ? `i:${r.item_id}` : `p:${r.purchase_item_id}`,
    name: prettyName(r.items?.item_name || r.purchase_items?.item_name) || "Unknown item",
    isTart,
    category: isTart ? "Tart" : r.purchase_items?.category || "Other",
    uom: isTart ? "" : r.purchase_items?.uom || "",
  };
};

/* ---------- page ---------- */

export default function DispatchesPage() {
  const [date, setDate] = useState(todayStr());
  const [rows, setRows] = useState([]);
  const [options, setOptions] = useState([]); // items that can be added to a dispatch
  const [drafts, setDrafts] = useState({}); // { [rowId]: "typed qty" }
  const [openId, setOpenId] = useState(null); // only one outlet expanded at a time
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [add, setAdd] = useState({ key: "", qty: "" });
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState(null); // { type: "ok" | "err", text }

  /* ----- load ----- */

  useEffect(() => {
    (async () => {
      const [t, p] = await Promise.all([
        supabase.from("items").select("id,item_name").eq("category", "TARTS").eq("is_active", true).order("item_name"),
        supabase.from("purchase_items").select("id,item_name,uom,category").eq("status", "Active").order("item_name"),
      ]);
      const list = [
        ...(t.data || []).map((x) => ({ key: `i:${x.id}`, name: prettyName(x.item_name), category: "Tart", uom: "" })),
        ...(p.data || []).map((x) => ({
          key: `p:${x.id}`,
          name: prettyName(x.item_name),
          category: x.category || "Other",
          uom: x.uom || "",
        })),
      ];
      setOptions(list);
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    setDrafts({});
    setConfirmId(null);
    setOpenId(null);
    const start = `${date}T00:00:00+00:00`;
    const end = `${shiftDate(date, 1)}T00:00:00+00:00`;

    const { data, error } = await supabase
      .from("dispatches")
      .select(SELECT)
      .gte("dispatched_at", start)
      .lt("dispatched_at", end)
      .order("id");

    if (error) {
      setMsg({ type: "err", text: error.message });
      setRows([]);
    } else {
      setRows((data || []).map(mapRow));
    }
    setLoading(false);
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  /* ----- derived ----- */

  const dirty = useMemo(
    () => rows.filter((r) => r.id in drafts && drafts[r.id] !== String(r.qty)),
    [rows, drafts]
  );

  // one entry per outlet that actually has dispatches (outlets with 0 never appear)
  const groups = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      if (!map.has(r.outletId)) map.set(r.outletId, { id: r.outletId, name: r.outlet, rows: [], tarts: 0, supplies: 0, time: r.at });
      const g = map.get(r.outletId);
      g.rows.push(r);
      if (r.isTart) g.tarts += r.qty;
      else g.supplies += r.qty;
      if (r.at < g.time) g.time = r.at;
    }
    return [...map.values()]
      .map((g) => ({
        ...g,
        rows: g.rows.sort((a, b) => catRank(a.category) - catRank(b.category) || a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  // totals across all outlets: per tart flavour, and packaging & others by category
  const summary = useMemo(() => {
    const byItem = new Map();
    for (const r of rows) {
      const cur = byItem.get(r.key) || { key: r.key, name: r.name, category: r.category, uom: r.uom, isTart: r.isTart, qty: 0 };
      cur.qty += r.qty;
      byItem.set(r.key, cur);
    }
    const all = [...byItem.values()];
    const tarts = all.filter((x) => x.isTart).sort((a, b) => b.qty - a.qty);
    const cats = new Map();
    for (const x of all.filter((i) => !i.isTart)) {
      if (!cats.has(x.category)) cats.set(x.category, []);
      cats.get(x.category).push(x);
    }
    const categories = [...cats.entries()]
      .sort(([a], [b]) => catRank(a) - catRank(b) || a.localeCompare(b))
      .map(([category, items]) => {
        const uoms = [...new Set(items.map((i) => i.uom))];
        return {
          category,
          items: items.sort((a, b) => a.name.localeCompare(b.name)),
          total: items.reduce((s, i) => s + i.qty, 0),
          uom: uoms.length === 1 ? uoms[0] : "", // only show a category total unit when every item shares it
        };
      });
    return {
      tarts,
      categories,
      tartTotal: tarts.reduce((s, i) => s + i.qty, 0),
      supplyTotal: categories.reduce((s, c) => s + c.total, 0),
    };
  }, [rows]);

  const isToday = date === todayStr();
  const isYesterday = date === shiftDate(todayStr(), -1);
  const maxTart = Math.max(1, ...summary.tarts.map((t) => t.qty));

  /* ----- actions ----- */

  const toggle = (id) => {
    setOpenId((cur) => (cur === id ? null : id));
    setConfirmId(null);
    setAdd({ key: "", qty: "" });
  };

  const saveAll = async () => {
    const bad = dirty.filter((r) => parseQty(drafts[r.id]) === null);
    if (bad.length) {
      return setMsg({ type: "err", text: `Enter a quantity of 0 or more for ${bad[0].name} at ${bad[0].outlet}.` });
    }
    setSaving(true);
    setMsg(null);
    const results = await Promise.all(
      dirty.map(async (r) => {
        const qty = parseQty(drafts[r.id]);
        const { error } = await supabase.from("dispatches").update({ qty }).eq("id", r.id);
        return { id: r.id, qty, error };
      })
    );
    const ok = results.filter((x) => !x.error);
    const failed = results.filter((x) => x.error);
    if (ok.length) {
      const okMap = new Map(ok.map((x) => [x.id, x.qty]));
      setRows((rs) => rs.map((r) => (okMap.has(r.id) ? { ...r, qty: okMap.get(r.id) } : r)));
      setDrafts((d) => {
        const next = { ...d };
        ok.forEach((x) => delete next[x.id]);
        return next;
      });
    }
    setMsg(
      failed.length
        ? { type: "err", text: `${failed.length} change(s) failed: ${failed[0].error.message}` }
        : { type: "ok", text: `Saved ${ok.length} change(s)` }
    );
    setSaving(false);
  };

  const deleteRow = async (r) => {
    setDeletingId(r.id);
    setMsg(null);
    const { error } = await supabase.from("dispatches").delete().eq("id", r.id);
    setDeletingId(null);
    setConfirmId(null);
    if (error) return setMsg({ type: "err", text: error.message });
    const remaining = rows.filter((x) => x.id !== r.id);
    setRows(remaining);
    setDrafts((d) => {
      const next = { ...d };
      delete next[r.id];
      return next;
    });
    if (!remaining.some((x) => x.outletId === r.outletId)) setOpenId(null); // outlet had its last item removed
    setMsg({ type: "ok", text: `Deleted ${r.name} from ${r.outlet}` });
  };

  const addItem = async (g) => {
    const opt = options.find((o) => o.key === add.key);
    const qty = parseQty(add.qty);
    if (!opt) return setMsg({ type: "err", text: "Choose an item to add." });
    if (qty === null || qty <= 0) return setMsg({ type: "err", text: "Enter a quantity greater than 0." });
    setAdding(true);
    setMsg(null);
    const isTart = opt.key.startsWith("i:");
    const id = Number(opt.key.slice(2));
    const { data, error } = await supabase
      .from("dispatches")
      .insert({
        outlet_id: g.id,
        item_id: isTart ? id : null,
        purchase_item_id: isTart ? null : id,
        qty,
        dispatched_at: g.time, // keep it on the same dispatch as this outlet's other items
      })
      .select(SELECT)
      .single();
    setAdding(false);
    if (error) return setMsg({ type: "err", text: error.message });
    setRows((rs) => [...rs, mapRow(data)]);
    setAdd({ key: "", qty: "" });
    setMsg({ type: "ok", text: `Added ${opt.name} to ${g.name}` });
  };

  /* ---------- render ---------- */

  return (
    <div className="mx-auto max-w-7xl pb-28">
      {/* header */}
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Dispatches</h1>
          <p className="text-sm text-slate-500">{fmtDate(date)}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-slate-200 bg-white text-sm">
            <button
              onClick={() => setDate(shiftDate(todayStr(), -1))}
              className={`px-4 py-2 font-medium ${isYesterday ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"}`}
            >
              Yesterday
            </button>
            <button
              onClick={() => setDate(todayStr())}
              className={`border-l border-slate-200 px-4 py-2 font-medium ${isToday ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"}`}
            >
              Today
            </button>
          </div>

          <div className="flex items-stretch overflow-hidden rounded-lg border border-slate-200 bg-white text-sm">
            <button
              aria-label="Previous day"
              onClick={() => setDate(shiftDate(date, -1))}
              className="px-3 text-lg text-slate-600 hover:bg-slate-50"
            >
              ‹
            </button>
            <input
              type="date"
              value={date}
              max={todayStr()}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              aria-label="Dispatch date"
              className="border-x border-slate-200 px-3 py-2 outline-none"
            />
            <button
              aria-label="Next day"
              onClick={() => setDate(shiftDate(date, 1))}
              disabled={date >= todayStr()}
              className="px-3 text-lg text-slate-600 hover:bg-slate-50 disabled:opacity-30"
            >
              ›
            </button>
          </div>
        </div>
      </div>

      {/* top totals */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Tarts dispatched", fmt(summary.tartTotal), "pieces across all outlets"],
          ["Packaging & others", fmt(summary.supplyTotal), "units across all outlets"],
          ["Outlets served", fmt(groups.length), "received a dispatch"],
          ["Line items", fmt(rows.length), "rows dispatched"],
        ].map(([label, value, hint]) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="text-sm text-slate-500">{label}</div>
            <div className="mt-1 text-3xl font-bold tabular-nums">{loading ? "—" : value}</div>
            <div className="mt-1 text-xs text-slate-400">{hint}</div>
          </div>
        ))}
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
          <button onClick={() => setMsg(null)} className="ml-4 text-xs underline">
            Dismiss
          </button>
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-500">
          Loading dispatches…
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-500">
          Nothing was dispatched on {fmtDate(date)}. Pick another date to see its dispatches.
        </div>
      ) : (
        <>
          {/* totals across outlets */}
          <h2 className="mb-3 font-semibold">Total across all outlets</h2>
          <div className="mb-10 grid gap-4 lg:grid-cols-2">
            {/* tarts */}
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b px-5 py-4">
                <div>
                  <h3 className="font-semibold">Tarts</h3>
                  <p className="text-xs text-slate-500">
                    {summary.tarts.length} {summary.tarts.length === 1 ? "flavour" : "flavours"}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-xl font-bold tabular-nums">{fmt(summary.tartTotal)}</div>
                  <div className="text-xs text-slate-500">total tarts</div>
                </div>
              </div>
              {summary.tarts.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-slate-400">No tarts dispatched.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {summary.tarts.map((t) => (
                    <li key={t.key} className="px-5 py-2.5">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">{t.name}</span>
                        <span className="tabular-nums">{fmt(t.qty)}</span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full bg-emerald-500" style={{ width: `${(t.qty / maxTart) * 100}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* packaging & others */}
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b px-5 py-4">
                <div>
                  <h3 className="font-semibold">Packaging &amp; others</h3>
                  <p className="text-xs text-slate-500">
                    {summary.categories.length} {summary.categories.length === 1 ? "category" : "categories"}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-xl font-bold tabular-nums">{fmt(summary.supplyTotal)}</div>
                  <div className="text-xs text-slate-500">total units</div>
                </div>
              </div>
              {summary.categories.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-slate-400">No packaging or other items dispatched.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {summary.categories.map((c) => (
                    <div key={c.category} className="px-5 py-3">
                      <div className="mb-1.5 flex items-center justify-between">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                            CAT_STYLE[c.category] || "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {c.category}
                        </span>
                        {c.uom && (
                          <span className="text-xs text-slate-500 tabular-nums">
                            {fmt(c.total)} {c.uom}
                          </span>
                        )}
                      </div>
                      <ul>
                        {c.items.map((i) => (
                          <li key={i.key} className="flex items-center justify-between py-1 text-sm">
                            <span>{i.name}</span>
                            <span className="tabular-nums">
                              {fmt(i.qty)}
                              {i.uom && <span className="ml-1 text-xs text-slate-400">{i.uom}</span>}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* per-outlet accordion */}
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-semibold">Outlet dispatches</h2>
            <p className="text-xs text-slate-500">Select an outlet to view and edit its items</p>
          </div>

          <div className="space-y-3">
            {groups.map((g) => {
              const open = openId === g.id;
              const taken = new Set(g.rows.map((r) => r.key));
              const available = options.filter((o) => !taken.has(o.key));
              const optGroups = [...new Set(available.map((o) => o.category))].sort(
                (a, b) => catRank(a) - catRank(b) || a.localeCompare(b)
              );
              return (
                <div
                  key={g.id}
                  className={`overflow-hidden rounded-xl border bg-white ${
                    open ? "border-slate-900 ring-1 ring-slate-900" : "border-slate-200"
                  }`}
                >
                  <button
                    onClick={() => toggle(g.id)}
                    aria-expanded={open}
                    className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left hover:bg-slate-50"
                  >
                    <div className="flex items-center gap-3">
                      <span className={`text-lg text-slate-400 transition-transform ${open ? "rotate-90" : ""}`}>›</span>
                      <div>
                        <div className="font-semibold">{g.name}</div>
                        <div className="text-xs text-slate-500">Dispatched {fmtTime(g.time)}</div>
                      </div>
                    </div>
                    <div className="flex gap-8 text-right">
                      <div>
                        <div className="font-semibold tabular-nums">{fmt(g.tarts)}</div>
                        <div className="text-xs text-slate-500">tarts</div>
                      </div>
                      <div>
                        <div className="font-semibold tabular-nums">{fmt(g.supplies)}</div>
                        <div className="text-xs text-slate-500">packaging &amp; others</div>
                      </div>
                    </div>
                  </button>

                  {open && (
                    <div className="border-t">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                          <thead className="bg-slate-100 text-slate-600">
                            <tr>
                              <th className="px-5 py-3">Item</th>
                              <th className="px-3 py-3">Category</th>
                              <th className="px-3 py-3 text-right">Quantity</th>
                              <th className="px-5 py-3 text-right">
                                <span className="sr-only">Actions</span>
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {g.rows.map((r) => {
                              const isDirty = r.id in drafts && drafts[r.id] !== String(r.qty);
                              const invalid = r.id in drafts && parseQty(drafts[r.id]) === null;
                              return (
                                <tr key={r.id} className={isDirty ? "bg-amber-50/60" : ""}>
                                  <td className="px-5 py-3 font-medium">
                                    {r.name}
                                    {r.uom && <span className="ml-1 text-xs font-normal text-slate-400">({r.uom})</span>}
                                  </td>
                                  <td className="px-3 py-3">
                                    <span
                                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                                        CAT_STYLE[r.category] || "bg-slate-100 text-slate-600"
                                      }`}
                                    >
                                      {r.category}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 text-right">
                                    <div className="flex items-center justify-end gap-2">
                                      {isDirty && (
                                        <span className="text-xs tabular-nums text-slate-400">was {fmt(r.qty)}</span>
                                      )}
                                      <input
                                        type="number"
                                        min="0"
                                        step="any"
                                        inputMode="decimal"
                                        value={r.id in drafts ? drafts[r.id] : String(r.qty)}
                                        onChange={(e) => setDrafts((p) => ({ ...p, [r.id]: e.target.value }))}
                                        onKeyDown={(e) => {
                                          if (e.key === "Escape")
                                            setDrafts((p) => {
                                              const next = { ...p };
                                              delete next[r.id];
                                              return next;
                                            });
                                        }}
                                        aria-label={`Quantity of ${r.name} for ${r.outlet}`}
                                        className={`w-24 rounded-lg border px-2 py-1.5 text-right tabular-nums ${
                                          invalid ? "border-rose-400" : "border-slate-200"
                                        }`}
                                      />
                                    </div>
                                  </td>
                                  <td className="whitespace-nowrap px-5 py-3 text-right">
                                    {confirmId === r.id ? (
                                      <span className="inline-flex items-center gap-2">
                                        <button
                                          onClick={() => deleteRow(r)}
                                          disabled={deletingId === r.id}
                                          className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                                        >
                                          {deletingId === r.id ? "Deleting…" : "Confirm delete"}
                                        </button>
                                        <button
                                          onClick={() => setConfirmId(null)}
                                          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600"
                                        >
                                          Cancel
                                        </button>
                                      </span>
                                    ) : (
                                      <button
                                        onClick={() => setConfirmId(r.id)}
                                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-rose-600 hover:border-rose-300 hover:bg-rose-50"
                                      >
                                        Delete
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {/* add item to this outlet's dispatch */}
                      <div className="flex flex-wrap items-center gap-2 border-t bg-slate-50 px-5 py-4">
                        <span className="mr-1 text-sm font-medium text-slate-700">Add item</span>
                        <select
                          value={add.key}
                          onChange={(e) => setAdd((p) => ({ ...p, key: e.target.value }))}
                          aria-label="Item to add"
                          className="min-w-52 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                        >
                          <option value="">Choose an item…</option>
                          {optGroups.map((cat) => (
                            <optgroup key={cat} label={cat === "Tart" ? "Tarts" : cat}>
                              {available
                                .filter((o) => o.category === cat)
                                .map((o) => (
                                  <option key={o.key} value={o.key}>
                                    {o.name}
                                    {o.uom ? ` (${o.uom})` : ""}
                                  </option>
                                ))}
                            </optgroup>
                          ))}
                        </select>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          inputMode="decimal"
                          placeholder="Qty"
                          value={add.qty}
                          onChange={(e) => setAdd((p) => ({ ...p, qty: e.target.value }))}
                          aria-label="Quantity to add"
                          className="w-24 rounded-lg border border-slate-200 bg-white px-2 py-2 text-right text-sm"
                        />
                        <button
                          onClick={() => addItem(g)}
                          disabled={adding}
                          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                        >
                          {adding ? "Adding…" : "Add to dispatch"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* unsaved changes bar */}
      {dirty.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
            <p className="text-sm text-slate-600">
              <span className="font-semibold text-slate-900">{dirty.length}</span> unsaved quantity{" "}
              {dirty.length === 1 ? "change" : "changes"}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setDrafts({})}
                disabled={saving}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 disabled:opacity-40"
              >
                Discard
              </button>
              <button
                onClick={saveAll}
                disabled={saving}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                {saving ? "Saving…" : `Save ${dirty.length} ${dirty.length === 1 ? "change" : "changes"}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
