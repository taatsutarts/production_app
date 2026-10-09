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

const fmt = (n) => String(Math.round(n * 100) / 100);

export default function SendView({ outlets, stock, shares, initialOutlet }) {
  const startOutlet = outlets.some((o) => o.name === initialOutlet)
    ? initialOutlet
    : outlets[0]?.name || "";
  const [outlet, setOutlet] = useState(startOutlet);
  const [totalText, setTotalText] = useState("720");

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

  // how many of each flavour to send (rounded to boxes of 6)
  const rows = shares
    .map((x) => {
      const cur = stockMap[x.item] || 0;
      const target = ((listed + total) * x.pct) / pctSum;
      const send = Math.max(0, Math.round((target - cur) / 6) * 6);
      return {
        item: x.item,
        pct: (x.pct / pctSum) * 100,
        cur,
        send,
        after: cur + send,
      };
    })
    .sort((a, b) => b.pct - a.pct);

  const planned = rows.reduce((s, r) => s + r.send, 0);
  const fridge = Number(o.fridge_capacity) || 0;
  const room = fridge - allStock;
  const left = room - planned;
  const fit = planned > 0 ? BOXES.find((b) => b.qty >= planned) : null;

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
            onChange={(e) => setOutlet(e.target.value)}
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
            onChange={(e) => setTotalText(e.target.value)}
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
                onClick={() => setTotalText(String(b.qty))}
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
          <p className="text-xl font-bold">{planned}</p>
          <p className="text-xs text-slate-500">
            {planned / 6} boxes of 6
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
          You asked for {total}. Each flavour is rounded to full boxes of 6, so
          the plan is {planned}.
        </p>
      )}

      {/* Table */}
      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
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
                <td className="px-3 py-2 text-right font-semibold text-blue-700">
                  {r.send}
                </td>
                <td className="px-3 py-2 text-right">{r.send / 6}</td>
                <td className="px-3 py-2 text-right">{fmt(r.after)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
              <td className="px-3 py-2">Total</td>
              <td className="px-3 py-2 text-right">100%</td>
              <td className="px-3 py-2 text-right">{fmt(listed)}</td>
              <td className="px-3 py-2 text-right">{planned}</td>
              <td className="px-3 py-2 text-right">{planned / 6}</td>
              <td className="px-3 py-2 text-right">{fmt(listed + planned)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}