"use client";
// Items — full CRUD manager for the production master items table (the sidebar's
// /items route). Search, category chips, Active/Inactive filter, Add/Edit modal,
// Deactivate/Restore (soft delete — production, spoilages and aliases reference
// items, history must keep pointing at a real row). Data via /api/items.
import { useEffect, useMemo, useState } from "react";

const btnPrimary =
  "inline-flex cursor-pointer items-center gap-2 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50";
const btnGhost =
  "inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50";
const btnIcon =
  "inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40";
const inp =
  "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20";

const ICONS = {
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
  pencil: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z" />
    </>
  ),
  power: (
    <>
      <path d="M12 3v9" />
      <path d="M6.3 6.5a8 8 0 1 0 11.4 0" />
    </>
  ),
  restore: (
    <>
      <path d="M3 12a9 9 0 1 0 2.6-6.4" />
      <path d="M3 4v5h5" />
    </>
  ),
  x: <path d="M18 6 6 18M6 6l12 12" />,
};

function Icon({ d, className = "h-4 w-4" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {d}
    </svg>
  );
}

const EMPTY_FORM = { item_name: "", category: "", batch_size: "" };

export default function ItemsPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pageErr, setPageErr] = useState("");

  const [q, setQ] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all"); // all | Active | Inactive

  const [toast, setToast] = useState(null);
  const [modal, setModal] = useState({ open: false, item: null, form: EMPTY_FORM, err: "", saving: false });

  function say(text, kind = "ok") {
    setToast({ text, kind });
    window.clearTimeout(say._t);
    say._t = window.setTimeout(() => setToast(null), 3500);
  }

  function load() {
    setLoading(true);
    setPageErr("");
    fetch("/api/items")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setPageErr(d.error);
        else setItems(d.items || []);
      })
      .catch(() => setPageErr("Could not load the items."))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  const categories = useMemo(() => {
    const map = new Map(); // category name -> count ("" = uncategorized)
    for (const it of items) {
      const c = it.category || "";
      map.set(c, (map.get(c) || 0) + 1);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [items]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return items.filter((it) => {
      if (t && !`${it.item_name} ${it.category || ""}`.toLowerCase().includes(t)) return false;
      if (catFilter === "__none__" && it.category) return false;
      if (catFilter !== "all" && catFilter !== "__none__" && (it.category || "") !== catFilter) return false;
      const active = it.is_active !== false;
      if (statusFilter === "Active" && !active) return false;
      if (statusFilter === "Inactive" && active) return false;
      return true;
    });
  }, [items, q, catFilter, statusFilter]);

  const counts = useMemo(() => {
    const c = { total: items.length, active: 0, inactive: 0 };
    for (const it of items) (it.is_active === false ? c.inactive++ : c.active++);
    return c;
  }, [items]);

  /* ---------- row actions ---------- */

  async function toggleActive(item) {
    const goingInactive = item.is_active !== false;
    setItems((arr) => arr.map((r) => (r.id === item.id ? { ...r, is_active: !goingInactive } : r)));
    try {
      const res = goingInactive
        ? await fetch(`/api/items?id=${item.id}`, { method: "DELETE" })
        : await fetch("/api/items", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: item.id, is_active: true }),
          });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Save failed.");
      say(
        goingInactive
          ? `"${item.item_name}" deactivated — restore anytime from the Inactive filter.`
          : `"${item.item_name}" restored.`
      );
    } catch (e) {
      setItems((arr) => arr.map((r) => (r.id === item.id ? { ...r, is_active: goingInactive } : r)));
      say(String(e.message || e), "err");
    }
  }

  /* ---------- add / edit modal ---------- */

  function openAdd() {
    setModal({ open: true, item: null, form: { ...EMPTY_FORM }, err: "", saving: false });
  }

  function openEdit(item) {
    setModal({
      open: true,
      item,
      err: "",
      saving: false,
      form: {
        item_name: item.item_name || "",
        category: item.category || "",
        batch_size: item.batch_size ?? "",
      },
    });
  }

  function setForm(key, value) {
    setModal((m) => ({ ...m, form: { ...m.form, [key]: value } }));
  }

  async function save() {
    setModal((m) => ({ ...m, saving: true, err: "" }));
    const f = modal.form;
    const body = { item_name: f.item_name, category: f.category, batch_size: f.batch_size };
    try {
      const res = await fetch("/api/items", {
        method: modal.item ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(modal.item ? { ...body, id: modal.item.id } : body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setModal((m) => ({ ...m, saving: false, err: data.message || data.error || "Save failed." }));
        return;
      }
      const saved = data.item;
      setItems((arr) => (modal.item ? arr.map((r) => (r.id === saved.id ? saved : r)) : [saved, ...arr]));
      setModal({ open: false, item: null, form: EMPTY_FORM, err: "", saving: false });
      say(modal.item ? `"${saved.item_name}" updated.` : `"${saved.item_name}" added to the master list.`);
    } catch (e) {
      setModal((m) => ({ ...m, saving: false, err: String(e.message || e) }));
    }
  }

  const chip = (value, label, count) => (
    <button
      key={value}
      data-test={value === "all" ? "it_chip_all" : `it_chip_${value}`}
      onClick={() => setCatFilter(value)}
      className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
        catFilter === value
          ? "border-blue-600 bg-blue-600 text-white"
          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
      }`}
    >
      {label}
      <span className={`ml-1.5 text-xs ${catFilter === value ? "text-blue-100" : "text-slate-400"}`}>
        {count}
      </span>
    </button>
  );

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Items</h1>
          <p className="text-sm text-slate-500">
            Production master items — what we produce, spoil and plan shipments for.
          </p>
        </div>
        <button className={btnPrimary} data-test="it_add" onClick={openAdd}>
          <Icon d={ICONS.plus} />
          Add item
        </button>
      </div>

      {pageErr && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          ⚠️ {pageErr}
        </div>
      )}

      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
            <Icon d={ICONS.search} />
          </span>
          <input
            data-test="it_search"
            className="w-72 rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            placeholder="Search items…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        {chip("all", "All", counts.total)}
        {categories.map(([c, n]) =>
          chip(c || "__none__", c || "Uncategorized", n)
        )}
        <select
          data-test="it_status"
          className="w-36 cursor-pointer rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-700"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all">All statuses ({counts.total})</option>
          <option value="Active">Active ({counts.active})</option>
          <option value="Inactive">Inactive ({counts.inactive})</option>
        </select>
      </div>

      {/* table */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/80 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3">Item</th>
              <th className="w-40 px-3 py-3">Category</th>
              <th className="w-24 px-3 py-3">Batch size</th>
              <th className="w-36 px-3 py-3">Used in</th>
              <th className="w-28 px-3 py-3">Status</th>
              <th className="w-24 px-3 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((it) => {
              const inactive = it.is_active === false;
              return (
                <tr key={it.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70">
                  <td className="px-4 py-2.5">
                    <div className={`text-[15px] font-medium ${inactive ? "text-slate-400 line-through" : "text-slate-900"}`}>
                      {it.item_name}
                    </div>
                    <div className="text-xs text-slate-400">#{it.id}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    {it.category ? (
                      <span className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">
                        {it.category}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-slate-600">{it.batch_size ?? "—"}</td>
                  <td className="px-3 py-2.5 text-slate-600">
                    <span className="text-xs">
                      {it.production_count || 0} production · {it.spoilage_count || 0} spoilage
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${
                        inactive
                          ? "border-slate-200 bg-slate-100 text-slate-500"
                          : "border-emerald-200 bg-emerald-50 text-emerald-700"
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${inactive ? "bg-slate-400" : "bg-emerald-500"}`} />
                      {inactive ? "Inactive" : "Active"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        data-test={`it_edit_${it.id}`}
                        title="Edit"
                        className={btnIcon}
                        onClick={() => openEdit(it)}
                      >
                        <Icon d={ICONS.pencil} />
                      </button>
                      <button
                        data-test={inactive ? `it_on_${it.id}` : `it_off_${it.id}`}
                        title={inactive ? "Restore" : "Deactivate"}
                        className={btnIcon}
                        onClick={() => toggleActive(it)}
                      >
                        <Icon d={inactive ? ICONS.restore : ICONS.power} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-400">
                  No items match the current search / filters.
                </td>
              </tr>
            )}
            {loading && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-400">
                  Loading items…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* modal */}
      {modal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">
                {modal.item ? "Edit item" : "Add item"}
              </h2>
              <button className={btnIcon} onClick={() => setModal({ ...modal, open: false })}>
                <Icon d={ICONS.x} />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="col-span-2 block text-sm font-medium text-slate-700">
                Item name
                <input
                  data-test="it_name"
                  className={inp}
                  value={modal.form.item_name}
                  onChange={(e) => setForm("item_name", e.target.value)}
                  placeholder="e.g. BLUEBERRY CHEESE TART"
                  autoFocus
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Category
                <input
                  data-test="it_category"
                  className={inp}
                  list="it-cats"
                  value={modal.form.category}
                  onChange={(e) => setForm("category", e.target.value)}
                  placeholder="e.g. TARTS"
                />
                <datalist id="it-cats">
                  {categories.filter(([c]) => c).map(([c]) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Batch size
                <input
                  data-test="it_batch"
                  type="number"
                  step="any"
                  className={inp}
                  value={modal.form.batch_size}
                  onChange={(e) => setForm("batch_size", e.target.value)}
                  placeholder="e.g. 1"
                />
              </label>
            </div>

            {modal.err && (
              <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-sm text-rose-700">
                {modal.err}
              </div>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button className={btnGhost} onClick={() => setModal({ ...modal, open: false })}>
                Cancel
              </button>
              <button
                data-test="it_save"
                className={btnPrimary}
                disabled={modal.saving || !modal.form.item_name.trim()}
                onClick={save}
              >
                {modal.saving ? "Saving…" : modal.item ? "Save changes" : "Add item"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* toast */}
      {toast && (
        <div
          className={`fixed bottom-4 right-4 z-50 max-w-sm rounded-xl border px-4 py-3 text-sm shadow-lg ${
            toast.kind === "err"
              ? "border-rose-200 bg-rose-50 text-rose-700"
              : "border-emerald-200 bg-emerald-50 text-emerald-700"
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}
