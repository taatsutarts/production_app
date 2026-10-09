"use client";
import { useState } from "react";

const SECTIONS = ["Tarts", "Packaging", "Garnishing", "Other"];
const fmt = (n) => String(Math.round(n * 100) / 100);
const pos = (n) => Math.max(n, 0); // negative stock counts as 0 in percentages
const red = (n) => (n < 0 ? "text-red-600" : "");

export default function ByOutletView({ stock, warnings }) {
  const [section, setSection] = useState("Tarts");
  const [outlet, setOutlet] = useState("All");

  if (stock.length === 0) {
    return <p className="mt-6 text-slate-500">No stock data found.</p>;
  }

  const sections = SECTIONS.filter((s) => stock.some((r) => r.section === s));
  const active = sections.includes(section) ? section : sections[0];

  const allOutlets = [...new Set(stock.map((r) => r.outlet))].sort();
  const rows = stock.filter((r) => r.section === active);
  const outlets = [...new Set(rows.map((r) => r.outlet))].sort();

  // qty[item][outlet]
  const qty = {};
  const uom = {};
  rows.forEach((r) => {
    qty[r.item] = qty[r.item] || {};
    qty[r.item][r.outlet] = r.qty;
    uom[r.item] = r.uom;
  });

  const itemTotal = {};
  Object.keys(qty).forEach((i) => {
    itemTotal[i] = Object.values(qty[i]).reduce((s, v) => s + v, 0);
  });

  const items = Object.keys(qty).sort((a, b) => itemTotal[b] - itemTotal[a]);
  const grandTotal = items.reduce((s, i) => s + itemTotal[i], 0);
  const grandBase = items.reduce((s, i) => s + pos(itemTotal[i]), 0);
  const outletTotal = (o) => items.reduce((s, i) => s + (qty[i][o] || 0), 0);

  // one selected outlet
  const oItems = items
    .filter((i) => qty[i][outlet] !== undefined)
    .sort((a, b) => qty[b][outlet] - qty[a][outlet]);
  const oBase = oItems.reduce((s, i) => s + pos(qty[i][outlet]), 0);
  const maxPct = oBase
    ? Math.max(...oItems.map((i) => (pos(qty[i][outlet]) / oBase) * 100), 1)
    : 1;

  const unit = (i) =>
    uom[i] && uom[i] !== "piece" ? (
      <span className="ml-1 text-xs text-slate-400">{uom[i]}</span>
    ) : null;

  return (
    <>
      {(warnings.outlets.length > 0 || warnings.items.length > 0) && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
          <p className="font-semibold">
            Names with no alias yet (shown as written in the sheet):
          </p>
          {warnings.outlets.length > 0 && (
            <p className="mt-1">Outlets: {warnings.outlets.join(", ")}</p>
          )}
          {warnings.items.length > 0 && (
            <p className="mt-1">Items: {warnings.items.join(", ")}</p>
          )}
        </div>
      )}

      {/* Section buttons + outlet selector */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {sections.map((s) => (
          <button
            key={s}
            onClick={() => setSection(s)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              active === s
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-slate-300 bg-white text-slate-500"
            }`}
          >
            {s}
          </button>
        ))}

        <select
          value={outlet}
          onChange={(e) => setOutlet(e.target.value)}
          className="ml-auto rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
        >
          <option value="All">All outlets</option>
          {allOutlets.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>

      {/* All outlets: items x outlets table */}
      {outlet === "All" && (
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-600">
              <tr>
                <th className="sticky left-0 bg-slate-100 px-3 py-2">{active}</th>
                {outlets.map((o) => (
                  <th key={o} className="whitespace-nowrap px-3 py-2 text-right">
                    {o}
                  </th>
                ))}
                <th className="px-3 py-2 text-right">Total</th>
                <th className="whitespace-nowrap px-3 py-2 text-right">% of total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="sticky left-0 whitespace-nowrap bg-white px-3 py-2 font-medium">
                    {i}
                    {unit(i)}
                  </td>
                  {outlets.map((o) => (
                    <td key={o} className={`px-3 py-2 text-right ${red(qty[i][o] || 0)}`}>
                      {qty[i][o] === undefined ? "-" : fmt(qty[i][o])}
                    </td>
                  ))}
                  <td className={`px-3 py-2 text-right font-semibold ${red(itemTotal[i])}`}>
                    {fmt(itemTotal[i])}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {grandBase
                      ? ((pos(itemTotal[i]) / grandBase) * 100).toFixed(1) + "%"
                      : "-"}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                <td className="sticky left-0 bg-slate-50 px-3 py-2">Total</td>
                {outlets.map((o) => (
                  <td key={o} className="px-3 py-2 text-right">
                    {fmt(outletTotal(o))}
                  </td>
                ))}
                <td className="px-3 py-2 text-right">{fmt(grandTotal)}</td>
                <td className="px-3 py-2 text-right">100%</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* One outlet: quantity and % */}
      {outlet !== "All" && (
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <div className="flex justify-between bg-slate-100 px-4 py-2 text-sm font-semibold">
            <span>
              {outlet} · {active}
            </span>
            <span>Total: {fmt(oItems.reduce((s, i) => s + qty[i][outlet], 0))}</span>
          </div>

          {oItems.length === 0 && (
            <p className="px-4 py-4 text-sm text-slate-500">
              No {active.toLowerCase()} stock for this outlet.
            </p>
          )}

          {oItems.length > 0 && (
            <table className="w-full text-left text-sm">
              <thead className="text-slate-500">
                <tr>
                  <th className="px-4 py-2">Item</th>
                  <th className="px-4 py-2 text-right">Stock</th>
                  <th className="px-4 py-2">% of this outlet's {active.toLowerCase()}</th>
                  <th className="whitespace-nowrap px-4 py-2 text-right">% of all outlets</th>
                </tr>
              </thead>
              <tbody>
                {oItems.map((i) => {
                  const q = qty[i][outlet];
                  const pct = oBase ? (pos(q) / oBase) * 100 : 0;
                  const share = pos(itemTotal[i])
                    ? (pos(q) / pos(itemTotal[i])) * 100
                    : 0;
                  return (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="whitespace-nowrap px-4 py-2">
                        {i}
                        {unit(i)}
                      </td>
                      <td className={`px-4 py-2 text-right ${red(q)}`}>{fmt(q)}</td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-28 rounded bg-slate-100">
                            <div
                              className="h-2 rounded bg-blue-500"
                              style={{ width: (pct / maxPct) * 100 + "%" }}
                            />
                          </div>
                          <span className="w-12 text-right">{pct.toFixed(1)}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-2 text-right">{share.toFixed(1)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </>
  );
}