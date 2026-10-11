"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseBrowser";

/* ---------- helpers ---------- */
const iso = (d) => d.toISOString().slice(0, 10);
const today = () => new Date().toLocaleDateString("en-CA");
const addDays = (s, n) => {
  const [y, m, d] = s.split("-").map(Number);
  return iso(new Date(Date.UTC(y, m - 1, d + n)));
};
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const fmt = (v) => Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 1 });
const short = (s) =>
  new Date(s + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

// last n calendar months, oldest first, e.g. ["2026-08","2026-09","2026-10"]
const monthKeys = (n) => {
  const [y, m] = today().split("-").map(Number);
  return Array.from({ length: n }, (_, i) => iso(new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1))).slice(0, 7));
};
const monthName = (k) =>
  new Date(k + "-01T00:00:00Z").toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" });

const pretty = (s) => {
  let t = (s || "").replace(/^#_#\s*/, "").replace(/\s*-\s*Taatsu$/i, "").replace(/^TTS\s+/i, "").trim();
  if (t && t === t.toUpperCase())
    t = t.toLowerCase().split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  return t;
};

const CAT_STYLE = {
  Tart: "bg-emerald-100 text-emerald-700",
  Packaging: "bg-sky-100 text-sky-700",
  Beverages: "bg-violet-100 text-violet-700",
  Dairy: "bg-amber-100 text-amber-700",
  Garnishing: "bg-rose-100 text-rose-700",
};

const SELECT =
  "id,qty,dispatched_at,outlet_id,item_id,purchase_item_id,outlets(name),items(item_name),purchase_items(item_name,uom,category)";

// Supabase returns max 1000 rows per request, so page through
async function fetchAll(from, to) {
  const out = [];
  for (let p = 0; ; p++) {
    const { data, error } = await supabase
      .from("dispatches")
      .select(SELECT)
      .gte("dispatched_at", `${from}T00:00:00+00:00`)
      .lt("dispatched_at", `${addDays(to, 1)}T00:00:00+00:00`)
      .order("id")
      .range(p * 1000, p * 1000 + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

const mapRow = (r) => {
  const isTart = r.item_id != null;
  return {
    id: r.id,
    date: r.dispatched_at.slice(0, 10), // stored as-is (+00), so the UTC date is the dispatch date
    qty: Number(r.qty),
    outlet: r.outlets?.name || `Outlet #${r.outlet_id}`,
    key: isTart ? `i:${r.item_id}` : `p:${r.purchase_item_id}`,
    name: pretty(r.items?.item_name || r.purchase_items?.item_name) || "Unknown item",
    category: isTart ? "Tart" : r.purchase_items?.category || "Other",
    uom: isTart ? "pcs" : r.purchase_items?.uom || "",
  };
};

const sum = (rs) => rs.reduce((s, r) => s + r.qty, 0);
const pct = (cur, prev) => (prev > 0 ? ((cur - prev) / prev) * 100 : null);

/* ---------- small components ---------- */
function Delta({ cur, prev }) {
  const p = pct(cur, prev);
  if (p === null) return <span className="text-xs text-slate-400">{cur > 0 ? "new" : "–"}</span>;
  const up = p >= 0;
  return (
    <span className={`text-xs font-medium ${up ? "text-emerald-600" : "text-rose-600"}`}>
      {up ? "▲" : "▼"} {Math.abs(p).toFixed(0)}%
    </span>
  );
}

const Card = ({ title, sub, right, children }) => (
  <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
    <div className="flex items-center justify-between border-b px-5 py-4">
      <div>
        <h3 className="font-semibold">{title}</h3>
        {sub && <p className="text-xs text-slate-500">{sub}</p>}
      </div>
      {right}
    </div>
    {children}
  </div>
);

const Th = ({ children, right }) => <th className={`px-4 py-3 ${right ? "text-right" : ""}`}>{children}</th>;
const Td = ({ children, right, bold }) => (
  <td className={`px-4 py-3 ${right ? "text-right tabular-nums" : ""} ${bold ? "font-medium" : ""}`}>{children}</td>
);
const cell = (v) => (v ? fmt(v) : <span className="text-slate-300">–</span>);

/* ---------- page ---------- */
export default function TrackerPage() {
  const [to, setTo] = useState(today());
  const [from, setFrom] = useState(addDays(today(), -29));
  const [mode, setMode] = useState("item");
  const [rows, setRows] = useState([]); // date-range data for the item tracker
  const [monthRows, setMonthRows] = useState([]); // last 3 calendar months for category trends
  const [outlets, setOutlets] = useState([]);
  const [itemKey, setItemKey] = useState("");
  const [cat, setCat] = useState("");
  const [loadingRange, setLoadingRange] = useState(true);
  const [loadingMonths, setLoadingMonths] = useState(true);
  const [err, setErr] = useState("");

  const months = useMemo(() => monthKeys(3), []);
  const mName = months.map(monthName);
  const dom = Number(today().slice(8, 10)); // days elapsed in the current month

  const len = daysBetween(from, to) + 1;
  const prevFrom = addDays(from, -len);
  const prevTo = addDays(from, -1);

  useEffect(() => {
    supabase
      .from("outlets")
      .select("id,name,outlet_type")
      .neq("outlet_type", "office")
      .order("name")
      .then(({ data }) => setOutlets(data || []));
  }, []);

  // last 3 calendar months (independent of the date range)
  useEffect(() => {
    (async () => {
      try {
        const data = await fetchAll(`${months[0]}-01`, today());
        setMonthRows(data.map(mapRow));
      } catch (e) {
        setErr(e.message);
      }
      setLoadingMonths(false);
    })();
  }, [months]);

  // selected date range + the equal-length period before it
  useEffect(() => {
    if (from > to) return;
    let off = false;
    (async () => {
      setLoadingRange(true);
      try {
        const data = await fetchAll(prevFrom, to);
        if (!off) setRows(data.map(mapRow));
      } catch (e) {
        if (!off) (setErr(e.message), setRows([]));
      }
      if (!off) setLoadingRange(false);
    })();
    return () => {
      off = true;
    };
  }, [from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  const cur = useMemo(() => rows.filter((r) => r.date >= from && r.date <= to), [rows, from, to]);
  const prev = useMemo(() => rows.filter((r) => r.date >= prevFrom && r.date <= prevTo), [rows, prevFrom, prevTo]);

  const itemOptions = useMemo(() => {
    const m = new Map();
    rows.forEach((r) => m.set(r.key, { key: r.key, name: r.name, category: r.category, uom: r.uom }));
    return [...m.values()].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  }, [rows]);

  /* ----- monthly data per item, all outlets together (packaging & others) ----- */
  const monthItems = useMemo(() => {
    const m = new Map();
    monthRows.forEach((r) => {
      const i = months.indexOf(r.date.slice(0, 7));
      if (i < 0 || r.category === "Tart") return;
      const o = m.get(r.key) || {
        key: r.key, name: r.name, category: r.category, uom: r.uom, q: [0, 0, 0], prevSame: 0,
      };
      o.q[i] += r.qty;
      // previous month, same days elapsed => fair comparison with the current (partial) month
      if (i === 1 && Number(r.date.slice(8, 10)) <= dom) o.prevSame += r.qty;
      m.set(r.key, o);
    });
    return [...m.values()];
  }, [monthRows, months, dom]);

  const categories = useMemo(() => [...new Set(monthItems.map((i) => i.category))].sort(), [monthItems]);

  useEffect(() => {
    if (itemOptions.length && !itemOptions.some((o) => o.key === itemKey)) {
      setItemKey((itemOptions.find((o) => /icing/i.test(o.name)) || itemOptions[0]).key);
    }
  }, [itemOptions]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (categories.length && !categories.includes(cat)) setCat(categories[0]);
  }, [categories]); // eslint-disable-line react-hooks/exhaustive-deps

  const catCards = useMemo(
    () =>
      categories.map((k) => {
        const its = monthItems.filter((i) => i.category === k);
        return {
          cat: k,
          q: [0, 1, 2].map((n) => its.reduce((s, i) => s + i.q[n], 0)),
          prevSame: its.reduce((s, i) => s + i.prevSame, 0),
        };
      }),
    [categories, monthItems]
  );

  /* ----- selected category: one table per outlet + insights ----- */
  const detail = useMemo(() => {
    // outlet -> item -> [aug, sep, oct]
    const om = new Map();
    monthRows.forEach((r) => {
      if (r.category !== cat) return;
      const i = months.indexOf(r.date.slice(0, 7));
      if (i < 0) return;
      const o = om.get(r.outlet) || { outlet: r.outlet, items: new Map() };
      const it = o.items.get(r.key) || { key: r.key, name: r.name, uom: r.uom, q: [0, 0, 0], prevSame: 0 };
      it.q[i] += r.qty;
      if (i === 1 && Number(r.date.slice(8, 10)) <= dom) it.prevSame += r.qty;
      o.items.set(r.key, it);
      om.set(r.outlet, o);
    });

    const outletCards = [...om.values()]
      .map((o) => {
        const items = [...o.items.values()]
          .map((i) => ({ ...i, total: i.q[0] + i.q[1] + i.q[2] }))
          .sort((a, b) => b.total - a.total);
        const q = [0, 1, 2].map((n) => items.reduce((s, i) => s + i.q[n], 0));
        return {
          outlet: o.outlet,
          items,
          q,
          prevSame: items.reduce((s, i) => s + i.prevSame, 0),
          total: q[0] + q[1] + q[2],
          mixed: new Set(items.map((i) => i.uom)).size > 1,
        };
      })
      .sort((a, b) => b.total - a.total);

    // insights (all outlets together)
    const items = monthItems
      .filter((i) => i.category === cat)
      .map((i) => ({ ...i, total: i.q[0] + i.q[1] + i.q[2] }))
      .sort((a, b) => b.total - a.total);
    const grand = items.reduce((s, i) => s + i.total, 0);
    const g1 = (i) => pct(i.q[1], i.q[0]);
    const g2 = (i) => pct(i.q[2], i.prevSame);
    const withG = (fn, ok) => items.filter(ok).map((i) => ({ ...i, g: fn(i) }));
    const up1 = withG(g1, (i) => i.q[0] > 0 && i.q[1] > 0).sort((a, b) => b.g - a.g)[0];
    const dn1 = withG(g1, (i) => i.q[0] > 0 && i.q[1] > 0).sort((a, b) => a.g - b.g)[0];
    const up2 = withG(g2, (i) => i.prevSame > 0 && i.q[2] > 0).sort((a, b) => b.g - a.g)[0];
    const dn2 = withG(g2, (i) => i.prevSame > 0 && i.q[2] > 0).sort((a, b) => a.g - b.g)[0];
    const stalled = items.filter((i) => i.prevSame > 0 && i.q[2] === 0).map((i) => i.name);

    const insights = [];
    if (items[0] && grand)
      insights.push(`${items[0].name} is ${((items[0].total / grand) * 100).toFixed(0)}% of all ${cat} dispatched since ${mName[0]}.`);
    if (up1 && up1.g > 0) insights.push(`${mName[1]} vs ${mName[0]}: ${up1.name} grew the most (▲ ${up1.g.toFixed(0)}%).`);
    if (dn1 && dn1.g < 0) insights.push(`${mName[1]} vs ${mName[0]}: ${dn1.name} dropped the most (▼ ${Math.abs(dn1.g).toFixed(0)}%).`);
    if (up2 && up2.g > 0) insights.push(`${mName[2]} so far: ${up2.name} is growing fastest (▲ ${up2.g.toFixed(0)}%).`);
    if (dn2 && dn2.g < 0) insights.push(`${mName[2]} so far: ${dn2.name} is down the most (▼ ${Math.abs(dn2.g).toFixed(0)}%).`);
    if (stalled.length)
      insights.push(`Sent in ${mName[1]} 1–${dom} but nothing yet in ${mName[2]}: ${stalled.slice(0, 3).join(", ")}${stalled.length > 3 ? ` +${stalled.length - 3} more` : ""}.`);

    return {
      outletCards,
      insights,
      byOutlet: outletCards.map((o) => ({ outlet: o.outlet, qty: o.total })),
    };
  }, [cat, monthItems, monthRows, months]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ----- item tracker data ----- */
  const item = useMemo(() => {
    const opt = itemOptions.find((o) => o.key === itemKey);
    const c = cur.filter((r) => r.key === itemKey);
    const p = prev.filter((r) => r.key === itemKey);
    const by = new Map();
    c.forEach((r) => {
      const o = by.get(r.outlet) || { outlet: r.outlet, qty: 0, count: 0, last: "" };
      o.qty += r.qty;
      o.count += 1;
      if (r.date > o.last) o.last = r.date;
      by.set(r.outlet, o);
    });
    const byOutlet = [...by.values()].sort((a, b) => b.qty - a.qty);
    const total = sum(c);
    const notSent = outlets.filter((o) => !by.has(o.name)).map((o) => o.name);
    const last = c.reduce((m, r) => (r.date > m ? r.date : m), "");
    const insights = [];
    if (byOutlet[0]) insights.push(`${byOutlet[0].outlet} received ${((byOutlet[0].qty / total) * 100).toFixed(0)}% of all ${opt?.name} sent.`);
    const d = pct(total, sum(p));
    if (d !== null) insights.push(`${d >= 0 ? "Up" : "Down"} ${Math.abs(d).toFixed(0)}% compared with the previous ${len} days.`);
    if (notSent.length) insights.push(`${notSent.length} outlet${notSent.length > 1 ? "s" : ""} received none in this period.`);
    return { opt, c, total, prevTotal: sum(p), byOutlet, notSent, last, insights };
  }, [itemKey, cur, prev, outlets, itemOptions, len]);

  const setPreset = (n) => (setTo(today()), setFrom(addDays(today(), -(n - 1))));
  const activePreset = to === today() ? len : null;
  const daysAgo = (d) => daysBetween(d, today());
  const busy = mode === "item" ? loadingRange : loadingMonths;

  /* ---------- render ---------- */
  return (
    <div className="mx-auto max-w-7xl pb-16">
      {/* header */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Dispatch insights</h1>
          <p className="text-sm text-slate-500">
            {mode === "item"
              ? `${short(from)} – ${short(to)} · compared with ${short(prevFrom)} – ${short(prevTo)}`
              : `${mName[0]} – ${mName[2]} · ${mName[2]} is month-to-date (1–${dom} ${mName[2]})`}
          </p>
        </div>

        {mode === "item" && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex overflow-hidden rounded-lg border border-slate-200 bg-white text-sm">
              {[7, 30, 90].map((n, i) => (
                <button
                  key={n}
                  onClick={() => setPreset(n)}
                  className={`px-4 py-2 font-medium ${i ? "border-l border-slate-200" : ""} ${
                    activePreset === n ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {n}D
                </button>
              ))}
            </div>
            <div className="flex items-center overflow-hidden rounded-lg border border-slate-200 bg-white text-sm">
              <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className="px-3 py-2 outline-none" aria-label="From date" />
              <span className="text-slate-400">→</span>
              <input type="date" value={to} min={from} max={today()} onChange={(e) => e.target.value && setTo(e.target.value)} className="px-3 py-2 outline-none" aria-label="To date" />
            </div>
          </div>
        )}
      </div>

      {/* mode tabs */}
      <div className="mb-6 inline-flex rounded-lg bg-slate-100 p-1 text-sm">
        {[["item", "Item tracker"], ["category", "Category trends"]].map(([k, label]) => (
          <button
            key={k}
            onClick={() => setMode(k)}
            className={`rounded-md px-4 py-2 font-medium ${mode === k ? "bg-white shadow-sm" : "text-slate-500"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {err && <div role="alert" className="mb-4 rounded-lg bg-rose-50 px-4 py-2.5 text-sm text-rose-700">{err}</div>}
      {mode === "item" && from > to && <div className="mb-4 rounded-lg bg-amber-50 px-4 py-2.5 text-sm text-amber-700">The start date must be before the end date.</div>}

      {busy ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-500">Loading dispatches…</div>
      ) : mode === "item" && cur.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-500">
          Nothing was dispatched between {short(from)} and {short(to)}. Try a longer date range.
        </div>
      ) : mode === "item" ? (
        /* ================= ITEM TRACKER ================= */
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor="item" className="text-sm font-medium">Item</label>
            <select
              id="item"
              value={itemKey}
              onChange={(e) => setItemKey(e.target.value)}
              className="min-w-64 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              {[...new Set(itemOptions.map((o) => o.category))].map((c) => (
                <optgroup key={c} label={c === "Tart" ? "Tarts" : c}>
                  {itemOptions.filter((o) => o.category === c).map((o) => (
                    <option key={o.key} value={o.key}>{o.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            {item.opt && (
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${CAT_STYLE[item.opt.category] || "bg-slate-100 text-slate-600"}`}>
                {item.opt.category} · {item.opt.uom || "units"}
              </span>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="text-sm text-slate-500">Total sent</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-3xl font-bold tabular-nums">{fmt(item.total)}</span>
                <Delta cur={item.total} prev={item.prevTotal} />
              </div>
              <div className="mt-1 text-xs text-slate-400">previous period: {fmt(item.prevTotal)}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="text-sm text-slate-500">Dispatches</div>
              <div className="mt-1 text-3xl font-bold tabular-nums">{item.c.length}</div>
              <div className="mt-1 text-xs text-slate-400">avg {fmt(item.c.length ? item.total / item.c.length : 0)} per dispatch</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="text-sm text-slate-500">Outlets reached</div>
              <div className="mt-1 text-3xl font-bold tabular-nums">{item.byOutlet.length} <span className="text-lg text-slate-400">/ {outlets.length}</span></div>
              <div className="mt-1 text-xs text-slate-400">{item.notSent.length} not sent any</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="text-sm text-slate-500">Last sent</div>
              <div className="mt-1 text-3xl font-bold">{item.last ? short(item.last) : "–"}</div>
              <div className="mt-1 text-xs text-slate-400">{item.last ? `${daysAgo(item.last)} days ago` : "not sent in this period"}</div>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Card title="By outlet" sub="Where it went, how much and when it was last sent">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-100 text-slate-600">
                      <tr><Th>Outlet</Th><Th right>Total</Th><Th>Share</Th><Th right>Dispatches</Th><Th right>Avg</Th><Th right>Last sent</Th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {item.byOutlet.map((o) => (
                        <tr key={o.outlet}>
                          <Td bold>{o.outlet}</Td>
                          <Td right>{fmt(o.qty)}</Td>
                          <td className="w-32 px-4 py-3">
                            <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                              <div className="h-full bg-emerald-500" style={{ width: `${(o.qty / item.total) * 100}%` }} />
                            </div>
                          </td>
                          <Td right>{o.count}</Td>
                          <Td right>{fmt(o.qty / o.count)}</Td>
                          <Td right>{short(o.last)}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
            <div className="space-y-6">
              <Card title="Insights">
                <ul className="space-y-2 px-5 py-4 text-sm text-slate-700">
                  {item.insights.length ? item.insights.map((t, i) => <li key={i}>• {t}</li>) : <li className="text-slate-400">Not enough data yet.</li>}
                </ul>
              </Card>
              {item.notSent.length > 0 && (
                <Card title="Not sent in this period">
                  <div className="flex flex-wrap gap-2 px-5 py-4">
                    {item.notSent.map((n) => <span key={n} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">{n}</span>)}
                  </div>
                </Card>
              )}
            </div>
          </div>

          <Card title="Dispatch log" sub={`Latest ${Math.min(50, item.c.length)} of ${item.c.length}`}>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-100 text-slate-600"><tr><Th>Date</Th><Th>Outlet</Th><Th right>Quantity</Th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {[...item.c].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id).slice(0, 50).map((r) => (
                    <tr key={r.id}><Td>{short(r.date)}</Td><Td bold>{r.outlet}</Td><Td right>{fmt(r.qty)}</Td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ) : categories.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-500">
          No packaging or other items were dispatched since 1 {mName[0]}.
        </div>
      ) : (
        /* ================= CATEGORY TRENDS ================= */
        <div className="space-y-6">
          {/* category selector */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {catCards.map((c) => (
              <button
                key={c.cat}
                onClick={() => setCat(c.cat)}
                className={`rounded-xl border bg-white p-4 text-left ${cat === c.cat ? "border-slate-900 ring-1 ring-slate-900" : "border-slate-200 hover:border-slate-300"}`}
              >
                <div className="flex items-center justify-between">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${CAT_STYLE[c.cat] || "bg-slate-100 text-slate-600"}`}>{c.cat}</span>
                  <span className="flex items-center gap-1.5">
                    <Delta cur={c.q[2]} prev={c.prevSame} />
                    <span className="text-xs text-slate-400">vs {mName[1]}</span>
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  {c.q.map((v, i) => (
                    <div key={i}>
                      <div className="text-lg font-bold tabular-nums">{fmt(v)}</div>
                      <div className="text-xs text-slate-500">{mName[i]}{i === 2 ? " (MTD)" : ""}</div>
                    </div>
                  ))}
                </div>
              </button>
            ))}
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            {/* one table per outlet */}
            <div className="space-y-6 lg:col-span-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-semibold">
                  {cat} by outlet{" "}
                  <span className="text-sm font-normal text-slate-500">
                    ({detail.outletCards.length} {detail.outletCards.length === 1 ? "outlet" : "outlets"})
                  </span>
                </h2>
                <p className="text-xs text-slate-500">
                  * {mName[2]} is month-to-date, so {mName[1]} → {mName[2]} compares 1–{dom} {mName[2]} with 1–{dom} {mName[1]}.
                </p>
              </div>

              {detail.outletCards.map((o) => (
                <Card
                  key={o.outlet}
                  title={o.outlet}
                  sub={`${o.items.length} ${o.items.length === 1 ? "item" : "items"}${o.mixed ? " · mixed units" : ""}`}
                  right={
                    <div className="text-right">
                      <div className="text-xl font-bold tabular-nums">{fmt(o.total)}</div>
                      <div className="text-xs text-slate-500">{mName[0]} – {mName[2]}</div>
                    </div>
                  }
                >
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-100 text-slate-600">
                        <tr>
                          <Th>Item</Th>
                          <Th right>{mName[0]}</Th>
                          <Th right>{mName[1]}</Th>
                          <Th right>{mName[2]}</Th>
                          <Th right>{mName[1]} → {mName[2]}*</Th>
                          <Th right>Total</Th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {o.items.map((i) => (
                          <tr key={i.key}>
                            <Td bold>{i.name}{i.uom && <span className="ml-1 text-xs font-normal text-slate-400">({i.uom})</span>}</Td>
                            <Td right>{cell(i.q[0])}</Td>
                            <Td right>{cell(i.q[1])}</Td>
                            <Td right>{cell(i.q[2])}</Td>
                            <Td right><Delta cur={i.q[2]} prev={i.prevSame} /></Td>
                            <Td right bold>{fmt(i.total)}</Td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                        <tr>
                          <Td>Total</Td>
                          <Td right>{fmt(o.q[0])}</Td>
                          <Td right>{fmt(o.q[1])}</Td>
                          <Td right>{fmt(o.q[2])}</Td>
                          <Td right><Delta cur={o.q[2]} prev={o.prevSame} /></Td>
                          <Td right>{fmt(o.total)}</Td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </Card>
              ))}
            </div>

            <div className="space-y-6">
              <Card title="Insights">
                <ul className="space-y-2 px-5 py-4 text-sm text-slate-700">
                  {detail.insights.length ? detail.insights.map((t, i) => <li key={i}>• {t}</li>) : <li className="text-slate-400">Not enough data yet.</li>}
                </ul>
              </Card>
              <Card title="Top outlets" sub={`${cat} received, ${mName[0]} – ${mName[2]}`}>
                <ul className="divide-y divide-slate-100">
                  {detail.byOutlet.slice(0, 8).map((o) => (
                    <li key={o.outlet} className="px-5 py-2.5">
                      <div className="flex justify-between text-sm"><span className="font-medium">{o.outlet}</span><span className="tabular-nums">{fmt(o.qty)}</span></div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full bg-slate-900" style={{ width: `${(o.qty / detail.byOutlet[0].qty) * 100}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}