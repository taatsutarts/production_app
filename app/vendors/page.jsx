"use client";
// Vendors — full CRUD manager for the vendors master table (the sidebar's /vendors
// route). Search, add/edit modal, delete (blocked while bills reference the vendor),
// and an expandable per-vendor list of item mappings (wording → master item) that
// can be repointed or removed. Data via /api/vendors + /api/vendors/mappings.
import { Fragment, useEffect, useMemo, useState } from "react";

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
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9.5 7V4.5h5V7" />
      <path d="M6.5 7l.8 13h9.4l.8-13" />
      <path d="M10 11v5M14 11v5" />
    </>
  ),
  x: <path d="M18 6 6 18M6 6l12 12" />,
  chevron: <path d="m6 9 6 6 6-6" />,
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
  vendor_name: "",
  gstin: "",
  phone: "",
  email: "",
  address: "",
  default_brand_id: "",
  zoho_vendor_id: "",
};

const BRAND_CHIP = {
  Gourmaison: "border-amber-200 bg-amber-50 text-amber-700",
  Taatsu: "border-indigo-200 bg-indigo-50 text-indigo-700",
  Both: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

export default function VendorsPage() {
  const [vendors, setVendors] = useState([]);
  const [brands, setBrands] = useState([]);
  const [catalog, setCatalog] = useState([]); // active items for repoint selects
  const [loading, setLoading] = useState(true);
  const [pageErr, setPageErr] = useState("");

  const [q, setQ] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const [mappings, setMappings] = useState({}); // vendor_id -> [mapping]
  const [mapsLoading, setMapsLoading] = useState(false);

  const [toast, setToast] = useState(null);
  const [modal, setModal] = useState({ open: false, vendor: null, form: EMPTY_FORM, err: "", saving: false });

  function say(text, kind = "ok") {
    setToast({ text, kind });
    window.clearTimeout(say._t);
    say._t = window.setTimeout(() => setToast(null), 3500);
  }

  function load() {
    setLoading(true);
    setPageErr("");
    fetch("/api/vendors")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setPageErr(d.error);
        else {
          setVendors(d.vendors || []);
          setBrands(d.brands || []);
        }
      })
      .catch(() => setPageErr("Could not load the vendors."))
      .finally(() => setLoading(false));
    // catalog for the mapping repoint select (active items, small payload)
    fetch("/api/purchase-bills/items")
      .then((r) => r.json())
      .then((d) => setCatalog(d.items || []))
      .catch(() => {});
  }
  useEffect(load, []);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return vendors;
    return vendors.filter((v) =>
      `${v.vendor_name} ${v.gstin || ""} ${v.phone || ""} ${v.email || ""}`.toLowerCase().includes(t)
    );
  }, [vendors, q]);

  /* ---------- mappings panel ---------- */

  async function toggleExpand(vendorId) {
    if (expandedId === vendorId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(vendorId);
    if (!mappings[vendorId]) {
      setMapsLoading(true);
      try {
        const res = await fetch(`/api/vendors/mappings?vendor_id=${vendorId}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Could not load mappings.");
        setMappings((m) => ({ ...m, [vendorId]: data.mappings || [] }));
      } catch (e) {
        say(String(e.message || e), "err");
      } finally {
        setMapsLoading(false);
      }
    }
  }

  async function repoint(mapping, itemId) {
    const vendorId = mapping.vendor_id;
    setMappings((m) => ({
      ...m,
      [vendorId]: (m[vendorId] || []).map((r) => (r.id === mapping.id ? { ...r, item_id: itemId } : r)),
    }));
    try {
      const res = await fetch("/api/vendors/mappings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: mapping.id, item_id: itemId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Save failed.");
      const item = catalog.find((c) => String(c.id) === String(itemId));
      setMappings((m) => ({
        ...m,
        [vendorId]: (m[vendorId] || []).map((r) =>
          r.id === mapping.id
            ? { ...r, item: { id: itemId, item_name: item ? item.item_name : "?", brand_type: item?.brand_type ?? null } }
            : r
        ),
      }));
      say("Mapping updated.");
    } catch (e) {
      say(String(e.message || e), "err");
      // reload the panel so the select shows the true server state again
      try {
        const res = await fetch(`/api/vendors/mappings?vendor_id=${vendorId}`);
        const data = await res.json().catch(() => ({}));
        if (res.ok) setMappings((m) => ({ ...m, [vendorId]: data.mappings || [] }));
      } catch {}
    }
  }

  async function deleteMapping(mapping) {
    if (!window.confirm(`Remove the mapping for "${mapping.vendor_item_name}"? The next bill will ask for it again.`)) return;
    try {
      const res = await fetch(`/api/vendors/mappings?id=${mapping.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Delete failed.");
      setMappings((m) => ({
        ...m,
        [mapping.vendor_id]: (m[mapping.vendor_id] || []).filter((r) => r.id !== mapping.id),
      }));
      setVendors((arr) =>
        arr.map((v) =>
          v.id === mapping.vendor_id ? { ...v, mapping_count: Math.max(0, (v.mapping_count || 1) - 1) } : v
        )
      );
      say("Mapping removed.");
    } catch (e) {
      say(String(e.message || e), "err");
    }
  }

  /* ---------- vendor CRUD ---------- */

  function openAdd() {
    setModal({ open: true, vendor: null, form: { ...EMPTY_FORM }, err: "", saving: false });
  }

  function openEdit(v) {
    setModal({
      open: true,
      vendor: v,
      err: "",
      saving: false,
      form: {
        vendor_name: v.vendor_name || "",
        gstin: v.gstin || "",
        phone: v.phone || "",
        email: v.email || "",
        address: v.address || "",
        default_brand_id: v.default_brand_id ? String(v.default_brand_id) : "",
        zoho_vendor_id: v.zoho_vendor_id || "",
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
      vendor_name: f.vendor_name,
      gstin: f.gstin,
      phone: f.phone,
      email: f.email,
      address: f.address,
      default_brand_id: f.default_brand_id || null,
      zoho_vendor_id: f.zoho_vendor_id,
    };
    try {
      const res = await fetch("/api/vendors", {
        method: modal.vendor ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(modal.vendor ? { ...body, id: modal.vendor.id } : body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setModal((m) => ({ ...m, saving: false, err: data.message || data.error || "Save failed." }));
        return;
      }
      setModal({ open: false, vendor: null, form: EMPTY_FORM, err: "", saving: false });
      say(modal.vendor ? "Vendor updated." : "Vendor added.");
      load();
    } catch (e) {
      setModal((m) => ({ ...m, saving: false, err: String(e.message || e) }));
    }
  }

  async function removeVendor(v) {
    if (!window.confirm(`Delete vendor "${v.vendor_name}"? This also removes its item mappings.`)) return;
    try {
      const res = await fetch(`/api/vendors?id=${v.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        say(data.message || data.error || "Delete failed.", "err");
        return;
      }
      say(`Vendor "${v.vendor_name}" deleted.`);
      load();
    } catch (e) {
      say(String(e.message || e), "err");
    }
  }

  const countPill = (n) => (
    <span className="inline-flex min-w-[2rem] justify-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
      {n}
    </span>
  );

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Vendors</h1>
          <p className="text-sm text-slate-500">
            Suppliers matched by GSTIN on every purchase bill — plus the wording → item mappings they taught us.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a className={btnGhost} href="/purchase-bills">
            ← Purchase Bills
          </a>
          <button className={btnPrimary} data-test="v_add" onClick={openAdd}>
            <Icon d={ICONS.plus} />
            Add vendor
          </button>
        </div>
      </div>

      {pageErr && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          ⚠️ {pageErr}
        </div>
      )}

      {/* search */}
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
          <Icon d={ICONS.search} />
        </span>
        <input
          data-test="v_search"
          className="w-80 rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          placeholder="Search by name, GSTIN or phone…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {/* table */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/80 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3">Vendor</th>
              <th className="w-44 px-3 py-3">GSTIN</th>
              <th className="w-36 px-3 py-3">Phone</th>
              <th className="w-44 px-3 py-3">Email</th>
              <th className="w-32 px-3 py-3">Default brand</th>
              <th className="w-16 px-3 py-3 text-center">Bills</th>
              <th className="w-24 px-3 py-3 text-center">Mappings</th>
              <th className="w-28 px-3 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((v) => {
              const open = expandedId === v.id;
              const brandRow = brands.find((b) => b.id === v.default_brand_id);
              return (
                <Fragment key={v.id}>
                  <tr
                    data-test={`v_row_${v.id}`}
                    className="cursor-pointer border-b border-slate-100 hover:bg-slate-50/70"
                    onClick={() => toggleExpand(v.id)}
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <Icon
                          d={ICONS.chevron}
                          className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
                        />
                        <div>
                          <div className="text-[15px] font-medium text-slate-900">{v.vendor_name}</div>
                          {v.address ? (
                            <div className="max-w-[24rem] truncate text-xs text-slate-500">{v.address}</div>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-slate-600">{v.gstin || "—"}</td>
                    <td className="px-3 py-2.5 text-slate-600">{v.phone || "—"}</td>
                    <td className="max-w-0 truncate px-3 py-2.5 text-slate-600">{v.email || "—"}</td>
                    <td className="px-3 py-2.5">
                      {brandRow ? (
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${
                            BRAND_CHIP[brandRow.brand_name] || "border-slate-200 bg-slate-50 text-slate-600"
                          }`}
                        >
                          {brandRow.brand_name}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center">{countPill(v.bill_count || 0)}</td>
                    <td className="px-3 py-2.5 text-center">{countPill(v.mapping_count || 0)}</td>
                    <td className="px-3 py-2.5">
                      <div
                        className="flex items-center justify-end gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button data-test={`v_edit_${v.id}`} title="Edit" className={btnIcon} onClick={() => openEdit(v)}>
                          <Icon d={ICONS.pencil} />
                        </button>
                        <button data-test={`v_del_${v.id}`} title="Delete" className={btnIcon} onClick={() => removeVendor(v)}>
                          <Icon d={ICONS.trash} />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {open && (
                    <tr key={`${v.id}-map`} className="border-b border-slate-100">
                      <td colSpan={8} className="bg-slate-50/70 px-10 py-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                          Item mappings — the item names this vendor prints on bills
                        </p>
                        {mapsLoading && !mappings[v.id] && (
                          <p className="mt-2 text-sm text-slate-400">loading…</p>
                        )}
                        {mappings[v.id] && mappings[v.id].length === 0 && (
                          <p className="mt-2 text-sm text-slate-400">
                            No mappings yet — they get created automatically when you save a bill line.
                          </p>
                        )}
                        {mappings[v.id] && mappings[v.id].length > 0 && (
                          <ul className="mt-2 space-y-1.5">
                            {mappings[v.id].map((mp) => (
                              <li
                                key={mp.id}
                                className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2"
                              >
                                <span className="text-sm text-slate-900">{mp.vendor_item_name}</span>
                                <span className="text-slate-400">→</span>
                                <select
                                  data-test={`v_map_${mp.id}`}
                                  className="w-56 cursor-pointer rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700"
                                  value={mp.item_id ?? ""}
                                  onChange={(e) => repoint(mp, e.target.value)}
                                >
                                  <option value="" disabled>
                                    — pick a master item —
                                  </option>
                                  {catalog.map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {c.item_name}
                                    </option>
                                  ))}
                                </select>
                                <span className="ml-auto text-xs text-slate-400">
                                  taught {mp.created_at ? new Date(mp.created_at).toLocaleDateString() : ""}
                                </span>
                                <button
                                  data-test={`v_mapdel_${mp.id}`}
                                  title="Remove mapping"
                                  className={btnIcon}
                                  onClick={() => deleteMapping(mp)}
                                >
                                  <Icon d={ICONS.trash} />
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-400">
                  {vendors.length === 0
                    ? "No vendors yet — add your first vendor, or just save a bill and it will appear here."
                    : "No vendors match the search."}
                </td>
              </tr>
            )}
            {loading && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-400">
                  Loading vendors…
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
                {modal.vendor ? "Edit vendor" : "Add vendor"}
              </h2>
              <button className={btnIcon} onClick={() => setModal({ ...modal, open: false })}>
                <Icon d={ICONS.x} />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="col-span-2 block text-sm font-medium text-slate-700">
                Vendor name
                <input
                  data-test="v_name"
                  className={inp}
                  value={modal.form.vendor_name}
                  onChange={(e) => setForm("vendor_name", e.target.value)}
                  placeholder="e.g. Trikaya Agriculture"
                  autoFocus
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                GSTIN
                <input
                  data-test="v_gstin"
                  className={`${inp} font-mono`}
                  value={modal.form.gstin}
                  onChange={(e) => setForm("gstin", e.target.value.toUpperCase())}
                  placeholder="27AAPFU0939F1ZV"
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Phone
                <input
                  data-test="v_phone"
                  className={inp}
                  value={modal.form.phone}
                  onChange={(e) => setForm("phone", e.target.value)}
                  placeholder="98765 43210"
                />
              </label>
              <label className="col-span-2 block text-sm font-medium text-slate-700">
                Email
                <input
                  data-test="v_email"
                  type="email"
                  className={inp}
                  value={modal.form.email}
                  onChange={(e) => setForm("email", e.target.value)}
                  placeholder="accounts@vendor.com"
                />
              </label>
              <label className="col-span-2 block text-sm font-medium text-slate-700">
                Address
                <textarea
                  data-test="v_address"
                  rows={2}
                  className={inp}
                  value={modal.form.address}
                  onChange={(e) => setForm("address", e.target.value)}
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Default brand
                <select
                  data-test="v_brand"
                  className={inp + " cursor-pointer"}
                  value={modal.form.default_brand_id}
                  onChange={(e) => setForm("default_brand_id", e.target.value)}
                >
                  <option value="">— none —</option>
                  {brands.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.brand_name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Zoho vendor ID
                <input
                  data-test="v_zoho"
                  className={inp}
                  value={modal.form.zoho_vendor_id}
                  onChange={(e) => setForm("zoho_vendor_id", e.target.value)}
                  placeholder="from Zoho Books"
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
                data-test="v_save"
                className={btnPrimary}
                disabled={modal.saving || !modal.form.vendor_name.trim()}
                onClick={save}
              >
                {modal.saving ? "Saving…" : modal.vendor ? "Save changes" : "Add vendor"}
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
