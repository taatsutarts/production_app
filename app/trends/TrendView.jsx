"use client";
import { useState } from "react";

const ORDER = ["TARTS", "MINIS", "TART SHELLS", "DOUGH", "BLENDS & COMPOTE"];
const RANGES = [7, 14, 30, 90];

function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function Bars({ values, dates }) {
  const max = Math.max(...values, 1);
  const w = 300 / values.length;
  return (
    <svg viewBox="0 0 300 80" className="w-full">
      {values.map((v, i) => {
        const h = (v / max) * 70;
        return (
          <rect
            key={i}
            x={i * w + 1}
            y={75 - h}
            width={Math.max(w - 2, 1)}
            height={h}
            rx="1"
            className="fill-blue-500"
          >
            <title>{dates[i] + ": " + v}</title>
          </rect>
        );
      })}
      <line x1="0" y1="75" x2="300" y2="75" className="stroke-slate-300" />
    </svg>
  );
}

export default function TrendView({ rows }) {
  const [category, setCategory] = useState("TARTS");
  const [days, setDays] = useState(14);

  if (rows.length === 0) {
    return <p className="mt-6 text-slate-500">No production data yet.</p>;
  }

  // last N days, ending at the latest date that has data
  const latest = rows.reduce((m, r) => (r.date > m ? r.date : m), rows[0].date);
  const dates = [];
  for (let i = days - 1; i >= 0; i--) dates.push(addDays(latest, -i));

  const categories = [...new Set(rows.map((r) => r.category))].sort((a, b) => {
    const ia = ORDER.indexOf(a) === -1 ? 99 : ORDER.indexOf(a);
    const ib = ORDER.indexOf(b) === -1 ? 99 : ORDER.indexOf(b);
    return ia - ib;
  });

  // item -> date -> qty
  const items = {};
  rows
    .filter((r) => r.category === category)
    .forEach((r) => {
      items[r.name] = items[r.name] || {};
      items[r.name][r.date] = (items[r.name][r.date] || 0) + r.production;
    });

  const cards = Object.keys(items)
    .map((name) => {
      const values = dates.map((d) => items[name][d] || 0);
      const total = values.reduce((s, v) => s + v, 0);
      const producedDays = values.filter((v) => v > 0).length;
      return {
        name,
        values,
        total,
        producedDays,
        avg: producedDays ? total / producedDays : 0,
      };
    })
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total);

  return (
    <>
      {/* Category buttons */}
      <div className="mt-4 flex flex-wrap gap-2">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              category === cat
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-slate-300 bg-white text-slate-500"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Range buttons */}
      <div className="mt-3 flex gap-2">
        {RANGES.map((n) => (
          <button
            key={n}
            onClick={() => setDays(n)}
            className={`rounded-lg border px-3 py-1 text-xs font-medium ${
              days === n
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-300 bg-white text-slate-500"
            }`}
          >
            {n} days
          </button>
        ))}
      </div>

      {cards.length === 0 && (
        <p className="mt-6 text-slate-500">No production in this range.</p>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <div
            key={c.name}
            className="rounded-xl border border-slate-200 bg-white p-4"
          >
            <p className="truncate font-semibold">{c.name}</p>
            <div className="mt-2">
              <Bars values={c.values} dates={dates} />
            </div>
            <div className="flex justify-between text-[10px] text-slate-400">
              <span>{dates[0].slice(5)}</span>
              <span>{dates[dates.length - 1].slice(5)}</span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
              <div>
                <p className="text-slate-400">Total</p>
                <p className="font-semibold">{c.total}</p>
              </div>
              <div>
                <p className="text-slate-400">Avg / day</p>
                <p className="font-semibold">{c.avg.toFixed(1)}</p>
              </div>
              <div>
                <p className="text-slate-400">Days made</p>
                <p className="font-semibold">{c.producedDays}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}