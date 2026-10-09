"use client";
import { useState } from "react";
import { updatePoc } from "./actions";

export default function OutletsView({ outlets }) {
  const [city, setCity] = useState("All");
  const [editingId, setEditingId] = useState(null);
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const cities = ["All", ...new Set(outlets.map((o) => o.city).filter(Boolean))];
  const list = outlets.filter((o) => city === "All" || o.city === city);

  const startEdit = (o) => {
    setEditingId(o.id);
    setName(o.poc_name || "");
    setContact(o.poc_contact || "");
    setError("");
  };

  const save = async (id) => {
    setSaving(true);
    setError("");
    const res = await updatePoc(id, name, contact);
    setSaving(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setEditingId(null);
  };

  return (
    <>
      {/* City filter */}
      <div className="mt-4 flex flex-wrap gap-2">
        {cities.map((c) => (
          <button
            key={c}
            onClick={() => setCity(c)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              city === c
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-slate-300 bg-white text-slate-500"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      <p className="mt-3 text-xs text-slate-400">{list.length} outlets</p>

      <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((o) => (
          <div
            key={o.id}
            className="flex flex-col rounded-xl border border-slate-200 bg-white p-4"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold">{o.name}</p>
                <p className="text-xs text-slate-400">{o.city}</p>
              </div>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                {o.outlet_type}
              </span>
            </div>

            {/* POC section */}
            <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
              {editingId === o.id ? (
                <div className="space-y-2">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="POC name"
                    className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
                  />
                  <input
                    value={contact}
                    onChange={(e) => setContact(e.target.value)}
                    placeholder="POC contact"
                    className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
                  />
                  {error && <p className="text-xs text-red-600">{error}</p>}
                  <div className="flex gap-2">
                    <button
                      onClick={() => save(o.id)}
                      disabled={saving}
                      className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                    >
                      {saving ? "Saving..." : "Save"}
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="rounded border border-slate-300 px-3 py-1 text-xs text-slate-600"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs text-slate-400">POC</p>
                    <p className="font-medium">{o.poc_name || "-"}</p>
                    <p className="text-slate-600">{o.poc_contact || "-"}</p>
                  </div>
                  <button
                    onClick={() => startEdit(o)}
                    className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 hover:border-blue-500 hover:text-blue-600"
                  >
                    Edit
                  </button>
                </div>
              )}
            </div>

            <p className="mt-3 text-xs text-slate-500">{o.address || "No address"}</p>

            <div className="mt-3 flex items-center justify-between pt-1 text-xs">
              <span className="text-slate-500">
                Fridge: <b>{o.fridge_capacity ?? "-"}</b>
              </span>
              {o.google_maps_link && (
                <a
                  href={o.google_maps_link}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-blue-600 hover:underline"
                >
                  Open in Maps
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}