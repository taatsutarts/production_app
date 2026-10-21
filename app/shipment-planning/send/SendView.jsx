"use client";
import { useState } from "react";

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

const fmt = (n) => String(Math.round(n * 100) / 100);
const toQty = (v) => Math.max(0, Number(v) || 0);

export default function SendView({
  outlets,
  stock,
  shares,
  purchaseItems = [],
  initialOutlet,
}) {
  const startOutlet = outlets.some((o) => o.name === initialOutlet)
    ? initialOutlet
    : outlets[0]?.name || "";
  const [outlet, setOutlet] = useState(startOutlet);
  const [totalText, setTotalText] = useState("720");
  const [tartEdits, setTartEdits] = useState({}); // item -> typed qty (tarts)
  const [qtys, setQtys] = useState({}); // purchase item name -> typed qty
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState(null); // { ok, msg }

  if (outlets.length === 0) {
    return <p className="mt-6 text-slate-500">No outlets found.</p>;
  }
  if (shares.length === 0) {
    return (
      <p className="mt-6 text-slate-500">
        No sales % found. Add rows to the item_sales_share table.
      </p>
    );
  }

  const total = Math.max(0, Number(totalText) || 0);
  const o = outlets.find((x) => x.name === outlet) || {};

  // current stock of the selected outlet
  const outletRows = stock.filter((r) => r.outlet === outlet);
  const hasStock = outletRows.length > 0;
  const stockMap = {};
  outletRows.forEach((r) => {
    stockMap[r.item] = (stockMap[r.item] || 0) + r.qty;
  });

  const allStock = Object.values(stockMap).reduce((s, v) => s + v, 0);
  const listed = shares.reduce((s, x) => s + (stockMap[x.item] || 0), 0);
  const pctSum = shares.reduce((s, x) => s + x.pct, 0) || 1;

  // suggested qty per flavour (boxes of 6) - editable in the table
  const rows = shares
    .map((x) => {
      const cur = stockMap[x.item] || 0;
      const target = ((listed + total) * x.pct) / pctSum;
      const suggested = Math.max(0, Math.round((target - cur) / 6) * 6);
      const typed = tartEdits[x.item];
      const send = typed === undefined ? suggested : toQty(typed);
      return {
        item: x.item,
        pct: (x.pct / pctSum) * 100,
        cur,
        suggested,
        send,
        inputValue: typed === undefined ? String(suggested) : typed,
        after: cur + send,
      };
    })
    .sort((a, b) => b.pct - a.pct);

  const planned = rows.reduce((s, r) => s + r.send, 0);
  const fridge = Number(o.fridge_capacity) || 0;
  const room = fridge - allStock;
  const left = room - planned;
  const fit = planned > 0 ? BOXES.find((b) => b.qty >= planned) : null;

  // group purchase items by category
  const grouped = CATEGORIES.map((c) => ({
    category: c,
    items: purchaseItems.filter((i) => i.category === c),
  })).filter((g) => g.items.length > 0);

  const changeOutlet = (v) => {
    setOutlet(v);
    setTartEdits({});
    setQtys({});
    setStatus(null);
  };
  const changeTotal = (v) => {
    setTotalText(v);
    setTartEdits({}); // go back to suggested qty
  };

  // everything that will be sent
  const buildItems = () => {
    const items = [];
    rows.forEach((r) => {
      if (r.send > 0) items.push({ name: r.item, qty: r.send, category: "Tarts" });
    });
    grouped.forEach((g) =>
      g.items.forEach((i) => {
        const q = toQty(qtys[i.name]);
        if (q > 0) items.push({ name: i.name, qty: q, category: g.category });
      })
    );
    return items;
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
        body: list.map((i) => {
          const label =
            purchaseItems.find((p) => p.name === i.name)?.label || i.name;
          return [label, fmt(i.qty)];
        }),
        columnStyles: { 1: { halign: "right", cellWidth: 30 } },
        headStyles: { fillColor: [30, 41, 59] },
        styles: { fontSize: 9 },
      });
      y = doc.lastAutoTable.finalY + 8;
    });

    const stamp = when.toISOString().slice(0, 10);
    doc.save(`PO_${outlet.replace(/\s+/g, "_")}_${stamp}.pdf`);
  };

  const sendPO = async () => {
    const items = buildItems();
    if (items.length === 0) {
      setStatus({ ok: false, msg: "Nothing to send. Enter at least one qty." });
      return;
    }
    const when = new Date();
    setSending(true);
    setStatus(null);
    try {
      const res = await fetch("/api/send-po", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          location: outlet,
          dispatchedAt: when.toISOString(),
          items: items.map(({ name, qty }) => ({ name, qty })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const extra = data.unknown ? ": " + data.unknown.join(", ") : "";
        setStatus({ ok: false, msg: (data.error || "Failed") + extra });
      } else {
        await makePdf(items, when);
        setStatus({ ok: true, msg: `PO sent (${data.inserted} items). PDF downloaded.` });
        setTartEdits({});
        setQtys({});
      }
    } catch (e) {
      setStatus({ ok: false, msg: e.message });
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      {/* Inputs */}
      <div className="mt-4 grid gap-4 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-2">
        <div>
          <label className="text-xs font-semibold text-slate-500">
            Select outlet
          </label>
          <select
            value={outlet}
            onChange={(e) => changeOutlet(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            {outlets.map((x) => (
              <option key={x.name} value={x.name}>
                {x.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs font-semibold text-slate-500">
            Total tarts to send
          </label>
          <input
            type="number"
            min="0"
            value={totalText}
            onChange={(e) => changeTotal(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          />
        </div>

        <div className="md:col-span-2">
          <p className="text-xs font-semibold text-slate-500">
            Or pick a thermocol size
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {BOXES.map((b) => (
              <button
                key={b.label}
                onClick={() => changeTotal(String(b.qty))}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
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

      {!hasStock && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
          No stock found for {outlet} in the stock sheet, so its current stock
          is counted as 0.
        </div>
      )}

      {/* Summary */}
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs text-slate-400">Tarts to send</p>
          <p className="text-xl font-bold">{fmt(planned)}</p>
          <p className="text-xs text-slate-500">
            {fmt(planned / 6)} boxes of 6
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs text-slate-400">Thermocol needed</p>
          <p className="text-xl font-bold">
            {fit ? fit.label : planned > 0 ? "Over 3 x 60L" : "-"}
          </p>
          {fit && (
            <p className="text-xs text-slate-500">
              holds {fit.boxes} boxes · {fit.qty} tarts
            </p>
          )}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs text-slate-400">Fridge room now</p>
          <p className="text-xl font-bold">{fridge ? fmt(room) : "-"}</p>
          <p className="text-xs text-slate-500">
            capacity {fridge || "-"} · stock {fmt(allStock)}
          </p>
        </div>
        <div
          className={`rounded-xl border p-3 ${
            fridge && left < 0
              ? "border-red-300 bg-red-50"
              : "border-slate-200 bg-white"
          }`}
        >
          <p className="text-xs text-slate-400">Capacity after shipment</p>
          <p
            className={`text-xl font-bold ${
              fridge && left < 0 ? "text-red-600" : ""
            }`}
          >
            {fridge ? fmt(left) : "-"}
          </p>
          {fridge > 0 && left < 0 && (
            <p className="text-xs text-red-600">Over capacity</p>
          )}
        </div>
      </div>

      {total > 0 && planned !== total && (
        <p className="mt-3 text-xs text-slate-500">
          You asked for {total}. Suggested qty is rounded to full boxes of 6;
          the current plan is {fmt(planned)}.
        </p>
      )}

      {/* Tarts table */}
      <h2 className="mt-6 text-sm font-bold text-slate-700">Tarts</h2>
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
              <tr key={r.item} className="border-t border-slate-100">
                <td className="whitespace-nowrap px-3 py-2 font-medium">
                  {r.item}
                </td>
                <td className="px-3 py-2 text-right">{r.pct.toFixed(1)}%</td>
                <td className="px-3 py-2 text-right">{fmt(r.cur)}</td>
                <td className="px-3 py-2 text-right">
                  <input
                    type="number"
                    min="0"
                    value={r.inputValue}
                    onChange={(e) =>
                      setTartEdits((p) => ({ ...p, [r.item]: e.target.value }))
                    }
                    className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-right text-sm font-semibold text-blue-700"
                  />
                </td>
                <td className="px-3 py-2 text-right">{fmt(r.send / 6)}</td>
                <td className="px-3 py-2 text-right">{fmt(r.after)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
              <td className="px-3 py-2">Total</td>
              <td className="px-3 py-2 text-right">100%</td>
              <td className="px-3 py-2 text-right">{fmt(listed)}</td>
              <td className="px-3 py-2 text-right">{fmt(planned)}</td>
              <td className="px-3 py-2 text-right">{fmt(planned / 6)}</td>
              <td className="px-3 py-2 text-right">{fmt(listed + planned)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Other categories */}
      {grouped.map((g) => (
        <div key={g.category}>
          <h2 className="mt-6 text-sm font-bold text-slate-700">
            {g.category}
          </h2>
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
                  <tr key={i.name} className="border-t border-slate-100">
                    <td className="whitespace-nowrap px-3 py-2 font-medium">
                      {i.label}
                    </td>
                    <td className="px-3 py-2 text-slate-500">{i.uom}</td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        min="0"
                        placeholder="0"
                        value={qtys[i.name] ?? ""}
                        onChange={(e) =>
                          setQtys((p) => ({ ...p, [i.name]: e.target.value }))
                        }
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

      {/* Send PO */}
      <div className="mt-6 flex items-center gap-3">
        <button
          onClick={sendPO}
          disabled={sending}
          className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {sending ? "Sending..." : "Send PO"}
        </button>
        {status && (
          <p
            className={`text-sm ${status.ok ? "text-green-700" : "text-red-600"}`}
          >
            {status.msg}
          </p>
        )}
      </div>
    </>
  );
}
