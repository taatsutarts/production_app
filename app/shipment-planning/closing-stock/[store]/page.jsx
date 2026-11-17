"use client";

/* Closing stock for ONE store (/shipment-planning/closing-stock/<store>).
 *
 * The link is sent to each store's team (e.g. /shipment-planning/closing-stock/
 * matunga) — they pick the closing date and enter their end-of-day stock. Every
 * save upserts that store's rows for the picked date in `stores_closing_stock`
 * (supabase_migration_planner_v8.sql); re-saving a day overwrites it. The
 * shipment planner reads the newest entry at or before its dispatch date from
 * that table — nothing hardcoded.
 *
 * The store is matched from the outlets table by URL slug ("Matunga" ->
 * "matunga"), so a renamed/added store works without a code change as long as
 * its row is outlet_type = "store" and active.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ITEMS, slugify, today, yesterday, fetchActiveStores,
  card, title, mute, th, td, row, cell, Badge,
} from "../shared";
import { supabase } from "@/lib/supabaseBrowser";

export default function StoreClosingStockPage() {
  const params = useParams();
  const slug = (params?.store || "").toString().toLowerCase();

  const [date, setDate] = useState(null); // set on the client (avoids a server mismatch)
  const [store, setStore] = useState(undefined); // undefined = loading, null = no match
  const [stores, setStores] = useState(null); // all active stores (for the not-found card)
  const [rows, setRows] = useState({}); // item -> qty for the picked date
  const [last, setLast] = useState(null); // newest stock_date entered so far
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null); // { ok, text }

  useEffect(() => setDate(today()), []);

  // the store row behind this URL's slug (matched against the outlets table)
  useEffect(() => {
    let alive = true;
    fetchActiveStores().then(({ data, error }) => {
      if (!alive) return;
      if (error) { setErr(error.message); setStore(null); return; }
      const list = data || [];
      setStores(list);
      setStore(list.find((s) => slugify(s.name).toLowerCase() === slug) || null);
    });
    return () => {
      alive = false;
    };
  }, [slug]);

  // load the picked date's entries (prefill) + this store's newest entry date.
  // Missing migration / RLS problem -> shown as a clear error.
  useEffect(() => {
    if (!date || !store) return;
    let alive = true;
    setErr(null);
    setMsg(null);
    (async () => {
      const { data, error } = await supabase
        .from("stores_closing_stock")
        .select("stock_date,item_name,qty")
        .eq("outlet_id", store.id)
        .eq("stock_date", date);
      if (!alive) return;
      if (error) { setErr(error.message); return; }
      const r = {};
      (data || []).forEach((row2) => {
        r[row2.item_name] = Number(row2.qty) || 0;
      });
      setRows(r);
      const { data: lastRow, error: e2 } = await supabase
        .from("stores_closing_stock")
        .select("stock_date")
        .eq("outlet_id", store.id)
        .order("stock_date", { ascending: false })
        .limit(1);
      if (!alive) return;
      if (!e2) setLast(lastRow?.[0]?.stock_date ?? null);
    })();
    return () => {
      alive = false;
    };
  }, [date, store]);

  const setQty = (item, v) => setRows((r) => ({ ...r, [item]: Math.max(0, Number(v) || 0) }));

  // upsert this store's rows for the picked date (blank = 0, recorded on purpose);
  // conflict target = the table's unique (stock_date, outlet_id, item_name)
  const save = async () => {
    if (!date || !store) return;
    setSaving(true);
    setMsg(null);
    const payload = ITEMS.map((item) => ({
      stock_date: date,
      outlet_id: store.id,
      item_name: item,
      qty: Number(rows[item]) || 0,
    }));
    const { error } = await supabase
      .from("stores_closing_stock")
      .upsert(payload, { onConflict: "stock_date,outlet_id,item_name" });
    if (error) {
      setMsg({ ok: false, text: "Save failed — " + error.message });
    } else {
      setMsg({ ok: true, text: `Saved ${ITEMS.length} items for ${date}.` });
      if (last == null || date > last) setLast(date);
    }
    setSaving(false);
  };

  const total = useMemo(() => ITEMS.reduce((a, item) => a + (Number(rows[item]) || 0), 0), [rows]);

  // the date presets the store team actually needs
  const presets = [
    ["Today", today()],
    ["Yesterday", yesterday()],
  ];

  return (
    <div className="full-bleed min-h-screen bg-slate-50 pt-14 pb-20 text-base text-slate-900 md:pt-0">
      <div className="mx-auto max-w-[560px] px-3 sm:px-5">
        <header className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">
              {store == null ? "Closing stock" : `${store.name} — closing stock`}
            </h1>
            <div className={`${mute}`}>
              End-of-day stock for your store. The kitchen&apos;s planner uses the newest entry at or before its dispatch date — re-saving a day overwrites it.
            </div>
          </div>
        </header>

        {store === undefined ? (
          <div className={`${card} text-center font-medium text-slate-500`}>Loading store…</div>
        ) : store == null ? (
          <div className={card}>
            <div className="font-semibold text-rose-600">Store not found</div>
            <div className={`${mute} mt-1`}>
              No active store in the outlets table matches this link&apos;s address.
              {stores && stores.length > 0 && (
                <div className="mt-2">
                  The store pages are:
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {stores.map((s) => (
                      <Link
                        key={s.id}
                        href={`/shipment-planning/closing-stock/${slugify(s.name)}`}
                        className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-medium hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
                      >
                        {s.name}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className={card}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  value={date || ""}
                  onChange={(e) => e.target.value && setDate(e.target.value)}
                  aria-label="Closing date"
                  className="cursor-pointer rounded-full border border-slate-200 bg-white px-3 py-1.5 dark:border-slate-700 dark:bg-slate-900"
                />
                {presets.map(([label, value]) => (
                  <button
                    key={label}
                    onClick={() => setDate(value)}
                    className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm font-medium ${
                      date === value
                        ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900"
                        : "border-slate-200 bg-white hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <Badge t={last == null ? "amber" : last === date ? "green" : "amber"}>
                {last == null ? "no entries yet" : `last ${last}`}
              </Badge>
            </div>
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

            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className={th}>Item</th>
                    <th className={`${th} text-right`}>Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {ITEMS.map((item) => (
                    <tr key={item} className={row}>
                      <td className={`${td} whitespace-nowrap font-medium`}>{item}</td>
                      <td className={td}>
                        <input
                          type="number"
                          inputMode="numeric"
                          min="0"
                          step="1"
                          aria-label={`${item} — ${store.name}`}
                          value={rows[item] ?? ""}
                          onChange={(e) => setQty(item, e.target.value)}
                          className={cell}
                        />
                      </td>
                    </tr>
                  ))}
                  <tr className={row}>
                    <td className={`${td} font-medium`}>Total</td>
                    <td className={`${td} text-right tabular-nums font-semibold`}>{total}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex justify-end">
              <button
                onClick={save}
                disabled={saving || !date}
                className="cursor-pointer rounded-full bg-slate-900 px-4 py-1.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
