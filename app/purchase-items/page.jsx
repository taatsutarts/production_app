"use client";
// Purchase Items — full CRUD manager for the purchase_items master table.
// Search + brand/status filters, Add/Edit modal, instant brand reclassify per row
// (the old "Item brands" page lives on as the inline dropdown), Deactivate/Restore
// (soft delete — bills, mappings and POs keep pointing at a real row).
import { useEffect, useMemo, useState } from "react";

const BRAND_TYPES = ["Gourmaison", "Taatsu", "Both"];
const CATEGORIES = ["Garnishing", "Packaging", "Beverages", "Dairy", "General", "Other"];
const UNITS = ["kg", "gm", "l", "ml", "pcs", "box", "pack", "bottle", "can", "bag", "tray"];
const PAGE_SIZE = 25;

const btnPrimary =
  "inline-flex cursor-pointer items-center gap-2 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50";
const btnGhost =
  "inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50";
const btnIcon =
  "inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40";
const inp =
  "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20";

const BRAND_CHIP = {
  Gourmaison: "border-amber-200 bg-amber-50 text-amber-700",
  Taatsu: "border-indigo-200 bg-indigo-50 text-indigo-700",
  Both: "border-emerald-200 bg-emerald-50 text-emerald-700",
};
const BRAND_DOT = {
  Gourmaison: "bg-amber-400",
  Taatsu: "bg-indigo-400",
  Both: "bg-emerald-400",
};

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

const EMPTY_FORM = {
  item_name: "",
  category: "",
  uom: "",
  uom_size: "",
  purchase_rate: "",
  tax_rate: "",
  brand_type: "",
  status: "Active",
};

export default function PurchaseItemsPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pageErr, setPageErr] = useState("");

  const [q, setQ] = useState("");
  const [brandFilter, setBrandFilter] = useState("all"); // all | none | Gourmaison | Taatsu | Both
  const [statusFilter, setStatusFilter] = useState("Active"); // all | Active | Inactive
  const [page, setPage] = useState(0);

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
    fetch("/api/purchase-items")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setPageErr(d.error);
        else setItems(d.items || []);
      })
      .catch(() => setPageErr("Could not load the items."))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return items.filter((it) => {
      if (t && !(`${it.item_name} ${it.category || ""}`.toLowerCase().includes(t))) return false;
      if (brandFilter === "none" && it.brand_type) return false;
      if (brandFilter !== "all" && brandFilter !== "none" && it.brand_type !== brandFilter) return false;
      if (statusFilter !== "all" && (it.status || "Active") !== statusFilter) return false;
      return true;
    });
  }, [items, q, brandFilter, statusFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const paged = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const counts = useMemo(() => {
    const c = { total: items.length, none: 0, Gourmaison: 0, Taatsu: 0, Both: 0, active: 0, inactive: 0 };
    for (const it of items) {
      if (it.brand_type) c[it.brand_type] = (c[it.brand_type] || 0) + 1;
      else c.none += 1;
      if ((it.status || "Active") === "Inactive") c.inactive += 1;
      else c.active += 1;
    }
    return c;
  }, [items]);

  function resetPage() {
    setPage(0);
  }

  /* ---------- row actions ---------- */

  async function setBrand(item, value) {
    const brandType = value || null;
    setItems((arr) => arr.map((r) => (r.id === item.id ? { ...r, brand_type: brandType } : r)));
    try {
      const res = await fetch("/api/purchase-items", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, brand_type: brandType }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Save failed.");
      say(`Brand saved: "${item.item_name}" → ${brandType || "none"}.`);
    } catch (e) {
      setItems((arr) => arr.map((r) => (r.id === item.id ? { ...r, brand_type: item.brand_type } : r)));
      say(String(e.message || e), "err");
    }
  }

  async function toggleActive(item) {
    const goingInactive = (item.status || "Active") !== "Inactive";
    setItems((arr) =>
      arr.map((r) => (r.id === item.id ? { ...r, status: goingInactive ? "Inactive" : "Active" } : r))
    );
    try {
      const res = goingInactive
        ? await fetch(`/api/purchase-items?id=${item.id}`, { method: "DELETE" })
        : await fetch("/api/purchase-items", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: item.id, status: "Active" }),
          });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Save failed.");
      say(
        goingInactive
          ? `"${item.item_name}" deactivated — restore anytime from the Inactive filter.`
          : `"${item.item_name}" restored.`
      );
    } catch (e) {
      setItems((arr) =>
        arr.map((r) => (r.id === item.id ? { ...r, status: goingInactive ? "Active" : "Inactive" } : r))
      );
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
        uom: item.uom || "",
        uom_size: item.uom_size ?? "",
        purchase_rate: item.purchase_rate ?? "",
        tax_rate: item.tax_rate ?? "",
        brand_type: item.brand_type || "",
        status: item.status || "Active",
      },
    });
  }

  function setForm(key, value) {
    setModal((m) => ({ ...m, form: { ...m.form, [key]: value } }));
  }

  async function save() {
    setModal((m) => ({ ...m, saving: true, err: "" }));
    const f = modal.form;
    const body = {
      item_name: f.item_name,
      category: f.category,
      uom: f.uom,
      uom_size: f.uom_size,
      purchase_rate: f.purchase_rate,
      tax_rate: f.tax_rate,
      brand_type: f.brand_type || null,
      status: f.status,
    };
    try {
      const res = await fetch("/api/purchase-items", {
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
      data-test={value === "all" ? "pi_chip_all" : `pi_chip_${value}`}
      onClick={() => {
        setBrandFilter(value);
        resetPage();
      }}
      className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
        brandFilter === value
          ? "border-blue-600 bg-blue-600 text-white"
          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
      }`}
    >
      {label}
      <span className={`ml-1.5 text-xs ${brandFilter === value ? "text-blue-100" : "text-slate-400"}`}>
        {count}
      </span>
    </button>
  );

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Purchase Items</h1>
          <p className="text-sm text-slate-500">
            Master list of everything we buy — the same list Purchase Bills matches against.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a className={btnGhost} href="/purchase-bills">
            ← Purchase Bills
          </a>
          <button className={btnPrimary} data-test="pi_add" onClick={openAdd}>
            <Icon d={ICONS.plus} />
            Add item
          </button>
        </div>
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
            data-test="pi_search"
            className="w-72 rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            placeholder="Search items…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              resetPage();
            }}
          />
        </div>
        {chip("all", "All", counts.total)}
        {chip("none", "Unclassified", counts.none)}
        {chip("Gourmaison", "Gourmaison", counts.Gourmaison)}
        {chip("Taatsu", "Taatsu", counts.Taatsu)}
        {chip("Both", "Both", counts.Both)}
        <select
          data-test="pi_status"
          className="w-36 cursor-pointer rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-700"
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            resetPage();
          }}
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
              <th className="w-24 px-3 py-3">UoM</th>
              <th className="w-32 px-3 py-3">Rate</th>
              <th className="w-[150px] px-3 py-3">Brand</th>
              <th className="w-28 px-3 py-3">Status</th>
              <th className="w-24 px-3 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {paged.map((it) => {
              const inactive = (it.status || "Active") === "Inactive";
              return (
                <tr key={it.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70">
                  <td className="px-4 py-2.5">
                    <div className={`text-[15px] font-medium ${inactive ? "text-slate-400 line-through" : "text-slate-900"}`}>
                      {it.item_name}
                    </div>
                    <div className="text-xs text-slate-500">
                      {it.category || "—"}
                      {it.zoho_item_id ? " · Zoho" : ""}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-slate-600">
                    {[it.uom_size, it.uom].filter(Boolean).join(" ") || "—"}
                  </td>
                  <td className="px-3 py-2.5 text-slate-600">
                    {it.purchase_rate != null ? `₹${it.purchase_rate}` : "—"}
                    {it.tax_rate != null && it.tax_rate !== 0 ? (
                      <span className="text-xs text-slate-400"> · {it.tax_rate}%</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5">
                    <select
                      data-test={`pi_brand_${it.id}`}
                      value={it.brand_type || ""}
                      onChange={(e) => setBrand(it, e.target.value)}
                      className={`cursor-pointer rounded-lg border px-2 py-1 text-sm font-medium ${
                        it.brand_type
                          ? `${BRAND_CHIP[it.brand_type] || ""}`
                          : "border-slate-200 bg-white text-slate-500"
                      }`}
                    >
                      <option value="">— none —</option>
                      {BRAND_TYPES.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
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
                        data-test={`pi_edit_${it.id}`}
                        title="Edit"
                        className={btnIcon}
                        onClick={() => openEdit(it)}
                      >
                        <Icon d={ICONS.pencil} />
                      </button>
                      <button
                        data-test={inactive ? `pi_on_${it.id}` : `pi_off_${it.id}`}
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
            {!loading && paged.length === 0 && (
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

      {/* pager */}
      {!loading && filtered.length > 0 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>
            Showing {safePage * PAGE_SIZE + 1}–{Math.min(filtered.length, (safePage + 1) * PAGE_SIZE)} of{" "}
            {filtered.length}
          </span>
          <div className="flex items-center gap-2">
            <button
              className={btnGhost}
              disabled={safePage === 0}
              onClick={() => setPage(safePage - 1)}
            >
              ← Prev
            </button>
            <span className="text-slate-600">
              Page {safePage + 1} / {pageCount}
            </span>
            <button
              className={btnGhost}
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage(safePage + 1)}
            >
              Next →
            </button>
          </div>
        </div>
      )}

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
                  data-test="pi_name"
                  className={inp}
                  value={modal.form.item_name}
                  onChange={(e) => setForm("item_name", e.target.value)}
                  placeholder="e.g. Amul Butter 500gm"
                  autoFocus
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Category
                <input
                  data-test="pi_category"
                  className={inp}
                  list="pi-cats"
                  value={modal.form.category}
                  onChange={(e) => setForm("category", e.target.value)}
                  placeholder="e.g. Dairy"
                />
                <datalist id="pi-cats">
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Brand
                <select
                  data-test="pi_brandtype"
                  className={inp + " cursor-pointer"}
                  value={modal.form.brand_type}
                  onChange={(e) => setForm("brand_type", e.target.value)}
                >
                  <option value="">— none —</option>
                  {BRAND_TYPES.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-700">
                UoM
                <input
                  data-test="pi_uom"
                  className={inp}
                  list="pi-units"
                  value={modal.form.uom}
                  onChange={(e) => setForm("uom", e.target.value)}
                  placeholder="kg, pcs, l…"
                />
                <datalist id="pi-units">
                  {UNITS.map((u) => (
                    <option key={u} value={u} />
                  ))}
                </datalist>
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Pack size
                <input
                  data-test="pi_uomsize"
                  type="number"
                  step="any"
                  className={inp}
                  value={modal.form.uom_size}
                  onChange={(e) => setForm("uom_size", e.target.value)}
                  placeholder="e.g. 500"
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Purchase rate (₹)
                <input
                  data-test="pi_rate"
                  type="number"
                  step="any"
                  className={inp}
                  value={modal.form.purchase_rate}
                  onChange={(e) => setForm("purchase_rate", e.target.value)}
                  placeholder="e.g. 265"
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Tax rate (%)
                <input
                  data-test="pi_tax"
                  type="number"
                  step="any"
                  className={inp}
                  value={modal.form.tax_rate}
                  onChange={(e) => setForm("tax_rate", e.target.value)}
                  placeholder="e.g. 12"
                />
              </label>
              {modal.item && (
                <label className="col-span-2 block text-sm font-medium text-slate-700">
                  Status
                  <select
                    data-test="pi_status_sel"
                    className={inp + " cursor-pointer"}
                    value={modal.form.status}
                    onChange={(e) => setForm("status", e.target.value)}
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </label>
              )}
            </div>

            {modal.err && (
              <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-sm text-rose-700">
                {modal.item ? "" : "⚠️ "}
                {modal.err}
              </div>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button className={btnGhost} onClick={() => setModal({ ...modal, open: false })}>
                Cancel
              </button>
              <button
                data-test="pi_save"
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
