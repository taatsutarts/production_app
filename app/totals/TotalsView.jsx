"use client";
import { useState } from "react";

// display order
const ORDER = ["TARTS", "MINIS", "TART SHELLS", "DOUGH", "BLENDS & COMPOTE"];

export default function TotalsView({ rows }) {
  // categories shown by default
  const [visible, setVisible] = useState(["TARTS"]);

  const toggle = (cat) => {
    setVisible((v) =>
      v.includes(cat) ? v.filter((c) => c !== cat) : [...v, cat]
    );
  };

  // group by category
  const byCategory = {};
  rows.forEach((r) => {
    if (!byCategory[r.category]) byCategory[r.category] = [];
    byCategory[r.category].push(r);
  });

  // sort categories in the order above, unknown ones at the end
  const categories = Object.keys(byCategory).sort((a, b) => {
    const ia = ORDER.indexOf(a) === -1 ? 99 : ORDER.indexOf(a);
    const ib = ORDER.indexOf(b) === -1 ? 99 : ORDER.indexOf(b);
    return ia - ib;
  });

  if (categories.length === 0) {
    return <p className="mt-6 text-slate-500">No data for this date.</p>;
  }

  const shown = categories.filter((c) => visible.includes(c));
  const shownRows = shown.flatMap((c) => byCategory[c]);
  const grandOpen = shownRows.reduce((s, r) => s + r.opening, 0);
  const grandProd = shownRows.reduce((s, r) => s + r.production, 0);

  return (
    <>
      {/* Category buttons */}
      <div className="mt-4 flex flex-wrap gap-2">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => toggle(cat)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              visible.includes(cat)
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-slate-300 bg-white text-slate-500"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      <div className="mt-6 space-y-6">
        {shown.length === 0 && (
          <p className="text-slate-500">Tap a category above to show it.</p>
        )}

        {shown.map((cat) => {
          const list = [...byCategory[cat]].sort((a, b) =>
            (a.name || "").localeCompare(b.name || "")
          );
          const sumOpen = list.reduce((s, r) => s + r.opening, 0);
          const sumProd = list.reduce((s, r) => s + r.production, 0);
          return (
            <div
              key={cat}
              className="overflow-x-auto rounded-xl border border-slate-200 bg-white"
            >
              <div className="bg-slate-100 px-4 py-2 text-sm font-semibold">
                {cat}
              </div>
              <table className="w-full text-left text-sm">
                <thead className="text-slate-500">
                  <tr>
                    <th className="px-4 py-2">Item</th>
                    <th className="px-4 py-2 text-right">Opening</th>
                    <th className="px-4 py-2 text-right">Production</th>
                    <th className="px-4 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((r, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="px-4 py-2">{r.name}</td>
                      <td className="px-4 py-2 text-right">{r.opening}</td>
                      <td className="px-4 py-2 text-right">{r.production}</td>
                      <td className="px-4 py-2 text-right font-medium">
                        {r.opening + r.production}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                    <td className="px-4 py-2">{cat} total</td>
                    <td className="px-4 py-2 text-right">{sumOpen}</td>
                    <td className="px-4 py-2 text-right">{sumProd}</td>
                    <td className="px-4 py-2 text-right">{sumOpen + sumProd}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          );
        })}

        {shown.length > 0 && (
          <div className="flex justify-between rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white">
            <span>Total (shown categories)</span>
            <span>
              {grandOpen} + {grandProd} = {grandOpen + grandProd}
            </span>
          </div>
        )}
      </div>
    </>
  );
}