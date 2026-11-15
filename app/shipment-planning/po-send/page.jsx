"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

/* ---------- helpers ---------- */

const BOXES = [
  { label: "30L", boxes: 14, qty: 84 },
  { label: "60L", boxes: 45, qty: 270 },
  { label: "60L + 30L", boxes: 59, qty: 354 },
  { label: "2 x 60L (Min)", boxes: 80, qty: 480 },
  { label: "2 x 60L (Max)", boxes: 90, qty: 540 },
  { label: "3 x 60L (Min)", boxes: 120, qty: 720 },
  { label: "3 x 60L (Max)", boxes: 135, qty: 810 },
];

const CATEGORIES = ["Garnishing", "Packaging", "Beverages", "Dairy"];

const prettyName = (s) => {
  let t = (s || "").replace(/^#_#\s*/, "").replace(/\s*-\s*Taatsu$/i, "").replace(/^TTS\s+/i, "").trim();
  if (t && t === t.toUpperCase()) {
    t = t.toLowerCase().split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  }
  return t;
};

const fmt = (n) => String(Math.round(n * 100) / 100);
const toQty = (v) => Math.max(0, Number(v) || 0);
const pointer = "cursor-pointer disabled:cursor-not-allowed";
const input = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";

function Skeleton() {
  return (
    <div className="mt-4 animate-pulse space-y-4">
      <div className="h-28 rounded-xl bg-slate-200" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-20 rounded-xl bg-slate-200" />
        ))}
      </div>
      <div className="h-64 rounded-xl bg-slate-200" />
    </div>
  );
}

/* ---------- page ---------- */

export default function SendOrderPage() {
  const [outlets, setOutlets] = useState(null);
  const [shares, setShares] = useState([]); // { itemId, item, pct }
  const [purchase, setPurchase] = useState([]); // { id, name, label, uom, category }
  const [stock, setStock] = useState({ rows: [], dateCell: "", loading: true });

  const [outlet, setOutlet] = useState("");
  const [totalText, setTotalText] = useState("720");
  const [tartEdits, setTartEdits] = useState({});
  const [qtys, setQtys] = useState({});
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState("");

  /* ----- load ----- */

  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("outlet") || "";

    // Supabase, straight from the browser, all in parallel
    (async () => {
      const [o, s, p] = await Promise.all([
        supabase
          .from("outlets")
          .select("id,name,fridge_capacity")
          .neq("outlet_type", "office")
          .order("name"),
        supabase.from("item_sales_share").select("item_id,sales_pct,items(item_name)"),
        supabase
          .from("purchase_items")
          .select("id,item_name,uom,category")
          .eq("status", "Active")
          .in("category", CATEGORIES)
          .order("item_name"),
      ]);
      const err = o.error || s.error || p.error;
      if (err) return setError(err.message);

      const list = o.data || [];
      setOutlets(list);
      setOutlet(list.some((x) => x.name === wanted) ? wanted : list[0]?.name || "");
      setShares(
        (s.data || [])
          .filter((x) => x.items)
          .map((x) => ({ itemId: x.item_id, item: x.items.item_name, pct: Number(x.sales_pct) }))
      );
      setPurchase(
        (p.data || []).map((x) => ({
          id: x.id,
          name: x.item_name,
          label: prettyName(x.item_name),
          uom: x.uom || "",
          category: x.category,
        }))
      );
    })();

    // slow Google Sheet read, never blocks the rest
    fetch("/api/stock")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        setStock({ rows: d.stock || [], dateCell: d.dateCell || "", loading: false });
      })
      .catch((e) => {
        setError(e.message);
        setStock((s) => ({ ...s, loading: false }));
      });
  }, []);

  /* ----- derived ----- */

  const calc = useMemo(() => {
    const o = (outlets || []).find((x) => x.name === outlet) || {};
    const total = toQty(totalText);

    const outletRows = stock.rows.filter((r) => r.outlet === outlet);
    const stockMap = {};
    outletRows.forEach((r) => {
      stockMap[r.item] = (stockMap[r.item] || 0) + r.qty;
    });

    const allStock = Object.values(stockMap).reduce((s, v) => s + v, 0);
    const listed = shares.reduce((s, x) => s + (stockMap[x.item] || 0), 0);
    const pctSum = shares.reduce((s, x) => s + x.pct, 0) || 1;

    const rows = shares
      .map((x) => {
        const cur = stockMap[x.item] || 0;
        const target = ((listed + total) * x.pct) / pctSum;
        const suggested = Math.max(0, Math.round((target - cur) / 6) * 6);
        const typed = tartEdits[x.item];
        const send = typed === undefined ? suggested : toQty(typed);
        return {
          itemId: x.itemId,
          item: x.item,
          pct: (x.pct / pctSum) * 100,
          cur,
          send,
          inputValue: typed === undefined ? String(suggested) : typed,
          after: cur + send,
        };
      })
      .sort((a, b) => b.pct - a.pct);

    const planned = rows.reduce((s, r) => s + r.send, 0);
    const fridge = Number(o.fridge_capacity) || 0;
    const room = fridge - allStock;
    return {
      o, total, rows, listed, planned, fridge, room,
      allStock,
      hasStock: outletRows.length > 0,
      left: room - planned,
      fit: planned > 0 ? BOXES.find((b) => b.qty >= planned) : null,
    };
  }, [outlets, outlet, totalText, stock.rows, shares, tartEdits]);

  const grouped = useMemo(
    () =>
      CATEGORIES.map((c) => ({ category: c, items: purchase.filter((i) => i.category === c) })).filter(
        (g) => g.items.length > 0
      ),
    [purchase]
  );

  const { o, total, rows, listed, planned, fridge, room, allStock, hasStock, left, fit } = calc;

  /* ----- actions ----- */

  const changeOutlet = (v) => {
    setOutlet(v);
    setTartEdits({});
    setQtys({});
    setStatus(null);
  };
  const changeTotal = (v) => {
    setTotalText(v);
    setTartEdits({});
  };

  const makePdf = async (items, when) => {
    const { default: jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text("Purchase Order / Dispatch", 14, 16);
    doc.setFontSize(10);
    doc.text(`Outlet: ${outlet}`, 14, 24);
    doc.text(`Date: ${when.toLocaleString()}`, 14, 30);

    let y = 36;
    ["Tarts", ...CATEGORIES].forEach((cat) => {
      const list = items.filter((i) => i.category === cat);
      if (list.length === 0) return;
      autoTable(doc, {
        startY: y,
        head: [[cat, "Qty"]],
        body: list.map((i) => [i.label, fmt(i.qty)]),
        columnStyles: { 1: { halign: "right", cellWidth: 30 } },
        headStyles: { fillColor: [30, 41, 59] },
        styles: { fontSize: 9 },
      });
      y = doc.lastAutoTable.finalY + 8;
    });
    doc.save(`PO_${outlet.replace(/\s+/g, "_")}_${when.toISOString().slice(0, 10)}.pdf`);
  };

  const sendPO = async () => {
    const items = [];
    rows.forEach((r) => {
      if (r.send > 0) items.push({ label: prettyName(r.item), qty: r.send, category: "Tarts", item_id: r.itemId });
    });
    grouped.forEach((g) =>
      g.items.forEach((i) => {
        const q = toQty(qtys[i.id]);
        if (q > 0) items.push({ label: i.label, qty: q, category: g.category, purchase_item_id: i.id });
      })
    );
    if (items.length === 0) return setStatus({ ok: false, msg: "Nothing to send. Enter at least one qty." });

    const when = new Date();
    setSending(true);
    setStatus(null);

    const { error: err } = await supabase.from("dispatches").insert(
      items.map((i) => ({
        outlet_id: o.id,
        item_id: i.item_id ?? null,
        purchase_item_id: i.purchase_item_id ?? null,
        qty: i.qty,
        dispatched_at: when.toISOString(),
      }))
    );

    if (err) {
      setStatus({ ok: false, msg: err.message });
    } else {
      try {
        await makePdf(items, when);
        setStatus({ ok: true, msg: `PO sent (${items.length} items). PDF downloaded.` });
      } catch (e) {
        setStatus({ ok: true, msg: `PO sent (${items.length} items). PDF failed: ${e.message}` });
      }
      setTartEdits({});
      setQtys({});
    }
    setSending(false);
  };

  /* ---------- render ---------- */

  return (
    <div className="w-full pb-16">
      <h1 className="text-2xl font-bold">Send to Outlet</h1>

      {error && <p className="mt-4 text-red-600">{error}</p>}
      {!outlets && !error && <Skeleton />}

      {outlets && (
        <>
          <p className="mt-1 text-sm text-slate-500">
            {stock.loading
              ? "Loading live stock from the Google Sheet…"
              : "Stock is live from the Google Sheet" + (stock.dateCell ? " · as on " + stock.dateCell : "")}
          </p>

          {/* inputs */}
          <div className="mt-4 grid gap-4 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-2">
            <div>
              <label className="text-xs font-semibold text-slate-500">Select outlet</label>
              <select
                value={outlet}
                onChange={(e) => changeOutlet(e.target.value)}
                className={`mt-1 w-full ${input} ${pointer}`}
              >
                {outlets.map((x) => (
                  <option key={x.id} value={x.name}>
                    {x.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500">Total tarts to send</label>
              <input
                type="number"
                min="0"
                value={totalText}
                onChange={(e) => changeTotal(e.target.value)}
                className={`mt-1 w-full ${input}`}
              />
            </div>
            <div className="md:col-span-2">
              <p className="text-xs font-semibold text-slate-500">Or pick a thermocol size</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {BOXES.map((b) => (
                  <button
                    key={b.label}
                    onClick={() => changeTotal(String(b.qty))}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${pointer} ${
                      total === b.qty
                        ? "border-blue-600 bg-blue-600 text-white"
                        : "border-slate-300 bg-white text-slate-600"
                    }`}
                  >
                    {b.label} · {b.qty}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {!hasStock && !stock.loading && (
            <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
              No stock found for {outlet} in the stock sheet, so its current stock is counted as 0.
            </div>
          )}

          {/* summary */}
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <p className="text-xs text-slate-400">Tarts to send</p>
              <p className="text-xl font-bold">{fmt(planned)}</p>
              <p className="text-xs text-slate-500">{fmt(planned / 6)} boxes of 6</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <p className="text-xs text-slate-400">Thermocol needed</p>
              <p className="text-xl font-bold">{fit ? fit.label : planned > 0 ? "Over 3 x 60L" : "-"}</p>
              {fit && (
                <p className="text-xs text-slate-500">
                  holds {fit.boxes} boxes · {fit.qty} tarts
                </p>
              )}
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <p className="text-xs text-slate-400">Fridge room now</p>
              <p className="text-xl font-bold">{fridge && !stock.loading ? fmt(room) : "-"}</p>
              <p className="text-xs text-slate-500">
                capacity {fridge || "-"} · stock {stock.loading ? "…" : fmt(allStock)}
              </p>
            </div>
            <div
              className={`rounded-xl border p-3 ${
                fridge && !stock.loading && left < 0 ? "border-red-300 bg-red-50" : "border-slate-200 bg-white"
              }`}
            >
              <p className="text-xs text-slate-400">Capacity after shipment</p>
              <p className={`text-xl font-bold ${fridge && !stock.loading && left < 0 ? "text-red-600" : ""}`}>
                {fridge && !stock.loading ? fmt(left) : "-"}
              </p>
              {fridge > 0 && !stock.loading && left < 0 && <p className="text-xs text-red-600">Over capacity</p>}
            </div>
          </div>

          {total > 0 && planned !== total && (
            <p className="mt-3 text-xs text-slate-500">
              You asked for {total}. Suggested qty is rounded to full boxes of 6; the current plan is {fmt(planned)}.
            </p>
          )}

          {/* tarts */}
          <h2 className="mt-6 text-sm font-bold text-slate-700">Tarts</h2>
          {shares.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">No sales % found. Add rows to item_sales_share.</p>
          ) : (
            <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-100 text-slate-600">
                  <tr>
                    <th className="px-3 py-2">Item</th>
                    <th className="px-3 py-2 text-right">Sales %</th>
                    <th className="px-3 py-2 text-right">Current stock</th>
                    <th className="px-3 py-2 text-right">To send</th>
                    <th className="px-3 py-2 text-right">Boxes of 6</th>
                    <th className="px-3 py-2 text-right">Stock after</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.itemId} className="border-t border-slate-100">
                      <td className="whitespace-nowrap px-3 py-2 font-medium">{prettyName(r.item)}</td>
                      <td className="px-3 py-2 text-right">{r.pct.toFixed(1)}%</td>
                      <td className="px-3 py-2 text-right">{stock.loading ? "…" : fmt(r.cur)}</td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min="0"
                          value={r.inputValue}
                          onChange={(e) => setTartEdits((p) => ({ ...p, [r.item]: e.target.value }))}
                          className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-right text-sm font-semibold text-blue-700"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">{fmt(r.send / 6)}</td>
                      <td className="px-3 py-2 text-right">{stock.loading ? "…" : fmt(r.after)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                    <td className="px-3 py-2">Total</td>
                    <td className="px-3 py-2 text-right">100%</td>
                    <td className="px-3 py-2 text-right">{stock.loading ? "…" : fmt(listed)}</td>
                    <td className="px-3 py-2 text-right">{fmt(planned)}</td>
                    <td className="px-3 py-2 text-right">{fmt(planned / 6)}</td>
                    <td className="px-3 py-2 text-right">{stock.loading ? "…" : fmt(listed + planned)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* other categories */}
          {grouped.map((g) => (
            <div key={g.category}>
              <h2 className="mt-6 text-sm font-bold text-slate-700">{g.category}</h2>
              <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-100 text-slate-600">
                    <tr>
                      <th className="px-3 py-2">Item</th>
                      <th className="px-3 py-2">Unit</th>
                      <th className="px-3 py-2 text-right">To send</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.items.map((i) => (
                      <tr key={i.id} className="border-t border-slate-100">
                        <td className="whitespace-nowrap px-3 py-2 font-medium">{i.label}</td>
                        <td className="px-3 py-2 text-slate-500">{i.uom}</td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            min="0"
                            placeholder="0"
                            value={qtys[i.id] ?? ""}
                            onChange={(e) => setQtys((p) => ({ ...p, [i.id]: e.target.value }))}
                            className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-right text-sm"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          {/* send */}
          <div className="mt-6 flex items-center gap-3">
            <button
              onClick={sendPO}
              disabled={sending || stock.loading}
              className={`rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50 ${pointer}`}
            >
              {sending ? "Sending..." : stock.loading ? "Loading stock…" : "Send PO"}
            </button>
            {status && <p className={`text-sm ${status.ok ? "text-green-700" : "text-red-600"}`}>{status.msg}</p>}
          </div>
        </>
      )}
    </div>
  );
}