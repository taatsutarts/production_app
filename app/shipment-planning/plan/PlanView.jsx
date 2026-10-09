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
const down6 = (n) => Math.max(0, Math.floor(n / 6) * 6);

export default function PlanView({ items, outlets, stock, shares }) {
  const [picked, setPicked] = useState([]);
  const [totals, setTotals] = useState({}); // outlet -> total to send (typed)
  const [edits, setEdits] = useState({}); // outlet -> item -> typed quantity

  const toggle = (name) =>
    setPicked((p) =>
      p.includes(name) ? p.filter((x) => x !== name) : [...p, name]
    );

  const pctSum = shares.reduce((s, x) => s + x.pct, 0) || 1;
  const pctOf = {};
  shares.forEach((x) => (pctOf[x.item] = x.pct));

  // current stock: outlet -> item -> qty
  const stockBy = {};
  stock.forEach((r) => {
    stockBy[r.outlet] = stockBy[r.outlet] || {};
    stockBy[r.outlet][r.item] = (stockBy[r.outlet][r.item] || 0) + r.qty;
  });

  const roomOf = (o) => {
    const f = Number(o.fridge_capacity) || 0;
    const t = Object.values(stockBy[o.name] || {}).reduce((s, v) => s + v, 0);
    return f ? f - t : null;
  };

  // CK stock left after each outlet in turn
  const rem = {};
  items.forEach((i) => (rem[i.item] = i.ck));

  const plans = picked.map((name) => {
    const o = outlets.find((x) => x.name === name) || {};
    const mine = stockBy[name] || {};
    const hasStock = stockBy[name] !== undefined;
    const curTotal = Object.values(mine).reduce((s, v) => s + v, 0);
    const listed = shares.reduce((s, x) => s + (mine[x.item] || 0), 0);

    const fridge = Number(o.fridge_capacity) || 0;
    const room = fridge ? fridge - curTotal : null;

    // suggested total: what the outlet needs for the next 7 days, up to its room
    const cutoff = Number(o.cutoff_stock) || 0;
    const demand =
      5 * (Number(o.weekday_avg) || 0) + 2 * (Number(o.weekend_avg) || 0);
    const need = Math.max(0, cutoff + demand - curTotal);
    const suggested = down6(room !== null ? Math.min(need, room) : need);

    const typedTotal = totals[name];
    const total =
      typedTotal !== undefined ? Math.max(0, Number(typedTotal) || 0) : suggested;

    const cells = {};
    items.forEach((i) => {
      const cur = mine[i.item] || 0;
      const pct = pctOf[i.item];
      let sug = 0;
      if (pct) {
        const target = ((listed + total) * pct) / pctSum;
        sug = Math.max(0, Math.round((target - cur) / 6) * 6);
        sug = Math.min(sug, down6(rem[i.item]));
      }
      const typed = edits[name]?.[i.item];
      const val = typed !== undefined ? Math.max(0, Number(typed) || 0) : sug;
      cells[i.item] = {
        cur,
        val,
        text: typed !== undefined ? typed : String(sug),
      };
    });

    items.forEach((i) => (rem[i.item] -= cells[i.item].val));

    const planned = items.reduce((s, i) => s + cells[i.item].val, 0);
    return {
      name,
      hasStock,
      curTotal,
      room,
      suggested,
      typedTotal,
      cells,
      planned,
      after: room !== null ? room - planned : null,
      fit: planned > 0 ? BOXES.find((b) => b.qty >= planned) : null,
    };
  });

  const ckTotal = items.reduce((s, i) => s + i.ck, 0);
  const remTotal = items.reduce((s, i) => s + rem[i.item], 0);

  const setTotal = (name, v) => {
    setTotals((t) => ({ ...t, [name]: v }));
    setEdits((e) => ({ ...e, [name]: {} }));
  };
  const setCell = (name, item, v) =>
    setEdits((e) => ({ ...e, [name]: { ...(e[name] || {}), [item]: v } }));
  const autoFill = (name) => {
    setTotals((t) => {
      const n = { ...t };
      delete n[name];
      return n;
    });
    setEdits((e) => ({ ...e, [name]: {} }));
  };
  const clearAll = (name) => {
    setTotals((t) => ({ ...t, [name]: "0" }));
    setEdits((e) => ({
      ...e,
      [name]: Object.fromEntries(items.map((i) => [i.item, "0"])),
    }));
  };

  return (
    <>
      {/* Pick outlets */}
      <p className="mt-5 text-xs font-semibold text-slate-500">
        Sending today to (pick one or more)
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {outlets.map((o) => {
          const r = roomOf(o);
          const on = picked.includes(o.name);
          return (
            <button
              key={o.name}
              onClick={() => toggle(o.name)}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                on
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-slate-300 bg-white text-slate-600"
              }`}
            >
              {o.name}
              {stockBy[o.name] === undefined
                ? " · no stock data"
                : r !== null
                ? " · room " + Math.round(r)
                : ""}
            </button>
          );
        })}
      </div>

      {/* One card per picked outlet */}
      {plans.length > 0 && (
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {plans.map((p) => (
            <div
              key={p.name}
              className="rounded-xl border border-slate-200 bg-white p-4"
            >
              <p className="font-semibold">{p.name}</p>
              {!p.hasStock && (
                <p className="mt-1 text-xs text-amber-700">
                  No stock found in the stock sheet. Stock counted as 0.
                </p>
              )}

              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                <div>
                  <p className="text-slate-400">Stock now</p>
                  <p className="text-base font-semibold">{fmt(p.curTotal)}</p>
                </div>
                <div>
                  <p className="text-slate-400">Room</p>
                  <p className="text-base font-semibold">
                    {p.room !== null ? fmt(p.room) : "-"}
                  </p>
                </div>
                <div>
                  <p className="text-slate-400">After shipment</p>
                  <p
                    className={`text-base font-semibold ${
                      p.after !== null && p.after < 0 ? "text-red-600" : ""
                    }`}
                  >
                    {p.after !== null ? fmt(p.after) : "-"}
                  </p>
                </div>
              </div>

              <label className="mt-3 block text-xs font-semibold text-slate-500">
                Total to send (suggested {p.suggested})
              </label>
              <input
                type="number"
                min="0"
                value={p.typedTotal !== undefined ? p.typedTotal : String(p.suggested)}
                onChange={(e) => setTotal(p.name, e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
              />

              <p className="mt-2 text-xs text-slate-500">
                Planned <b>{p.planned}</b> · {p.planned / 6} boxes of 6
                {p.fit ? " · " + p.fit.label : ""}
                {p.planned > 810 ? " · over 3 x 60L (Max)" : ""}
              </p>

              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => autoFill(p.name)}
                  className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600"
                >
                  Auto-fill
                </button>
                <button
                  onClick={() => clearAll(p.name)}
                  className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600"
                >
                  Clear
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {plans.length === 0 && (
        <p className="mt-3 text-sm text-slate-500">
          Pick an outlet above to plan the shipment. The CK stock is shown below.
        </p>
      )}

      {/* Plan table */}
      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th rowSpan={2} className="sticky left-0 bg-slate-100 px-3 py-2 align-bottom">
                Item
              </th>
              <th rowSpan={2} className="px-3 py-2 text-right align-bottom">
                CK stock
              </th>
              <th rowSpan={2} className="px-3 py-2 text-right align-bottom">
                Remaining
              </th>
              {plans.map((p) => (
                <th
                  key={p.name}
                  colSpan={2}
                  className="border-l border-slate-200 px-3 py-2 text-center"
                >
                  {p.name}
                </th>
              ))}
            </tr>
            {plans.length > 0 && (
              <tr className="text-xs text-slate-500">
                {plans.map((p) => (
                  <Fragment2 key={p.name} />
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.item} className="border-t border-slate-100">
                <td className="sticky left-0 whitespace-nowrap bg-white px-3 py-2 font-medium">
                  {i.item}
                </td>
                <td className="px-3 py-2 text-right">{fmt(i.ck)}</td>
                <td
                  className={`px-3 py-2 text-right font-semibold ${
                    rem[i.item] < 0 ? "text-red-600" : ""
                  }`}
                >
                  {fmt(rem[i.item])}
                </td>
                {plans.map((p) => {
                  const c = p.cells[i.item];
                  return (
                    <Cells
                      key={p.name}
                      cur={c.cur}
                      text={c.text}
                      onChange={(v) => setCell(p.name, i.item, v)}
                    />
                  );
                })}
              </tr>
            ))}
            <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
              <td className="sticky left-0 bg-slate-50 px-3 py-2">Total</td>
              <td className="px-3 py-2 text-right">{fmt(ckTotal)}</td>
              <td className="px-3 py-2 text-right">{fmt(remTotal)}</td>
              {plans.map((p) => (
                <td key={p.name} colSpan={2} className="border-l border-slate-200 px-3 py-2 text-center">
                  {fmt(p.curTotal)} + {p.planned}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

// two cells for one outlet: current stock and the quantity to send
function Cells({ cur, text, onChange }) {
  return (
    <>
      <td className="border-l border-slate-200 px-3 py-2 text-right text-slate-500">
        {fmt(cur)}
      </td>
      <td className="px-2 py-1 text-right">
        <input
          type="number"
          min="0"
          value={text}
          onChange={(e) => onChange(e.target.value)}
          className="w-16 rounded border border-slate-300 bg-blue-50 px-2 py-1 text-right text-sm font-semibold text-blue-700"
        />
      </td>
    </>
  );
}

// sub headers for one outlet: Stock | Send
function Fragment2() {
  return (
    <>
      <th className="border-l border-slate-200 px-3 py-1 text-right font-medium">Stock</th>
      <th className="px-3 py-1 text-right font-medium">Send</th>
    </>
  );
}