"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseBrowser";

const STORES = ["Matunga", "Bandra", "Kandivali"];
const k = (o, s) => `${o}:${s}`;
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function badge(req, sent) {
  if (req <= 0) return ["Not set", "bg-slate-100 text-slate-500"];
  if (sent >= req) return ["Complete", "bg-emerald-100 text-emerald-700"];
  if (sent > 0) return ["Partial", "bg-amber-100 text-amber-700"];
  return ["Pending", "bg-rose-100 text-rose-700"];
}

export default function RequirementsPage() {
  const [stores, setStores] = useState([]);
  const [supplies, setSupplies] = useState([]);
  const [reqs, setReqs] = useState({});
  const [sent, setSent] = useState({});
  const [drafts, setDrafts] = useState({});
  const [activeId, setActiveId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      const d = new Date();
      const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
      const [o, s, r, l] = await Promise.all([
        supabase
          .from("outlets")
          .select("id,name,poc_name,poc_contact")
          .in("name", STORES)
          .eq("outlet_type", "store"),
        supabase.from("supplies").select("id,product_title,base_unit").order("id"),
        supabase.from("outlet_requirements").select("outlet_id,supply_id,monthly_qty"),
        supabase
          .from("supplies_dispatch_log")
          .select("outlet_id,supply_id,qty")
          .gte("dispatched_at", monthStart),
      ]);
      const err = o.error || s.error || r.error || l.error;
      if (err) return setMsg(err.message);

      const ordered = STORES.map((x) => o.data.find((st) => st.name === x)).filter(Boolean);
      setStores(ordered);
      setActiveId(ordered[0]?.id || null);
      setSupplies(s.data);
      const rm = {};
      r.data.forEach((x) => (rm[k(x.outlet_id, x.supply_id)] = n(x.monthly_qty)));
      setReqs(rm);
      const sm = {};
      l.data.forEach((x) => {
        const key = k(x.outlet_id, x.supply_id);
        sm[key] = (sm[key] || 0) + n(x.qty);
      });
      setSent(sm);
    })();
  }, []);

  const active = stores.find((s) => s.id === activeId);
  const dirty = active
    ? supplies.filter((su) => {
        const key = k(active.id, su.id);
        return key in drafts && n(drafts[key]) !== n(reqs[key]);
      })
    : [];

  const save = async () => {
    setSaving(true);
    setMsg("");
    const rows = dirty.map((su) => ({
      outlet_id: active.id,
      supply_id: su.id,
      monthly_qty: Math.max(0, n(drafts[k(active.id, su.id)])),
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase
      .from("outlet_requirements")
      .upsert(rows, { onConflict: "outlet_id,supply_id" });
    if (error) {
      setMsg(error.message);
    } else {
      setReqs((p) => {
        const x = { ...p };
        rows.forEach((r) => (x[k(r.outlet_id, r.supply_id)] = r.monthly_qty));
        return x;
      });
      setDrafts((p) => {
        const x = { ...p };
        rows.forEach((r) => delete x[k(r.outlet_id, r.supply_id)]);
        return x;
      });
      setMsg(`Saved ${rows.length} change(s) for ${active.name}`);
    }
    setSaving(false);
  };

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold">Monthly requirements</h1>
      <p className="mb-6 text-sm text-slate-500">
        Planned consumables per store, with this month's dispatch progress
      </p>

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        {stores.map((s) => {
          const planned = supplies.filter((su) => n(reqs[k(s.id, su.id)]) > 0);
          const pct = planned.length
            ? Math.round(
                (planned.reduce(
                  (a, su) => a + Math.min(n(sent[k(s.id, su.id)]) / n(reqs[k(s.id, su.id)]), 1),
                  0
                ) /
                  planned.length) *
                  100
              )
            : 0;
          return (
            <button
              key={s.id}
              onClick={() => {
                setActiveId(s.id);
                setMsg("");
              }}
              className={`rounded-xl border bg-white p-4 text-left ${
                s.id === activeId ? "border-slate-900 ring-1 ring-slate-900" : "border-slate-200"
              }`}
            >
              <div className="flex justify-between">
                <span className="font-semibold">{s.name}</span>
                <span className="text-xs text-slate-500">{pct}% sent</span>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-2 text-xs text-slate-500">
                {planned.length} of {supplies.length} items planned
              </div>
            </button>
          );
        })}
      </div>

      {msg && <div className="mb-4 rounded-lg bg-slate-100 px-4 py-2 text-sm">{msg}</div>}

      {active && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <div>
              <h2 className="font-semibold">{active.name}</h2>
              <p className="text-xs text-slate-500">
                POC: {active.poc_name || "—"} · {active.poc_contact || "—"}
              </p>
            </div>
            <button
              onClick={save}
              disabled={saving || dirty.length === 0}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              {saving ? "Saving…" : dirty.length ? `Save ${dirty.length} change(s)` : "Saved"}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  <th className="px-5 py-3">Product</th>
                  <th className="px-3 py-3">Unit</th>
                  <th className="px-3 py-3 text-right">Monthly qty</th>
                  <th className="px-3 py-3 text-right">Sent this month</th>
                  <th className="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {supplies.map((su) => {
                  const key = k(active.id, su.id);
                  const [label, cls] = badge(n(reqs[key]), n(sent[key]));
                  return (
                    <tr key={su.id}>
                      <td className="px-5 py-3 font-medium">{su.product_title}</td>
                      <td className="px-3 py-3 text-slate-500">{su.base_unit}</td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={key in drafts ? drafts[key] : String(reqs[key] ?? 0)}
                          onChange={(e) => setDrafts((p) => ({ ...p, [key]: e.target.value }))}
                          className="w-24 rounded-lg border border-slate-200 px-2 py-1.5 text-right"
                        />
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{n(sent[key])}</td>
                      <td className="px-5 py-3">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${cls}`}>
                          {label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}