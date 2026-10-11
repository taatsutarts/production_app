"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseBrowser";
import { generateChallanPdf } from "../../lib/challan";

const STORES = ["Matunga", "Bandra", "Kandivali"];
const k = (o, s) => `${o}:${s}`;
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const p2 = (x) => String(x).padStart(2, "0");
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
};

export default function DispatchPage() {
  const [stores, setStores] = useState([]);
  const [supplies, setSupplies] = useState([]);
  const [reqs, setReqs] = useState({});
  const [sent, setSent] = useState({});
  const [outletId, setOutletId] = useState("");
  const [date, setDate] = useState("");
  const [qtys, setQtys] = useState({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const loadSent = async () => {
    const d = new Date();
    const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
    const { data } = await supabase
      .from("dispatch_log")
      .select("outlet_id,supply_id,qty")
      .gte("dispatched_at", monthStart);
    const sm = {};
    (data || []).forEach((x) => {
      const key = k(x.outlet_id, x.supply_id);
      sm[key] = (sm[key] || 0) + n(x.qty);
    });
    setSent(sm);
  };

  useEffect(() => {
    setDate(todayStr());
    (async () => {
      const [o, s, r] = await Promise.all([
        supabase
          .from("outlets")
          .select("id,name,address,poc_name,poc_contact")
          .in("name", STORES)
          .eq("outlet_type", "store"),
        supabase.from("supplies").select("id,product_title,base_unit").order("id"),
        supabase.from("outlet_requirements").select("outlet_id,supply_id,monthly_qty"),
      ]);
      const err = o.error || s.error || r.error;
      if (err) return setMsg(err.message);
      setStores(STORES.map((x) => o.data.find((st) => st.name === x)).filter(Boolean));
      setSupplies(s.data);
      const rm = {};
      r.data.forEach((x) => (rm[k(x.outlet_id, x.supply_id)] = n(x.monthly_qty)));
      setReqs(rm);
      loadSent();
    })();
  }, []);

  const store = stores.find((s) => s.id === outletId);
  const lines = useMemo(
    () =>
      supplies
        .filter((su) => n(qtys[su.id]) > 0)
        .map((su) => ({
          supply_id: su.id,
          product_title: su.product_title,
          base_unit: su.base_unit,
          qty: n(qtys[su.id]),
        })),
    [supplies, qtys]
  );

  const fillRemaining = () => {
    const next = {};
    supplies.forEach((su) => {
      const rem = n(reqs[k(store.id, su.id)]) - n(sent[k(store.id, su.id)]);
      if (rem > 0) next[su.id] = String(rem);
    });
    setQtys(next);
  };

  const generate = async () => {
    setBusy(true);
    setMsg("");
    try {
      const now = new Date();
      const code = store.name.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase();
      const challanNo = `CH-${date.replace(/-/g, "")}-${code}-${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}`;
      const at = date === todayStr() ? now.toISOString() : new Date(`${date}T12:00:00`).toISOString();

      // log first so a PDF never goes out without a record
      const { error } = await supabase.from("dispatch_log").insert(
        lines.map((l) => ({
          challan_no: challanNo,
          outlet_id: store.id,
          supply_id: l.supply_id,
          qty: l.qty,
          dispatched_at: at,
        }))
      );
      if (error) throw error;

      generateChallanPdf({ store, items: lines, dateInput: date, challanNo });
      setMsg(`Challan ${challanNo} logged and downloaded.`);
      setQtys({});
      loadSent();
    } catch (e) {
      setMsg(e.message || "Could not generate challan");
    }
    setBusy(false);
  };

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold">Dispatch</h1>
      <p className="mb-6 text-sm text-slate-500">
        Pick a store, enter quantities and generate the challan PDF
      </p>

      {msg && <div className="mb-4 rounded-lg bg-slate-100 px-4 py-2 text-sm">{msg}</div>}

      <div className="mb-6 grid gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium uppercase text-slate-500">Outlet</span>
          <select
            value={outletId}
            onChange={(e) => {
              setOutletId(e.target.value);
              setQtys({});
              setMsg("");
            }}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2"
          >
            <option value="">Select outlet…</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium uppercase text-slate-500">
            Delivery date
          </span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2"
          />
        </label>
        {store && <div className="text-sm text-slate-600 sm:col-span-2">{store.address}</div>}
      </div>

      {store && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <h2 className="font-semibold">Items for {store.name}</h2>
            <div className="flex gap-2 text-sm">
              <button
                onClick={fillRemaining}
                className="rounded-lg px-3 py-2 text-slate-600 hover:bg-slate-100"
              >
                Fill remaining
              </button>
              <button
                onClick={() => setQtys({})}
                className="rounded-lg px-3 py-2 text-slate-600 hover:bg-slate-100"
              >
                Clear
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  <th className="px-5 py-3">Product</th>
                  <th className="px-3 py-3">Unit</th>
                  <th className="px-3 py-3 text-right">Monthly</th>
                  <th className="px-3 py-3 text-right">Sent</th>
                  <th className="px-3 py-3 text-right">Remaining</th>
                  <th className="px-5 py-3 text-right">Dispatch qty</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {supplies.map((su) => {
                  const key = k(store.id, su.id);
                  const req = n(reqs[key]);
                  const rem = Math.max(req - n(sent[key]), 0);
                  const over = req > 0 && n(qtys[su.id]) > rem;
                  return (
                    <tr key={su.id}>
                      <td className="px-5 py-3 font-medium">{su.product_title}</td>
                      <td className="px-3 py-3 text-slate-500">{su.base_unit}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{req}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{n(sent[key])}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{rem}</td>
                      <td className="px-5 py-2 text-right">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          placeholder="0"
                          value={qtys[su.id] ?? ""}
                          onChange={(e) => setQtys((p) => ({ ...p, [su.id]: e.target.value }))}
                          className={`w-24 rounded-lg border px-2 py-1.5 text-right ${
                            over ? "border-amber-400 bg-amber-50" : "border-slate-200"
                          }`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t px-5 py-4">
            <span className="text-sm text-slate-500">{lines.length} item(s) on this challan</span>
            <button
              onClick={generate}
              disabled={busy || lines.length === 0}
              className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-40"
            >
              {busy ? "Generating…" : "Generate challan"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}