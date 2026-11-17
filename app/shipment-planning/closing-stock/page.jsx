"use client";

/* Outlet closing stock — overview (/shipment-planning/closing-stock).
 *
 * One screen for all stores (the matrix), plus the per-store links to send to
 * each store's team — they use /shipment-planning/closing-stock/<store> with its
 * own closing-date selector. Everything is one row per store × item × day in the
 * `stores_closing_stock` table (supabase_migration_planner_v8.sql; re-saving a
 * day overwrites it). The shipment planner reads the newest entry at or before
 * its dispatch date from that table, so stock is never typed anywhere else (no
 * hardcoded numbers).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseBrowser";
import {
  ITEMS, slugify, today, fetchActiveStores,
  card, title, mute, th, td, row, cell, Badge,
} from "./shared";

export default function ClosingStockPage() {
  const [date, setDate] = useState(null); // set on the client (avoids a server mismatch)
  const [stores, setStores] = useState(null); // active rows of the outlets table (outlet_type = store)
  const [rows, setRows] = useState({}); // "<outlet_id>|<item>" -> qty for the picked date
  const [last, setLast] = useState({}); // outlet_id -> newest stock_date entered so far
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null); // { ok, text }

  useEffect(() => setDate(today()), []);

  // the stores the entries are for (id + name straight from the outlets table)
  useEffect(() => {
    fetchActiveStores().then(({ data, error }) => {
      if (error) setErr(error.message);
      else setStores(data || []);
    });
  }, []);

  // load the picked date's entries (prefill) + each store's newest entry date.
  // Migration not run yet → stores_closing_stock 404s → shown as a clear error.
  useEffect(() => {
    if (!date || !stores) return;
    let alive = true;
    setErr(null);
    setMsg(null);
    (async () => {
      const ids = stores.map((s) => s.id);
      const { data, error } = await supabase
        .from("stores_closing_stock")
        .select("stock_date,outlet_id,item_name,qty")
        .eq("stock_date", date)
        .in("outlet_id", ids);
      if (!alive) return;
      if (error) { setErr(error.message); return; }
      const r = {};
      (data || []).forEach((row) => {
        r[row.outlet_id + "|" + row.item_name] = Number(row.qty) || 0;
      });
      setRows(r);
      const { data: recent, error: e2 } = await supabase
        .from("stores_closing_stock")
        .select("stock_date,outlet_id")
        .in("outlet_id", ids)
        .order("stock_date", { ascending: false })
        .limit(500);
      if (!alive) return;
      if (!e2) {
        const m = {};
        (recent || []).forEach((row) => {
          if (m[row.outlet_id] == null || row.stock_date > m[row.outlet_id]) m[row.outlet_id] = row.stock_date;
        });
        setLast(m);
      }
    })();
    return () => {
      alive = false;
    };
  }, [date, stores]);

  const setQty = (key, v) => setRows((r) => ({ ...r, [key]: Math.max(0, Number(v) || 0) }));

  // upsert every store × item for the picked date (blank = 0 — recorded on purpose);
  // conflict target = the table's unique (stock_date, outlet_id, item_name)
  const save = async () => {
    if (!date || !stores) return;
    setSaving(true);
    setMsg(null);
    const payload = stores.flatMap((s) =>
      ITEMS.map((item) => ({
        stock_date: date,
        outlet_id: s.id,
        item_name: item,
        qty: Number(rows[s.id + "|" + item]) || 0,
      }))
    );
    const { error } = await supabase
      .from("stores_closing_stock")
      .upsert(payload, { onConflict: "stock_date,outlet_id,item_name" });
    if (error) {
      setMsg({ ok: false, text: "Save failed — " + error.message });
    } else {
      setMsg({ ok: true, text: `Saved ${stores.length * ITEMS.length} rows for ${date}.` });
      setLast((m) => {
        const n = { ...m };
        stores.forEach((s) => {
          if (n[s.id] == null || date > n[s.id]) n[s.id] = date;
        });
        return n;
      });
    }
    setSaving(false);
  };

  return (
    <div className="full-bleed min-h-screen bg-slate-50 pt-14 pb-20 text-base text-slate-900 md:pt-0">
      <div className="mx-auto max-w-[900px] px-3 sm:px-5">
        <header className="flex flex-wrap items-center justify-between gap-3 py-4">
          <h1 className="text-lg font-semibold tracking-tight">Outlet closing stock</h1>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={date || ""}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              aria-label="Stock date"
              className="cursor-pointer rounded-full border border-slate-200 bg-white px-3 py-1.5 dark:border-slate-700 dark:bg-slate-900"
            />
            <button
              onClick={save}
              disabled={saving || !date || !stores}
              className="cursor-pointer rounded-full bg-slate-900 px-4 py-1.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </header>

        <div className={`${card}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={title}>{date ? date : "…"}</span>
            <span className={mute}>
              End-of-day stock per store. The planner uses the newest entry at or before its dispatch date — re-saving a day overwrites it.
            </span>
          </div>
          {stores && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {stores.map((s) => (
                <Badge key={s.id} t={last[s.id] == null ? "amber" : last[s.id] === date ? "green" : "amber"}>
                  {s.name}: {last[s.id] == null ? "no entries yet" : `last ${last[s.id]}`}
                </Badge>
              ))}
            </div>
          )}
          {stores && stores.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className={mute}>Send each store its own page:</span>
              {stores.map((s) => (
                <Link
                  key={s.id}
                  href={`/shipment-planning/closing-stock/${slugify(s.name)}`}
                  className="cursor-pointer rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-medium hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
                >
                  {s.name} →
                </Link>
              ))}
            </div>
          )}
          {msg && (
            <div className={`mt-2 text-sm font-medium ${msg.ok ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
              {msg.text}
            </div>
          )}
          {err && (
            <div className={`${mute} mt-2`}>
              couldn&apos;t read stores_closing_stock: {err} — run supabase_migration_planner_v8.sql in Supabase, then reload.
            </div>
          )}

          {stores == null ? (
            <div className={`${mute} mt-3`}>Loading stores…</div>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className={th}>Item</th>
                    {stores.map((s) => <th key={s.id} className={`${th} whitespace-nowrap`}>{s.name}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {ITEMS.map((item) => (
                    <tr key={item} className={row}>
                      <td className={`${td} whitespace-nowrap font-medium`}>{item}</td>
                      {stores.map((s) => (
                        <td key={s.id} className={td}>
                          <input
                            type="number"
                            inputMode="numeric"
                            min="0"
                            step="1"
                            aria-label={`${item} — ${s.name}`}
                            value={rows[s.id + "|" + item] ?? ""}
                            onChange={(e) => setQty(s.id + "|" + item, e.target.value)}
                            className={cell}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr className={row}>
                    <td className={`${td} font-medium`}>Total</td>
                    {stores.map((s) => (
                      <td key={s.id} className={`${td} tabular-nums font-semibold`}>
                        {ITEMS.reduce((a, item) => a + (Number(rows[s.id + "|" + item]) || 0), 0)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
