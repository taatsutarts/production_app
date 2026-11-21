"use client";
// Purchase Bills: upload (camera / image / PDF) -> preview -> Gemini extraction ->
// vendor resolution (GSTIN match / name candidates / create) -> per-line standard
// item + brand matching -> editable review -> save draft (Supabase) ->
// approve -> Zoho. One client file, same card/table styling as the rest of the app.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { lineDefaults } from "@/lib/purchaseMatch";

const card = "rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900";
const title = "text-base font-semibold";
const mute = "text-sm text-slate-500 dark:text-slate-400";
const th = "px-2 py-1.5 text-left text-sm font-medium text-slate-500 dark:text-slate-400";
const td = "px-2 py-1.5";
// line-item cells: on phones each line becomes a card and every cell stacks under its small label (data-label)
const ltd = td + " max-md:block max-md:px-0 max-md:py-0 max-md:before:mb-0.5 max-md:before:block max-md:before:text-xs max-md:before:font-medium max-md:before:text-slate-500 max-md:before:content-[attr(data-label)]";
const inp =
  "w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800";
// Line-item inputs are bigger than the header fields — this is where people actually
// type (and read back) OCR values on small screens. Explicit dark text on white so
// typed values are always clearly visible. NO width class here on purpose: every
// usage sets its own explicit width (mixing w-full with w-24 makes Tailwind pick
// w-full, and the table columns then collapse until the typed value is invisible).
const tin =
  "rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-[15px] font-medium text-slate-900 outline-none focus:border-sky-500";
const tinWarn =
  "rounded-lg border border-amber-400 bg-amber-50 px-2.5 py-2 text-[15px] font-medium text-slate-900 outline-none focus:border-sky-500";
const btn =
  "cursor-pointer rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white";
const btnGhost =
  "cursor-pointer rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800";

/* ---------- small helpers (same math the server repeats as the referee) ---------- */

// "1,234.50", "₹ 500", " 12 " -> plain number (0 when not a number)
const n = (v) => {
  const x = Number(String(v ?? "").replace(/[₹,\s]/g, ""));
  return isFinite(x) ? x : 0;
};
const r2 = (x) => Math.round(x * 100) / 100;
const fm = (x) =>
  x == null || isNaN(x)
    ? "—"
    : (x < 0 ? "−₹" : "₹") + Math.abs(r2(x)).toLocaleString("en-IN", { maximumFractionDigits: 2 });

const ZOHO_C = { synced: "green", pending: "amber", failed: "rose", not_configured: "slate" };

function Badge({ t = "slate", children }) {
  const c = {
    green: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    amber: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    rose: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
    slate: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  }[t];
  return <span className={"inline-block rounded-full px-2 py-0.5 text-xs font-medium " + c}>{children}</span>;
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-xs font-medium text-slate-500 dark:text-slate-400">{label}</span>
      {children}
    </label>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span>{fm(value)}</span>
    </div>
  );
}

const EMPTY_LINE = {
  description: "",
  cost_center: "", // the extracted brand guess; the final brand choice overwrites it on save
  item_id: "", // standard purchase_items row ("" = not resolved yet)
  brand_id: "", // brands row ("" = not resolved yet)
  match_how: "", // "" | "mapping" | "exact" — how the item suggestion was found
  // Zoho bill-line fields — pre-filled from history (this vendor's exception, else the item default)
  account_id: "",
  account_name: "",
  itc_eligibility: "", // "eligible" | "ineligible"
  location: "",
  quantity: "",
  unit: "",
  rate: "",
  tax_rate: "",
  line_total: "",
};

/* ---------- searchable picker (type to filter) — used for the item and the account ---------- */

// groups: [{ title, options: [{ value, label, hint? }] }]. The list opens in a portal with a fixed
// position, so the line-items table's scroll box can never clip it. Every word typed must appear in
// the option (any order); arrow keys + Enter pick; Escape closes.
function SearchSelect({ testId, value, label, groups, onPick, placeholder, className, clearLabel, onCreate, createLabel }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const popRef = useRef(null);
  const inputRef = useRef(null);

  const place = () => {
    const r = btnRef.current && btnRef.current.getBoundingClientRect();
    if (!r) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(Math.max(r.width, 300), vw - 16);
    const left = Math.max(8, Math.min(r.left, vw - width - 8));
    const below = vh - r.bottom;
    const up = below < 300 && r.top > below; // open upwards when there is more room above
    setPos({
      left,
      width,
      top: up ? undefined : r.bottom + 4,
      bottom: up ? vh - r.top + 4 : undefined,
      maxH: Math.max(180, Math.min(400, (up ? r.top : below) - 16)),
    });
  };

  useEffect(() => {
    if (!open) return;
    place();
    const onMove = () => place();
    const onDown = (e) => {
      if ((popRef.current && popRef.current.contains(e.target)) || (btnRef.current && btnRef.current.contains(e.target))) return;
      setOpen(false);
    };
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setQ("");
      setHi(0);
      setTimeout(() => inputRef.current && inputRef.current.focus(), 0);
    }
  }, [open]);

  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  let budget = 150; // enough to scroll, never a wall of 900 rows
  const shown = [];
  for (const g of groups) {
    const opts = [];
    for (const o of g.options) {
      if (budget <= 0) break;
      if (words.every((w) => o.label.toLowerCase().includes(w))) {
        opts.push(o);
        budget--;
      }
    }
    if (opts.length) shown.push({ title: g.title, options: opts });
  }
  const flat = shown.flatMap((g) => g.options);

  useEffect(() => {
    if (open && popRef.current) {
      const el = popRef.current.querySelector('[data-hi="1"]');
      if (el) el.scrollIntoView({ block: "nearest" });
    }
  }, [hi, open]);

  const pick = (v) => {
    onPick(v);
    setOpen(false);
    if (btnRef.current) btnRef.current.focus();
  };
  const onKey = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi((h) => Math.min(flat.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (flat[hi]) pick(flat[hi].value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      if (btnRef.current) btnRef.current.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  let idx = -1;
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        data-test={testId}
        data-value={value || ""}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`${className} flex items-center justify-between gap-2 text-left`}
      >
        <span className={`truncate ${label ? "" : "text-slate-400"}`}>{label || placeholder}</span>
        <span aria-hidden="true" className="text-slate-400">▾</span>
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={popRef}
            role="listbox"
            style={{ position: "fixed", left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxH, zIndex: 70 }}
            className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
          >
            <input
              ref={inputRef}
              data-test={testId + "_search"}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setHi(0);
              }}
              onKeyDown={onKey}
              placeholder="Type to search…"
              className="w-full border-b border-slate-200 px-3 py-2 text-base outline-none"
            />
            <div className="overflow-y-auto">
              {onCreate && (
                <button
                  type="button"
                  data-test={testId + "_new"}
                  onClick={() => {
                    setOpen(false);
                    onCreate(q.trim());
                  }}
                  className="w-full border-b border-slate-100 px-3 py-2 text-left text-sm font-medium text-emerald-700 hover:bg-emerald-50"
                >
                  ＋ {createLabel || "Add new"}{q.trim() ? " “" + q.trim() + "”" : ""}
                </button>
              )}
              {value && clearLabel && (
                <button type="button" onClick={() => pick("")} className="w-full px-3 py-2 text-left text-sm text-rose-600 hover:bg-slate-50">
                  ✕ {clearLabel}
                </button>
              )}
              {shown.length === 0 && <div className="px-3 py-3 text-sm text-slate-500">No match for “{q}”.</div>}
              {shown.map((g) => (
                <div key={g.title}>
                  <div className="bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{g.title}</div>
                  {g.options.map((o) => {
                    idx++;
                    const me = idx;
                    return (
                      <button
                        key={g.title + o.value}
                        type="button"
                        role="option"
                        aria-selected={o.value === value}
                        data-hi={me === hi ? "1" : undefined}
                        onMouseEnter={() => setHi(me)}
                        onClick={() => pick(o.value)}
                        className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm ${me === hi ? "bg-slate-100" : ""} ${o.value === value ? "font-semibold" : ""}`}
                      >
                        <span>{o.label}</span>
                        {o.hint && <span className="shrink-0 text-xs text-slate-400">{o.hint}</span>}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

/* ---------- Zoho line fields: defaults from history ---------- */

// Most common location among the catalog items of one brand — used only when an item has no
// location of its own (learned from the data, nothing hardcoded).
function locationForBrand(catalogItems, brandName) {
  if (!brandName) return "";
  const n = {};
  for (const it of catalogItems) if (it.brand_type === brandName && it.location) n[it.location] = (n[it.location] || 0) + 1;
  return Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}

// Fill account / ITC / location of a line from its item's defaults + this vendor's overrides.
// force = overwrite what is there (the reviewer just picked a different item); otherwise only blanks.
function withZohoDefaults(line, item, override, catalogItems, brandName, force = false) {
  const d = lineDefaults(item, override);
  const next = { ...line };
  if (d.account_id && (force || !line.account_id)) {
    next.account_id = d.account_id;
    next.account_name = d.account_name;
  }
  if (d.itc_eligibility && (force || !line.itc_eligibility)) next.itc_eligibility = d.itc_eligibility;
  const loc = d.location || locationForBrand(catalogItems, brandName);
  if (loc && (force || !line.location)) next.location = loc;
  return next;
}

/* ---------- upload size (Vercel rejects request bodies over 4.5 MB) ---------- */

// the save request carries the file as base64 (+33%), so the raw file must stay under ~3.2 MB
const MAX_FILE_BYTES = 3.2 * 1024 * 1024;

// Phone photos are 3-8 MB; the invoice is just as readable at 2000 px / JPEG 85%
// (usually 300-800 KB). PDFs and anything that fails to decode are returned unchanged.
async function shrinkImage(f) {
  if (!f.type.startsWith("image/") || f.size < 600 * 1024) return f;
  try {
    const bmp = await createImageBitmap(f);
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close?.();
    const blob = await new Promise((ok) => canvas.toBlob(ok, "image/jpeg", 0.85));
    if (!blob || blob.size >= f.size) return f;
    return new File([blob], f.name.replace(/.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return f;
  }
}

// a failed response is not always JSON (a platform error page is plain text): say what happened
function httpProblem(res, data, what) {
  if (data && (data.message || data.error)) return data.message || data.error;
  if (res.status === 413)
    return what + " failed: the file is too large for the server (limit about 4 MB). Use a smaller photo or PDF.";
  return what + " failed (HTTP " + res.status + ").";
}

export default function PurchaseBills() {
  /* ---------- upload state ---------- */
  const [file, setFile] = useState(null);
  const [fileKind, setFileKind] = useState(null); // "image" | "pdf"
  const [fileUrl, setFileUrl] = useState("");
  const [storedFile, setStoredFile] = useState(null); // { name } — the original saved with the bill being edited
  const cameraRef = useRef(null);
  const imageRef = useRef(null);
  const pdfRef = useRef(null);

  /* ---------- extraction + editable form state ---------- */
  const [extracting, setExtracting] = useState(false);
  const [bill, setBill] = useState(null); // null = no bill being reviewed
  const [items, setItems] = useState([]);
  const [editingId, setEditingId] = useState(""); // set while editing a saved bill

  /* ---------- matching state (vendor + items + brands, all server-side) ---------- */
  const [catalog, setCatalog] = useState({ items: [], brands: [], accounts: [], locations: [], vendorOv: {}, vendorItemIds: [] });
  const [vm, setVm] = useState({ checked: false, matched: null, candidates: [] }); // vendor match
  const [suggestions, setSuggestions] = useState({}); // line index -> [ { id, item_name, score } ]
  const [matchBusy, setMatchBusy] = useState(false);
  const [vOpen, setVOpen] = useState(false); // create-vendor form open
  const [vForm, setVForm] = useState({ vendor_name: "", gstin: "", phone: "", email: "", address: "" });
  const [vBusy, setVBusy] = useState(false);
  // "＋ Add new item" from a line's Standard item picker: { line, item_name, brand_type, uom } or null
  const [nItem, setNItem] = useState(null);
  const [nItemBusy, setNItemBusy] = useState(false);

  /* ---------- saved bills ---------- */
  const [bills, setBills] = useState([]);
  const [billsQ, setBillsQ] = useState(""); // client-side search over the saved list
  const [billsStatus, setBillsStatus] = useState("all");
  const [autoSync, setAutoSync] = useState(true); // Save = approve + send to Zoho (untick to keep a draft)
  const [newBillId, setNewBillId] = useState(null); // the bill just saved: highlighted, kept on top
  const billsRef = useRef(null);
  const justSaved = useRef(null); // the saved row, kept in the list even if a re-read is a moment behind
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState("");

  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  /* ---------- pick / remove / replace a file ---------- */
  async function onPick(picked) {
    if (!picked) return;
    const f = await shrinkImage(picked);
    const kind =
      f.type === "application/pdf" ? "pdf" : f.type && f.type.startsWith("image/") ? "image" : null;
    if (!kind) {
      setErr("Please choose an image or a PDF.");
      return;
    }
    if (f.size > MAX_FILE_BYTES) {
      setErr(
        "This file is " + (f.size / 1048576).toFixed(1) + " MB — too large to upload (limit about 3 MB). " +
          (kind === "pdf" ? "Compress the PDF or send a photo of the invoice instead." : "Choose a smaller photo.")
      );
      return;
    }
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    setErr("");
    setMsg("");
    if (!editingId) setBill(null); // a new file starts a fresh review — except while editing
    setItems([]);
    setFile(f);
    setStoredFile(null);
    setFileKind(kind);
    setFileUrl(URL.createObjectURL(f));
  }

  function clearForm() {
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    setFile(null);
    setStoredFile(null);
    setFileKind(null);
    setFileUrl("");
    setBill(null);
    setItems([]);
    setEditingId("");
    setVm({ checked: false, matched: null, candidates: [] });
    setSuggestions({});
    setVOpen(false);
    setErr("");
  }

  function discard() {
    setMsg("");
    clearForm();
  }

  /* ---------- vendor + item matching (the server does all the thinking) ---------- */
  async function runMatch(draftBill, draftItems) {
    setMatchBusy(true);
    try {
      const res = await fetch("/api/purchase-bills/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendor_gstin: draftBill.vendor_gstin || "",
          vendor_name: draftBill.vendor_name || "",
          vendor_id: draftBill.vendor_id || null,
          items: draftItems.map((it) => ({ description: it.description || "" })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data.error || "Vendor/item matching failed.");
        return;
      }
      setCatalog({
        items: data.items || [],
        brands: data.brands || [],
        accounts: data.accounts || [],
        locations: data.locations || [],
        vendorOv: data.vendor_overrides || {},
        vendorItemIds: data.vendor_item_ids || [],
      });
      const brandIdByName = {};
      (data.brands || []).forEach((b) => (brandIdByName[b.brand_name] = String(b.id)));

      // vendor: matched by GSTIN (or already linked) -> link; else candidates are advice
      if (data.vendor && data.vendor.matched) {
        const v = data.vendor.matched;
        setVm({ checked: true, matched: v, candidates: [] });
        setBill((b) => ({
          ...b,
          vendor_id: b.vendor_id || String(v.id),
          vendor_name: b.vendor_name || v.vendor_name || "",
          vendor_gstin: b.vendor_gstin || v.gstin || "",
        }));
      } else {
        setVm({
          checked: true,
          matched: null,
          candidates: (data.vendor && data.vendor.candidates) || [],
        });
      }

      const sugMap = {};
      (data.suggestions || []).forEach((s) => (sugMap[s.line] = s.options));
      setSuggestions(sugMap);

      // prefill item + brand per line: confirmed mapping / exact name hit are confident;
      // brand preselect priority = the item's brand_type, else the Gemini brand guess
      const resolvedByLine = {};
      (data.resolved || []).forEach((r) => (resolvedByLine[r.line] = r));
      setItems((arr) =>
        arr.map((it, i) => {
          const hit = resolvedByLine[i];
          const item_id = it.item_id || (hit ? String(hit.item_id) : "");
          let brand_id = it.brand_id || "";
          const match_how = it.match_how || (hit ? hit.how : "");
          const cat = item_id ? (data.items || []).find((c) => String(c.id) === String(item_id)) : null;
          const ov = item_id ? (data.vendor_overrides || {})[item_id] : null;
          if (item_id && !brand_id) {
            // this vendor's own brand for the item wins, then the item's brand (when it has just one)
            const bt = lineDefaults(cat, ov).brand_type;
            if (bt === "Gourmaison" || bt === "Taatsu") {
              brand_id = brandIdByName[bt] || "";
            } else if (brandIdByName[(it.cost_center || "").trim()]) {
              brand_id = brandIdByName[(it.cost_center || "").trim()];
            }
          }
          const brandName = ((data.brands || []).find((b) => String(b.id) === String(brand_id)) || {}).brand_name || "";
          const filled = cat ? withZohoDefaults(it, cat, ov, data.items || [], brandName) : it;
          return { ...filled, item_id, brand_id, match_how };
        })
      );
    } catch (e) {
      setErr("Vendor/item matching failed: " + e.message);
    } finally {
      setMatchBusy(false);
    }
  }

  /* ---------- AI extraction ---------- */
  async function extract() {
    if (!file) return;
    setExtracting(true);
    setErr("");
    setMsg("Reading the invoice with Gemini…");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/purchase-bills/extract", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(httpProblem(res, data, "Extraction"));
        setMsg("");
        return;
      }
      const d = data.data || {};
      const draft = {
        vendor_id: "",
        vendor_name: d.vendor_name || "",
        vendor_gstin: d.vendor_gstin || "",
        cost_center: d.cost_center || "",
        invoice_number: d.invoice_number || "",
        grn_no: "", // internal tracking number (not sent to Zoho)
        invoice_date: d.invoice_date || "",
        due_date: d.due_date || "",
        discount_type: d.discount_type || "none",
        discount_value: d.discount_value == null ? "" : d.discount_value,
        other_charges: d.other_charges ?? 0,
        freight_charges: d.freight_charges ?? 0,
        tax_inclusive: d.tax_inclusive === true,
        discount_before_tax: d.discount_before_tax === true,
        grand_total: d.grand_total == null ? "" : d.grand_total,
        notes: "",
      };
      const draftItems = (d.items || []).map((it) => ({
        ...EMPTY_LINE,
        description: it.description || "",
        cost_center: it.cost_center || "",
        quantity: it.quantity ?? "",
        unit: it.unit || "",
        rate: it.rate ?? "",
        tax_rate: it.tax_rate ?? "",
        line_total: it.line_total == null ? "" : it.line_total,
      }));
      setBill(draft);
      setItems(draftItems);
      setMsg("Extracted — check every field, then resolve the vendor + item/brand per line before saving.");
      runMatch(draft, draftItems);
    } catch (e) {
      setErr("Extraction failed: " + e.message);
      setMsg("");
    } finally {
      setExtracting(false);
    }
  }

  /* ---------- edit an existing saved bill (view + edit) ---------- */
  async function editBill(b) {
    setBusyId(b.id);
    setErr("");
    setMsg("");
    try {
      const res = await fetch("/api/purchase-bills?id=" + b.id);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data.error || "Could not load the bill.");
        return;
      }
      if (fileUrl) URL.revokeObjectURL(fileUrl);
      setFile(null); // no NEW file; the saved original (if there is one) is only displayed
      // the saved original, read back from storage (cache-busted so a replaced file shows at once)
      setFileKind(data.file ? data.file.kind : null);
      setFileUrl(data.file ? data.file.url + "&t=" + Date.now() : "");
      setStoredFile(data.file ? { name: data.file.name } : null);
      setEditingId(b.id);
      const draft = {
        vendor_id: (data.bill.vendor && data.bill.vendor.id) ? String(data.bill.vendor.id) : "",
        vendor_name: data.bill.vendor_name || "",
        vendor_gstin: data.bill.vendor_gstin || "",
        cost_center: data.bill.cost_center || "",
        invoice_number: data.bill.invoice_number || "",
        grn_no: data.bill.grn_no || "",
        invoice_date: data.bill.invoice_date || "",
        due_date: data.bill.due_date || "",
        discount_type: data.bill.discount_type || "none",
        discount_value: data.bill.discount_value == null ? "" : data.bill.discount_value,
        other_charges: data.bill.other_charges ?? 0,
        freight_charges: data.bill.freight_charges ?? 0,
        tax_inclusive: data.bill.tax_inclusive === true,
        discount_before_tax: data.bill.discount_before_tax === true,
        grand_total: data.bill.grand_total == null ? "" : data.bill.grand_total,
        notes: data.bill.notes || "",
      };
      const loaded = (data.items || []).map((it) => ({
        ...EMPTY_LINE,
        description: it.description || "",
        cost_center: it.cost_center || "",
        item_id: it.item_id ? String(it.item_id) : it.item && it.item.id ? String(it.item.id) : "",
        brand_id: it.brand_id ? String(it.brand_id) : it.brand && it.brand.id ? String(it.brand.id) : "",
        account_id: it.account_id ? String(it.account_id) : "",
        account_name: it.account_name || "",
        itc_eligibility: it.itc_eligibility || "",
        location: it.location || "",
        quantity: it.quantity ?? "",
        unit: it.unit || "",
        rate: it.rate ?? "",
        tax_rate: it.tax_rate ?? "",
        line_total: it.line_total == null ? "" : it.line_total,
      }));
      setBill(draft);
      setItems(loaded);
      setVm({
        checked: true,
        matched: data.bill.vendor || null,
        candidates: [],
      });
      setMsg(
        "Editing " + (data.bill.invoice_number || "bill") +
          (data.bill.zoho_sync_status === "synced"
            ? " — note: this bill is already in Zoho, changes here will not update that Zoho bill."
            : " — make your changes and Save changes.")
      );
      window.scrollTo({ top: 0, behavior: "smooth" });
      runMatch(draft, loaded); // fills the catalog + any still-unresolved lines
    } catch (e) {
      setErr("Could not load the bill: " + e.message);
    } finally {
      setBusyId("");
    }
  }

  /* ---------- vendor actions ---------- */
  function useVendor(v) {
    setBill((b) => ({
      ...b,
      vendor_id: String(v.id),
      vendor_name: b.vendor_name || v.vendor_name || "",
      vendor_gstin: b.vendor_gstin || v.gstin || "",
    }));
    setVm({ checked: true, matched: v, candidates: [] });
  }

  function unlinkVendor() {
    setBill((b) => ({ ...b, vendor_id: "" }));
    setVm({ checked: true, matched: null, candidates: [] });
  }

  function openCreateVendor() {
    setVForm({
      vendor_name: bill.vendor_name || "",
      gstin: bill.vendor_gstin || "",
      phone: "",
      email: "",
      address: "",
    });
    setVOpen(true);
  }

  function openNewItem(i, typed) {
    const it = items[i] || {};
    const b = catalog.brands.find((x) => String(x.id) === String(it.brand_id));
    setNItem({
      line: i,
      item_name: typed || (it.description || "").trim(),
      brand_type: b ? b.brand_name : "",
      uom: it.unit || "",
    });
  }
  async function createItem(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!nItem) return;
    setNItemBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/purchase-bills/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_name: nItem.item_name, brand_type: nItem.brand_type, uom: nItem.uom }),
      });
      const data = await res.json().catch(() => ({}));
      let made = data.item;
      if (res.status === 409 && data.existing) made = { ...data.existing, brand_type: nItem.brand_type || null };
      else if (!res.ok) {
        setErr(data.error || data.message || "Could not create the item.");
        return;
      }
      const line = nItem.line;
      const bt = made.brand_type === "Gourmaison" || made.brand_type === "Taatsu" ? made.brand_type : "";
      setCatalog((c) =>
        c.items.some((x) => String(x.id) === String(made.id))
          ? c
          : { ...c, items: [...c.items, made].sort((a, b) => String(a.item_name).localeCompare(String(b.item_name))) }
      );
      setItems((arr) =>
        arr.map((it, j) => {
          if (j !== line) return it;
          const next = { ...it, item_id: String(made.id), item_name: made.item_name, match_how: "" };
          if (!it.brand_id && bt) {
            const b = catalog.brands.find((x) => x.brand_name === bt);
            if (b) next.brand_id = String(b.id);
          }
          return next;
        })
      );
      setNItem(null);
      setMsg(res.status === 409 ? "This item already exists — selected the existing one." : "Item added: " + made.item_name);
    } catch (e2) {
      setErr("Could not create the item: " + e2.message);
    } finally {
      setNItemBusy(false);
    }
  }

  async function createVendor(e) {
    if (e && e.preventDefault) e.preventDefault();
    setVBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/purchase-bills/vendors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vForm),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.existing) {
        useVendor(data.existing);
        setVOpen(false);
        setMsg("This vendor already exists — linked to the existing record.");
        return;
      }
      if (!res.ok) {
        setErr(data.error || data.message || "Could not create the vendor.");
        return;
      }
      useVendor(data.vendor);
      setVOpen(false);
      setMsg("Vendor created and linked: " + data.vendor.vendor_name);
    } catch (e2) {
      setErr("Could not create the vendor: " + e2.message);
    } finally {
      setVBusy(false);
    }
  }

  /* ---------- save draft (Supabase) ---------- */
  const brandNameOf = (id) => {
    const b = catalog.brands.find((x) => String(x.id) === String(id));
    return b ? b.brand_name : "";
  };
  // when every line agrees on one brand, that brand becomes the bill's cost center
  // (reports) — otherwise keep whatever is already there
  const uniformBrandName = () => {
    if (!items.length) return "";
    const first = items[0].brand_id;
    if (!first || !items.every((it) => it.brand_id && String(it.brand_id) === String(first))) return "";
    return brandNameOf(first);
  };

  async function save() {
    if (!bill) return;
    setSaving(true);
    setErr("");
    setMsg(editingId ? "Updating…" : "Saving…");
    try {
      // the original file goes along as base64 so the server can store it in Supabase Storage
      let filePayload = null;
      if (file) {
        const b64 = await new Promise((ok, bad) => {
          const r = new FileReader();
          r.onload = () => ok(String(r.result).split(",")[1]);
          r.onerror = () => bad(new Error("could not read the file"));
          r.readAsDataURL(file);
        });
        filePayload = { name: file.name, mimeType: file.type, base64: b64 };
      }
      const res = await fetch("/api/purchase-bills", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingId || undefined,
          bill: {
            ...bill,
            vendor_id: bill.vendor_id || null,
            discount_type: bill.discount_type === "none" ? null : bill.discount_type,
            cost_center: uniformBrandName() || bill.cost_center || "",
          },
          items,
          file: filePayload,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(httpProblem(res, data, "Save"));
        setMsg("");
        return;
      }
      // show it in the list immediately; loadBills() below then re-reads the real list
      if (data.bill && data.bill.id) {
        justSaved.current = data.bill;
        setBillsQ("");
        setBillsStatus("all"); // a search/filter must not hide the bill that was just saved
        setBills((prev) => [data.bill, ...prev.filter((x) => x.id !== data.bill.id)]);
        setNewBillId(data.bill.id);
        setTimeout(() => setNewBillId((cur) => (cur === data.bill.id ? null : cur)), 6000);
        // on a phone the list is far below the form: bring it into view
        setTimeout(() => billsRef.current && billsRef.current.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
      }
      const grnNote = data.bill && data.bill.grn_no ? " — GRN " + data.bill.grn_no : "";
      const wasEditing = !!editingId;
      // Zoho sync is the default: approve the saved bill, which sends it to Zoho in the same step
      let syncNote = "";
      let syncFailed = false;
      if (autoSync && data.bill && data.bill.id) {
        try {
          const r2res = await fetch("/api/purchase-bills", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: data.bill.id, status: "approved" }),
          });
          const d2 = await r2res.json().catch(() => ({}));
          if (!r2res.ok) {
            syncFailed = true;
            syncNote = "Zoho sync not done: " + (d2.error || "approve failed") + " — use Approve / Sync to Zoho in the list.";
          } else if (d2.zoho && d2.zoho.ok) syncNote = "synced to Zoho." + (d2.zoho.error ? " (attachment: " + d2.zoho.error + ")" : "");
          else if (d2.zoho && d2.zoho.reason === "already_synced") syncNote = "already in Zoho.";
          else if (d2.zoho && d2.zoho.reason === "not_configured") syncNote = "approved (Zoho is not configured).";
          else {
            syncFailed = true;
            syncNote = "Zoho sync failed: " + ((d2.zoho && d2.zoho.error) || "unknown error") + " — fix it and use Sync to Zoho in the list.";
          }
        } catch (e3) {
          syncFailed = true;
          syncNote = "Zoho sync failed: " + e3.message;
        }
      }
      const what = wasEditing ? "Bill updated" : autoSync ? "Saved" + grnNote : "Saved as draft" + grnNote;
      const full = what + (syncNote ? " — " + syncNote : ".") + (data.warning ? " (note: " + data.warning + ")" : "");
      if (syncFailed) {
        setErr(full);
        setMsg("");
      } else setMsg(full);
      clearForm(); // keeps the message above
      loadBills();
    } catch (e) {
      setErr("Save failed: " + e.message);
      setMsg("");
    } finally {
      setSaving(false);
    }
  }

  /* ---------- saved bills: load / approve / zoho / delete ---------- */
  function loadBills() {
    setLoading(true);
    fetch("/api/purchase-bills", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const list = d.bills || [];
        const js = justSaved.current;
        // the fresh bill stays on top even if the server list was read a moment too early
        setBills(js && !list.some((x) => x.id === js.id) ? [js, ...list] : list);
      })
      .catch(() => setErr("Could not load the saved bills."))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    loadBills();
  }, []);

  async function approve(b) {
    setBusyId(b.id);
    setErr("");
    setMsg("");
    try {
      const res = await fetch("/api/purchase-bills", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: b.id, status: "approved" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setErr(data.error || "Approve failed.");
      else if (data.zoho && data.zoho.ok)
        setMsg("Approved and synced to Zoho." + (data.zoho.error ? " (attachment: " + data.zoho.error + ")" : ""));
      else if (data.zoho && data.zoho.reason === "not_configured")
        setMsg("Approved. Zoho sync skipped — not configured yet.");
      else if (data.zoho && data.zoho.reason === "already_synced")
        setMsg("Approved. This bill was already in Zoho.");
      else if (data.zoho && data.zoho.reason === "failed")
        setMsg("Approved, but the Zoho sync failed — use Sync to Zoho to retry: " + (data.zoho.error || ""));
      else setMsg("Approved.");
      loadBills();
    } catch (e) {
      setErr("Approve failed: " + e.message);
    } finally {
      setBusyId("");
    }
  }

  async function syncZoho(b) {
    setBusyId(b.id);
    setErr("");
    setMsg("");
    try {
      const res = await fetch("/api/purchase-bills/zoho", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billId: b.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setErr(data.error || "Zoho sync failed.");
      else if (data.ok) setMsg("Synced to Zoho." + (data.error ? " (attachment: " + data.error + ")" : ""));
      else if (data.reason === "not_configured") setMsg("Zoho is not configured yet.");
      else if (data.reason === "already_synced") setMsg("Already in Zoho (bill " + (data.zoho_bill_id || "") + ").");
      else if (data.reason === "not_approved") setErr("Approve the bill before syncing to Zoho.");
      else setErr("Zoho sync failed: " + (data.error || ""));
      loadBills();
    } catch (e) {
      setErr("Zoho sync failed: " + e.message);
    } finally {
      setBusyId("");
    }
  }

  async function del(b) {
    if (!confirm("Delete this bill and its line items? This cannot be undone.")) return;
    setBusyId(b.id);
    setErr("");
    setMsg("");
    try {
      const res = await fetch("/api/purchase-bills?id=" + b.id, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setErr(d.error || "Delete failed.");
      } else setMsg("Deleted.");
      loadBills();
    } catch (e) {
      setErr("Delete failed: " + e.message);
    } finally {
      setBusyId("");
    }
  }

  /* ---------- editable form helpers ---------- */
  const setBillF = (k, v) =>
    setBill((b) => {
      const nb = { ...b, [k]: v };
      // GSTIN is the vendor's identity — if the user edits it away from the matched
      // value, the link is no longer valid and must be re-checked
      if (k === "vendor_gstin" && b.vendor_id) {
        const m = vm.matched;
        const still =
          m && String(m.gstin || "").toUpperCase() === String(v || "").toUpperCase().trim();
        if (!still) nb.vendor_id = "";
      }
      return nb;
    });
  const setItem = (i, k, v) => setItems((arr) => arr.map((it, j) => (j === i ? { ...it, [k]: v } : it)));
  // picking an item can preselect its brand (only when the line has no brand yet)
  function pickItem(i, id) {
    setItems((arr) =>
      arr.map((it, j) => {
        if (j !== i) return it;
        let next = { ...it, item_id: id, match_how: "" };
        const cat = id ? catalog.items.find((c) => String(c.id) === String(id)) : null;
        const ov = id ? catalog.vendorOv[id] : null;
        if (id && !it.brand_id) {
          const bt = lineDefaults(cat, ov).brand_type;
          const single = bt === "Gourmaison" || bt === "Taatsu" ? bt : "";
          if (single) {
            const b = catalog.brands.find((x) => x.brand_name === single);
            if (b) next.brand_id = String(b.id);
          }
        }
        // a freshly chosen item brings its own account / ITC / location (the reviewer can still change them)
        if (cat) {
          const brandName = (catalog.brands.find((x) => String(x.id) === String(next.brand_id)) || {}).brand_name || "";
          next = withZohoDefaults(next, cat, ov, catalog.items, brandName, true);
        }
        return next;
      })
    );
  }
  // choosing an account keeps its id and name together (the id is what Zoho needs)
  const pickAccount = (i, id) => {
    const a = catalog.accounts.find((x) => String(x.account_id) === String(id));
    setItems((arr) =>
      arr.map((it, j) => (j === i ? { ...it, account_id: id, account_name: a ? a.account_name : "" } : it))
    );
  };
  // option lists for the searchable pickers (built once per catalog, not per row)
  const itemOptions = useMemo(
    () => catalog.items.map((c) => ({ value: String(c.id), label: c.item_name })),
    [catalog.items]
  );
  const accountOptions = useMemo(
    () => catalog.accounts.map((a) => ({ value: String(a.account_id), label: a.account_name })),
    [catalog.accounts]
  );
  const vendorItemSet = useMemo(() => new Set((catalog.vendorItemIds || []).map(String)), [catalog.vendorItemIds]);
  // suggestions for this line first, then what this vendor has been bought from before, then everything
  const itemGroupsFor = (i) => {
    const sug = suggestions[i] || [];
    const sugIds = new Set(sug.map((x) => String(x.id)));
    const groups = [];
    if (sug.length)
      groups.push({
        title: "Suggested for this line",
        options: sug.map((x) => ({ value: String(x.id), label: x.item_name, hint: Math.round(x.score * 100) + "%" })),
      });
    const mine = itemOptions.filter((o) => vendorItemSet.has(o.value) && !sugIds.has(o.value));
    if (mine.length) groups.push({ title: "Bought from this vendor before", options: mine });
    groups.push({
      title: "All items",
      options: itemOptions.filter((o) => !vendorItemSet.has(o.value) && !sugIds.has(o.value)),
    });
    return groups;
  };
  const addItem = () => setItems((arr) => [...arr, { ...EMPTY_LINE }]);
  const removeItem = (i) => setItems((arr) => arr.filter((_, j) => j !== i));

  // live totals while reviewing (the server recomputes the same numbers on save)
  const totals = useMemo(() => {
    if (!bill) return null;
    const incl = bill.tax_inclusive === true;
    let sub = 0;
    let taxRaw = 0;
    for (const it of items) {
      const gross = n(it.quantity) * n(it.rate);
      const t = n(it.tax_rate) / 100;
      const base = incl ? gross / (1 + t) : gross;
      sub += base;
      taxRaw += base * t;
    }
    const subtotal = r2(sub);
    const discount =
      bill.discount_type === "%"
        ? r2((subtotal * n(bill.discount_value)) / 100)
        : bill.discount_type === "Rs"
          ? r2(n(bill.discount_value))
          : 0;
    const taxTotal = r2(bill.discount_before_tax === true && subtotal > 0 ? taxRaw * (1 - discount / subtotal) : taxRaw);
    const computed = r2(subtotal - discount + taxTotal + n(bill.other_charges) + n(bill.freight_charges));
    const mismatch =
      bill.grand_total !== "" &&
      bill.grand_total != null &&
      Math.abs(n(bill.grand_total) - computed) > 1;
    return { subtotal, taxTotal, discount, computed, mismatch };
  }, [bill, items]);

  // submission gates: vendor resolved + every line has a standard item + brand
  const vendorOk = !!(bill && bill.vendor_id);
  const zohoOn = catalog.accounts.length > 0; // off until the SQL migration + import have run
  const unresolved = bill
    ? items.filter((it) => !it.item_id || !it.brand_id || (zohoOn && (!it.account_id || !it.itc_eligibility))).length
    : 0;
  const canSave = !!(bill && vendorOk && unresolved === 0 && !saving);

  // saved-bills search (client-side over the already-loaded list)
  const billsTerm = billsQ.trim().toLowerCase();
  const shownBills = bills.filter((b) => {
    if (billsStatus !== "all" && (b.status || "draft") !== billsStatus) return false;
    if (!billsTerm) return true;
    return `${b.invoice_number || ""} ${b.grn_no || ""} ${b.vendor_name || ""} ${b.vendor_gstin || ""} ${b.cost_center || ""} ${b.status || ""}`
      .toLowerCase()
      .includes(billsTerm);
  });

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Purchase Bills</h1>
        <div className="flex flex-wrap gap-2">
          <a className={btnGhost} href="/purchase-items" data-test="classify_link">
            Manage items
          </a>
          <a className={btnGhost} href="/api/purchase-bills/export" data-test="export">
            Export approved CSV
          </a>
        </div>
      </div>

      {err && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          ⚠️ {err}
        </div>
      )}
      {msg && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
          {msg}
        </div>
      )}

      {/* 1. upload card — visible until a bill is being reviewed */}
      {!bill && (
        <section className={card}>
          <h2 className={`${title} mb-2`}>Add an invoice</h2>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => cameraRef.current.click()} className={btn}>
              📷 Camera
            </button>
            <button onClick={() => imageRef.current.click()} className={btn}>
              🖼️ Upload image
            </button>
            <button onClick={() => pdfRef.current.click()} className={btn}>
              📄 Upload PDF
            </button>
          </div>
          <input
            ref={cameraRef}
            data-test="camera"
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => onPick(e.target.files[0])}
          />
          <input
            ref={imageRef}
            data-test="image"
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => onPick(e.target.files[0])}
          />
          <input
            ref={pdfRef}
            data-test="pdf"
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => onPick(e.target.files[0])}
          />

          {file && (
            <div className="mt-3">
              <div className="rounded-xl border border-slate-200 p-2 dark:border-slate-800">
                {fileKind === "image" ? (
                  <img src={fileUrl} alt="Invoice preview" className="mx-auto max-h-[70vh] rounded-lg" />
                ) : (
                  <iframe src={fileUrl} title="Invoice preview" className="h-[70vh] w-full rounded-lg bg-white" />
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className={mute}>
                  {file.name} ({Math.round(file.size / 1024)} KB)
                </span>
                <button onClick={() => (fileKind === "pdf" ? pdfRef : imageRef).current.click()} className={btnGhost}>
                  🔁 Replace
                </button>
                <button onClick={clearForm} className={btnGhost}>
                  🗑️ Remove
                </button>
                <button onClick={extract} disabled={extracting} className={btn} data-test="extract">
                  {extracting ? "Reading…" : "✨ Extract with AI"}
                </button>
              </div>
            </div>
          )}
          {!file && (
            <p className={`${mute} mt-2`}>
              Take a photo with the camera (mobile), or upload an image / PDF. Preview, remove or replace it
              before extracting.
            </p>
          )}
        </section>
      )}

      {/* 2. editable form + original invoice side by side */}
      {bill && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section className={`${card} min-w-0`}>
            <h2 className={title}>{editingId ? "Invoice details — editing" : "Invoice details"}</h2>

            {/* vendor resolution — GSTIN match, name candidates, or create */}
            <div
              data-test="vendor_panel"
              className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/50"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">Vendor</span>
                {matchBusy && <span className={mute}>checking…</span>}
                {vm.matched && (
                  <span
                    className="inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-700"
                    data-test="vendor_matched"
                  >
                    ✅ {vm.matched.vendor_name}
                    {vm.matched.gstin ? " · GSTIN " + vm.matched.gstin : ""}
                  </span>
                )}
                {vm.matched && (
                  <button onClick={unlinkVendor} className={btnGhost}>
                    Unlink
                  </button>
                )}
                {!vm.matched && vm.checked && !matchBusy && (bill.vendor_gstin || bill.vendor_name) && (
                  <button onClick={() => runMatch(bill, items)} className={btnGhost} data-test="vendor_recheck">
                    🔎 Check vendor
                  </button>
                )}
              </div>

              {!vm.matched && vm.checked && vm.candidates.length > 0 && (
                <div className="mt-2">
                  <span className="text-xs font-medium text-amber-700">
                    Similar vendor names found — confirm the right one:
                  </span>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {vm.candidates.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => useVendor(c)}
                        className={btnGhost}
                        data-test={"vendor_candidate_" + c.id}
                      >
                        {c.vendor_name}
                        {c.gstin ? " · " + c.gstin : ""}{" "}
                        <span className="text-slate-400">({Math.round(c.score * 100)}%)</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {!vm.matched && vm.checked && !matchBusy && (bill.vendor_gstin || bill.vendor_name) && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {!vm.candidates.length && (
                    <span className="text-xs font-medium text-amber-700" data-test="vendor_nomatch">
                      No vendor match yet — check the invoice, then create the vendor.
                    </span>
                  )}
                  {!vOpen && (
                    <button onClick={openCreateVendor} className={btnGhost} data-test="vendor_create_btn">
                      ➕ Create new vendor
                    </button>
                  )}
                </div>
              )}

              {vOpen && (
                <form onSubmit={createVendor} className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <Field label="Vendor name *">
                    <input
                      data-test="vendor_new_name"
                      className={inp}
                      value={vForm.vendor_name}
                      onChange={(e) => setVForm({ ...vForm, vendor_name: e.target.value })}
                      required
                    />
                  </Field>
                  <Field label="GSTIN (optional)">
                    <input
                      data-test="vendor_new_gstin"
                      className={inp}
                      value={vForm.gstin}
                      onChange={(e) => setVForm({ ...vForm, gstin: e.target.value })}
                    />
                  </Field>
                  <Field label="Phone (optional)">
                    <input
                      data-test="vendor_new_phone"
                      className={inp}
                      value={vForm.phone}
                      onChange={(e) => setVForm({ ...vForm, phone: e.target.value })}
                    />
                  </Field>
                  <Field label="Email (optional)">
                    <input
                      data-test="vendor_new_email"
                      className={inp}
                      value={vForm.email}
                      onChange={(e) => setVForm({ ...vForm, email: e.target.value })}
                    />
                  </Field>
                  <div className="sm:col-span-2">
                    <Field label="Address (optional)">
                      <input
                        data-test="vendor_new_address"
                        className={inp}
                        value={vForm.address}
                        onChange={(e) => setVForm({ ...vForm, address: e.target.value })}
                      />
                    </Field>
                  </div>
                  <div className="flex items-end gap-2">
                    <button type="submit" disabled={vBusy} className={btn} data-test="vendor_create_save">
                      {vBusy ? "Creating…" : "Create vendor"}
                    </button>
                    <button type="button" onClick={() => setVOpen(false)} className={btnGhost}>
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Field label="Vendor name (as printed)">
                <input data-test="vendor_name" className={inp} value={bill.vendor_name} onChange={(e) => setBillF("vendor_name", e.target.value)} />
              </Field>
              <Field label="GSTIN (as printed)">
                <input data-test="vendor_gstin" className={inp} value={bill.vendor_gstin} onChange={(e) => setBillF("vendor_gstin", e.target.value)} />
              </Field>
              <Field label="Cost center (auto = brand when all lines agree)">
                <input data-test="cost_center" className={inp} value={bill.cost_center} onChange={(e) => setBillF("cost_center", e.target.value)} />
              </Field>
              <Field label="Invoice number">
                <input data-test="invoice_number" className={inp} value={bill.invoice_number} onChange={(e) => setBillF("invoice_number", e.target.value)} />
              </Field>
              <Field label="GRN No. (internal)">
                <input data-test="grn_no" className={inp + " bg-slate-50 text-slate-500"} value={bill.grn_no || ""} readOnly placeholder="Assigned automatically when you save" />
              </Field>
              <Field label="Invoice date">
                <input data-test="invoice_date" type="date" className={inp} value={bill.invoice_date} onChange={(e) => setBillF("invoice_date", e.target.value)} />
              </Field>
              <Field label="Due date">
                <input data-test="due_date" type="date" className={inp} value={bill.due_date} onChange={(e) => setBillF("due_date", e.target.value)} />
              </Field>
              <Field label="Discount type">
                <select data-test="discount_type" className={inp} value={bill.discount_type} onChange={(e) => setBillF("discount_type", e.target.value)}>
                  <option value="none">none</option>
                  <option value="%">%</option>
                  <option value="Rs">Rs</option>
                </select>
              </Field>
              <Field label="Discount value">
                <input
                  data-test="discount_value"
                  type="number"
                  step="0.01"
                  className={inp}
                  value={bill.discount_value}
                  disabled={bill.discount_type === "none"}
                  onChange={(e) => setBillF("discount_value", e.target.value)}
                />
              </Field>
              <Field label="Rates include GST?">
                <select data-test="tax_inclusive" className={inp} value={bill.tax_inclusive ? "yes" : "no"} onChange={(e) => setBillF("tax_inclusive", e.target.value === "yes")}>
                  <option value="no">No — GST is added on top</option>
                  <option value="yes">Yes — rates already include GST</option>
                </select>
              </Field>
              <Field label="Discount taken before GST?">
                <select data-test="discount_before_tax" className={inp} value={bill.discount_before_tax ? "yes" : "no"} disabled={bill.discount_type === "none"} onChange={(e) => setBillF("discount_before_tax", e.target.value === "yes")}>
                  <option value="no">No — GST on the full value</option>
                  <option value="yes">Yes — GST on the value after discount</option>
                </select>
              </Field>
              <Field label="Other charges">
                <input data-test="other_charges" type="number" step="0.01" className={inp} value={bill.other_charges} onChange={(e) => setBillF("other_charges", e.target.value)} />
              </Field>
              <Field label="Freight charges">
                <input data-test="freight_charges" type="number" step="0.01" className={inp} value={bill.freight_charges} onChange={(e) => setBillF("freight_charges", e.target.value)} />
              </Field>
              <Field label="Printed grand total">
                <input data-test="grand_total" type="number" step="0.01" className={inp} value={bill.grand_total} onChange={(e) => setBillF("grand_total", e.target.value)} />
              </Field>
              <Field label="Notes">
                <input data-test="notes" className={inp} value={bill.notes} onChange={(e) => setBillF("notes", e.target.value)} />
              </Field>
            </div>

          </section>

          <section className={`${card} min-w-0 max-lg:order-3`}>
            <h2 className={title}>Original invoice</h2>
            <div className="mt-2 rounded-xl border border-slate-200 p-2 dark:border-slate-800">
              {fileKind === "image" ? (
                <img src={fileUrl} alt="Original invoice" className="mx-auto max-h-[75vh] rounded-lg" />
              ) : fileKind === "pdf" ? (
                <iframe src={fileUrl} title="Original invoice" className="h-[75vh] w-full rounded-lg bg-white" />
              ) : (
                <div className="p-6 text-center">
                  <p className={mute}>
                    {editingId
                      ? "No original file is stored for this bill (it was saved before files were kept). Attach one below if you have it."
                      : "The original appears here after extraction."}
                  </p>
                </div>
              )}
            </div>
            {editingId && storedFile && (
              <p className={`${mute} mt-2`} data-test="stored_file_note">
                Saved original: {storedFile.name} ·{" "}
                <a href={fileUrl} target="_blank" rel="noreferrer" className="text-sky-600 underline">
                  open in a new tab ↗
                </a>
                . Attach a new image or PDF below only to replace it.
              </p>
            )}
            {editingId && (
              <div className="mt-2 flex flex-wrap gap-2">
                <button onClick={() => imageRef.current.click()} className={btnGhost}>
                  🖼️ Attach image
                </button>
                <button onClick={() => pdfRef.current.click()} className={btnGhost}>
                  📄 Attach PDF
                </button>
              </div>
            )}
          </section>

          {/* line items: full width on wide screens (13 columns need the room), under the details on phones */}
          <section className={`${card} min-w-0 lg:col-span-2 max-lg:order-2`}>
            {/* line items */}
            <h3 className={`${title} mt-4`}>Line items</h3>
            {unresolved > 0 && (
              <div
                className="mt-1 rounded-lg bg-amber-100 px-2 py-1 text-xs font-medium text-amber-700"
                data-test="unresolved_lines"
              >
                ⚠️ {unresolved} line{unresolved > 1 ? "s" : ""} still need{unresolved > 1 ? "" : "s"} a standard
                item, brand{zohoOn ? ", account and ITC" : ""} before saving.
              </div>
            )}
            <div className="mt-1 overflow-x-auto">
              <table className="w-full text-sm max-md:block">
                <thead className="max-md:hidden">
                  <tr>
                    <th className={th}>Invoice wording</th>
                    <th className={th}>Standard item</th>
                    <th className={th}>Brand</th>
                    {zohoOn && <th className={th}>Account</th>}
                    {zohoOn && <th className={th}>ITC</th>}
                    {zohoOn && <th className={th}>Location</th>}
                    <th className={th}>Qty</th>
                    <th className={th}>Unit</th>
                    <th className={th}>Rate</th>
                    <th className={th}>Tax %</th>
                    <th className={th}>Printed line total</th>
                    <th className={th}>qty×rate</th>
                    <th className={th}></th>
                  </tr>
                </thead>
                <tbody className="max-md:block">
                  {items.map((it, i) => {
                    const needItem = !it.item_id;
                    const needBrand = !it.brand_id;
                    const needAcct = zohoOn && !it.account_id;
                    const needItc = zohoOn && !it.itc_eligibility;
                    const known = catalog.items.find((c) => String(c.id) === String(it.item_id));
                    return (
                      <tr
                        key={i}
                        className={"border-t border-slate-100 dark:border-slate-800 max-md:mb-3 max-md:grid max-md:grid-cols-2 max-md:gap-x-3 max-md:gap-y-2 max-md:rounded-xl max-md:border max-md:p-3 " + (needItem || needBrand ? "bg-amber-50/60" : "")}
                        data-test="item_row"
                      >
                        <td className={`${ltd} max-md:col-span-2`} data-label="Invoice wording">
                          <input
                            data-test={"item_desc_" + i}
                            className={`${tin} w-[260px] max-md:w-full`}
                            value={it.description}
                            onChange={(e) => setItem(i, "description", e.target.value)}
                          />
                        </td>
                        <td className={`${ltd} max-md:col-span-2`} data-label="Standard item">
                          <SearchSelect
                            testId={"item_item_" + i}
                            className={(needItem ? tinWarn : tin) + " w-[260px] max-md:w-full"}
                            placeholder="— choose item —"
                            clearLabel="Clear item"
                            value={String(it.item_id || "")}
                            label={known ? known.item_name : it.item_id ? it.item_name || "(item " + it.item_id + ")" : ""}
                            groups={itemGroupsFor(i)}
                            onPick={(id) => pickItem(i, id)}
                            createLabel="Add new item"
                            onCreate={(typed) => openNewItem(i, typed)}
                          />
                          {it.match_how === "mapping" && (
                            <div className="mt-0.5 text-xs text-emerald-600" data-test={"item_how_" + i}>
                              ✓ this vendor&apos;s saved mapping
                            </div>
                          )}
                          {it.match_how === "exact" && (
                            <div className="mt-0.5 text-xs text-emerald-600" data-test={"item_how_" + i}>
                              ✓ exact name match
                            </div>
                          )}
                        </td>
                        <td className={`${ltd} max-md:col-span-2`} data-label="Brand">
                          <select
                            data-test={"item_brand_" + i}
                            className={(needBrand ? tinWarn : tin) + " w-32 max-md:w-full"}
                            value={String(it.brand_id || "")}
                            onChange={(e) => setItem(i, "brand_id", e.target.value)}
                          >
                            <option value="">— brand —</option>
                            {catalog.brands.map((b) => (
                              <option key={b.id} value={String(b.id)}>
                                {b.brand_name}
                              </option>
                            ))}
                          </select>
                          {needItem && <div className="mt-0.5 text-xs text-amber-700">item?</div>}
                          {needBrand && !needItem && <div className="mt-0.5 text-xs text-amber-700">brand?</div>}
                        </td>
                        {zohoOn && (
                          <td className={`${ltd} max-md:col-span-2`} data-label="Account (Zoho)">
                            <SearchSelect
                              testId={"item_acct_" + i}
                              className={(needAcct ? tinWarn : tin) + " w-52 max-md:w-full"}
                              placeholder="— account —"
                              value={String(it.account_id || "")}
                              label={(catalog.accounts.find((a) => String(a.account_id) === String(it.account_id)) || {}).account_name || it.account_name || (it.account_id ? "(account " + it.account_id + ")" : "")}
                              groups={[{ title: "Zoho accounts", options: accountOptions }]}
                              onPick={(id) => pickAccount(i, id)}
                            />
                          </td>
                        )}
                        {zohoOn && (
                          <td className={ltd} data-label="ITC">
                            <select
                              data-test={"item_itc_" + i}
                              className={(needItc ? tinWarn : tin) + " w-32 max-md:w-full"}
                              value={it.itc_eligibility || ""}
                              onChange={(e) => setItem(i, "itc_eligibility", e.target.value)}
                            >
                              <option value="">— ITC —</option>
                              <option value="eligible">eligible</option>
                              <option value="ineligible">ineligible</option>
                            </select>
                          </td>
                        )}
                        {zohoOn && (
                          <td className={ltd} data-label="Location (Zoho tag)">
                            <select
                              data-test={"item_loc_" + i}
                              className={tin + " w-36 max-md:w-full"}
                              value={it.location || ""}
                              onChange={(e) => setItem(i, "location", e.target.value)}
                            >
                              <option value="">— location —</option>
                              {catalog.locations.map((l) => (
                                <option key={l} value={l}>
                                  {l}
                                </option>
                              ))}
                              {it.location && !catalog.locations.includes(it.location) && <option value={it.location}>{it.location}</option>}
                            </select>
                          </td>
                        )}
                        <td className={ltd} data-label="Qty">
                          <input
                            data-test={"item_qty_" + i}
                            type="number"
                            step="0.01"
                            inputMode="decimal"
                            className={`${tin} w-24 max-md:w-full`}
                            value={it.quantity}
                            onChange={(e) => setItem(i, "quantity", e.target.value)}
                          />
                        </td>
                        <td className={ltd} data-label="Unit">
                          <input data-test={"item_unit_" + i} className={`${tin} w-20 max-md:w-full`} value={it.unit} onChange={(e) => setItem(i, "unit", e.target.value)} />
                        </td>
                        <td className={ltd} data-label="Rate">
                          <input
                            data-test={"item_rate_" + i}
                            type="number"
                            step="0.01"
                            inputMode="decimal"
                            className={`${tin} w-28 max-md:w-full`}
                            value={it.rate}
                            onChange={(e) => setItem(i, "rate", e.target.value)}
                          />
                        </td>
                        <td className={ltd} data-label="Tax %">
                          <input
                            data-test={"item_tax_" + i}
                            type="number"
                            step="0.01"
                            inputMode="decimal"
                            className={`${tin} w-20 max-md:w-full`}
                            value={it.tax_rate}
                            onChange={(e) => setItem(i, "tax_rate", e.target.value)}
                          />
                        </td>
                        <td className={ltd} data-label="Printed line total">
                          <input
                            data-test={"item_lt_" + i}
                            type="number"
                            step="0.01"
                            inputMode="decimal"
                            className={`${tin} w-28 max-md:w-full`}
                            value={it.line_total}
                            onChange={(e) => setItem(i, "line_total", e.target.value)}
                          />
                        </td>
                        <td className={`${ltd} text-right text-slate-400 max-md:text-left`} data-label="qty × rate">
                          {r2(n(it.quantity) * n(it.rate)).toLocaleString("en-IN")}
                        </td>
                        <td className={`${td} max-md:col-span-2 max-md:block max-md:px-0 max-md:text-right`}>
                          <button onClick={() => removeItem(i)} className="cursor-pointer text-rose-500 hover:underline" title="Remove line">
                            ✕
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {items.length === 0 && (
                    <tr>
                      <td className={td} colSpan={10}>
                        <span className={mute}>No line items — use “＋ Add line” below.</span>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <button onClick={addItem} className={`${btnGhost} mt-2`} data-test="add_line">
              ＋ Add line
            </button>

            {nItem && (
              <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" data-test="new_item_modal">
                <form onSubmit={createItem} className="w-full max-w-md space-y-3 rounded-2xl bg-white p-4 shadow-xl">
                  <div className="text-base font-semibold">Add a new item</div>
                  <Field label="Item name *">
                    <input
                      data-test="new_item_name"
                      className={inp}
                      value={nItem.item_name}
                      onChange={(e) => setNItem({ ...nItem, item_name: e.target.value })}
                      required
                      autoFocus
                    />
                  </Field>
                  <Field label="Brand">
                    <select data-test="new_item_brand" className={inp} value={nItem.brand_type} onChange={(e) => setNItem({ ...nItem, brand_type: e.target.value })}>
                      <option value="">— not decided —</option>
                      <option value="Gourmaison">Gourmaison</option>
                      <option value="Taatsu">Taatsu</option>
                      <option value="Both">Both</option>
                    </select>
                  </Field>
                  <Field label="Unit (optional)">
                    <input data-test="new_item_uom" className={inp} value={nItem.uom} onChange={(e) => setNItem({ ...nItem, uom: e.target.value })} placeholder="kg, pcs, box…" />
                  </Field>
                  <div className="text-xs text-slate-500">The account, ITC and location you pick on this line are remembered for the item when you save the bill.</div>
                  <div className="flex justify-end gap-2">
                    <button type="button" className={btnGhost} onClick={() => setNItem(null)}>
                      Cancel
                    </button>
                    <button type="submit" disabled={nItemBusy} className={btn} data-test="new_item_save">
                      {nItemBusy ? "Adding…" : "Add item"}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* totals + mismatch warning */}
            <div className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-sm dark:border-slate-800">
              <Row label={bill.tax_inclusive ? "Subtotal (before GST, split out of the rates)" : "Subtotal (Σ qty × rate)"} value={totals.subtotal} />
              {totals.discount > 0 && <Row label="Discount" value={-totals.discount} />}
              <Row label="Tax total (GST)" value={totals.taxTotal} />
              {n(bill.other_charges) > 0 && <Row label="Other charges" value={n(bill.other_charges)} />}
              {n(bill.freight_charges) > 0 && <Row label="Freight" value={n(bill.freight_charges)} />}
              <div className="flex justify-between font-semibold">
                <span>Computed total</span>
                <span data-test="computed_total">{fm(totals.computed)}</span>
              </div>
              {totals.mismatch && (
                <div
                  className="rounded-lg bg-amber-100 px-2 py-1 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                  data-test="mismatch"
                >
                  ⚠️ Printed grand total ({fm(n(bill.grand_total))}) differs from the computed total by{" "}
                  {fm(Math.abs(n(bill.grand_total) - totals.computed))} — check discounts and charges before
                  approving.
                </div>
              )}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={save}
                disabled={!canSave}
                className={btn}
                data-test="save"
                title={
                  !vendorOk
                    ? "Resolve the vendor first"
                    : unresolved > 0
                      ? unresolved + " line(s) need a standard item + brand"
                      : ""
                }
              >
                {saving ? "Saving…" : autoSync ? (editingId ? "💾 Save changes & sync to Zoho" : "💾 Save & sync to Zoho") : editingId ? "💾 Save changes" : "💾 Save draft"}
              </button>
              <button onClick={discard} className={btnGhost} data-test="discard">
                ↩️ Discard
              </button>
              {matchBusy && <span className={mute}>matching items…</span>}
              <label className="flex cursor-pointer items-center gap-2 text-sm" data-test="auto_sync_label">
                <input type="checkbox" data-test="auto_sync" checked={autoSync} onChange={(e) => setAutoSync(e.target.checked)} />
                Sync to Zoho when saving
              </label>
            </div>
            {bill && (!vendorOk || unresolved > 0) && (
              <p className="mt-1 text-xs font-medium text-amber-700" data-test="save_blockers">
                {!vendorOk && "Resolve the vendor above (match, pick a candidate, or create one). "}
                {unresolved > 0 && unresolved + " line(s) still need a standard item, brand" + (zohoOn ? ", account and ITC" : "") + "."}
              </p>
            )}
            <p className={`${mute} mt-2`}>
              Saving also approves the bill and sends it to Zoho. Untick “Sync to Zoho when saving” to keep it as a draft and approve it later from the list below.
            </p>
          </section>
        </div>
      )}

      {/* 3. saved bills */}
      <section className={card} ref={billsRef}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className={title}>Saved bills</h2>
            {loading && <span className={mute}>loading…</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              data-test="bills_search"
              className="w-64 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
              placeholder="Search invoice, vendor, GSTIN…"
              value={billsQ}
              onChange={(e) => setBillsQ(e.target.value)}
            />
            <select
              data-test="bills_status"
              className="w-32 cursor-pointer rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
              value={billsStatus}
              onChange={(e) => setBillsStatus(e.target.value)}
            >
              <option value="all">All statuses</option>
              <option value="draft">Draft</option>
              <option value="approved">Approved</option>
            </select>
          </div>
        </div>
        <div className="mt-2 overflow-x-auto" data-test="bills_table">
          <table className="w-full text-sm max-md:block">
            <thead className="max-md:hidden">
              <tr>
                <th className={th}>Vendor</th>
                <th className={th}>Invoice</th>
                <th className={th}>GRN No.</th>
                <th className={th}>Date</th>
                <th className={th}>Grand total</th>
                <th className={th}>Status</th>
                <th className={th}>Zoho</th>
                <th className={th}>Actions</th>
              </tr>
            </thead>
            <tbody className="max-md:block">
              {shownBills.map((b) => (
                <tr
                  key={b.id}
                  className={"border-t border-slate-100 dark:border-slate-800 max-md:mb-3 max-md:grid max-md:grid-cols-2 max-md:gap-x-3 max-md:gap-y-2 max-md:rounded-xl max-md:border max-md:p-3 " + (b.id === newBillId ? "bg-emerald-50 ring-2 ring-emerald-300" : "")}
                  data-test="bill_row"
                >
                  <td className={`${td} max-md:col-span-2 max-md:block max-md:px-0 max-md:py-0 max-md:text-base max-md:font-semibold`}>
                    {b.vendor_name || "—"}
                    <div className="text-xs text-slate-400">{b.cost_center || ""}</div>
                  </td>
                  <td className={ltd} data-label="Invoice">
                    {b.invoice_number || "—"}
                    <div className="text-xs text-slate-400">{b.vendor_gstin || ""}</div>
                  </td>
                  <td className={ltd} data-label="GRN No." data-test="bill_grn">
                    {b.grn_no ? b.grn_no : <span className="text-xs text-amber-600">no GRN</span>}
                  </td>
                  <td className={ltd} data-label="Date">{b.invoice_date || "—"}</td>
                  <td className={ltd} data-label="Grand total">{fm(b.computed_total)}</td>
                  <td className={ltd} data-label="Status">
                    <Badge t={b.status === "approved" ? "green" : "slate"}>{b.status}</Badge>
                  </td>
                  <td className={`${ltd} max-md:col-span-2`} data-label="Zoho">
                    <Badge t={ZOHO_C[b.zoho_sync_status] || "slate"}>{b.zoho_sync_status}</Badge>
                    {b.zoho_sync_error && <div className="text-xs text-rose-500">{b.zoho_sync_error.slice(0, 80)}</div>}
                  </td>
                  <td className={`${td} max-md:col-span-2 max-md:block max-md:px-0 max-md:py-0`}>
                    <div className="flex flex-wrap gap-2">
                      <button disabled={busyId === b.id} onClick={() => editBill(b)} className={btnGhost} data-test="edit">
                        ✏️ Edit
                      </button>
                      {b.status === "draft" && (
                        <button disabled={busyId === b.id} onClick={() => approve(b)} className={btnGhost} data-test="approve">
                          ✅ Approve
                        </button>
                      )}
                      {b.status === "approved" && b.zoho_sync_status !== "synced" && (
                        <button disabled={busyId === b.id} onClick={() => syncZoho(b)} className={btnGhost} data-test="sync_zoho">
                          🔄 Sync to Zoho
                        </button>
                      )}
                      <button disabled={busyId === b.id} onClick={() => del(b)} className="cursor-pointer text-rose-500 hover:underline">
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && shownBills.length === 0 && (
                <tr>
                  <td className={`${td} max-md:block`} colSpan={9}>
                    <span className={mute}>
                      {bills.length === 0
                        ? "No bills yet — upload an invoice above."
                        : "No bills match the search."}
                    </span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
