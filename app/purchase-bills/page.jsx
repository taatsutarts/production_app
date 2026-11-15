"use client";
// Purchase Bills: upload (camera / image / PDF) -> preview -> Gemini extraction ->
// vendor resolution (GSTIN match / name candidates / create) -> per-line standard
// item + brand matching -> editable review -> save draft (Supabase + Drive) ->
// approve -> Zoho. One client file, same card/table styling as the rest of the app.
import { useEffect, useMemo, useRef, useState } from "react";

const card = "rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900";
const title = "text-base font-semibold";
const mute = "text-sm text-slate-500 dark:text-slate-400";
const th = "px-2 py-1.5 text-left text-sm font-medium text-slate-500 dark:text-slate-400";
const td = "px-2 py-1.5";
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

const DRIVE_C = { uploaded: "green", pending: "amber", failed: "rose", not_configured: "slate" };
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
  quantity: "",
  unit: "",
  rate: "",
  tax_rate: "",
  line_total: "",
};

export default function PurchaseBills() {
  /* ---------- upload state ---------- */
  const [file, setFile] = useState(null);
  const [fileKind, setFileKind] = useState(null); // "image" | "pdf"
  const [fileUrl, setFileUrl] = useState("");
  const cameraRef = useRef(null);
  const imageRef = useRef(null);
  const pdfRef = useRef(null);

  /* ---------- extraction + editable form state ---------- */
  const [extracting, setExtracting] = useState(false);
  const [bill, setBill] = useState(null); // null = no bill being reviewed
  const [items, setItems] = useState([]);
  const [editingId, setEditingId] = useState(""); // set while editing a saved bill

  /* ---------- matching state (vendor + items + brands, all server-side) ---------- */
  const [catalog, setCatalog] = useState({ items: [], brands: [] });
  const [vm, setVm] = useState({ checked: false, matched: null, candidates: [] }); // vendor match
  const [suggestions, setSuggestions] = useState({}); // line index -> [ { id, item_name, score } ]
  const [matchBusy, setMatchBusy] = useState(false);
  const [vOpen, setVOpen] = useState(false); // create-vendor form open
  const [vForm, setVForm] = useState({ vendor_name: "", gstin: "", phone: "", email: "", address: "" });
  const [vBusy, setVBusy] = useState(false);

  /* ---------- saved bills ---------- */
  const [bills, setBills] = useState([]);
  const [billsQ, setBillsQ] = useState(""); // client-side search over the saved list
  const [billsStatus, setBillsStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState("");

  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  /* ---------- pick / remove / replace a file ---------- */
  function onPick(f) {
    if (!f) return;
    const kind =
      f.type === "application/pdf" ? "pdf" : f.type && f.type.startsWith("image/") ? "image" : null;
    if (!kind) {
      setErr("Please choose an image or a PDF.");
      return;
    }
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    setErr("");
    setMsg("");
    if (!editingId) setBill(null); // a new file starts a fresh review — except while editing
    setItems([]);
    setFile(f);
    setFileKind(kind);
    setFileUrl(URL.createObjectURL(f));
  }

  function clearForm() {
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    setFile(null);
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
      setCatalog({ items: data.items || [], brands: data.brands || [] });
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
          if (item_id && !brand_id) {
            const cat = (data.items || []).find((c) => String(c.id) === String(item_id));
            if (cat && (cat.brand_type === "Gourmaison" || cat.brand_type === "Taatsu")) {
              brand_id = brandIdByName[cat.brand_type] || "";
            } else if (brandIdByName[(it.cost_center || "").trim()]) {
              brand_id = brandIdByName[(it.cost_center || "").trim()];
            }
          }
          return { ...it, item_id, brand_id, match_how };
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
        setErr(data.error || "Extraction failed (" + res.status + ").");
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
        invoice_date: d.invoice_date || "",
        due_date: d.due_date || "",
        discount_type: d.discount_type || "none",
        discount_value: d.discount_value == null ? "" : d.discount_value,
        other_charges: d.other_charges ?? 0,
        freight_charges: d.freight_charges ?? 0,
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
      setFile(null);
      setFileKind(null);
      setFileUrl("");
      setEditingId(b.id);
      const draft = {
        vendor_id: (data.bill.vendor && data.bill.vendor.id) ? String(data.bill.vendor.id) : "",
        vendor_name: data.bill.vendor_name || "",
        vendor_gstin: data.bill.vendor_gstin || "",
        cost_center: data.bill.cost_center || "",
        invoice_number: data.bill.invoice_number || "",
        invoice_date: data.bill.invoice_date || "",
        due_date: data.bill.due_date || "",
        discount_type: data.bill.discount_type || "none",
        discount_value: data.bill.discount_value == null ? "" : data.bill.discount_value,
        other_charges: data.bill.other_charges ?? 0,
        freight_charges: data.bill.freight_charges ?? 0,
        grand_total: data.bill.grand_total == null ? "" : data.bill.grand_total,
        notes: data.bill.notes || "",
      };
      const loaded = (data.items || []).map((it) => ({
        ...EMPTY_LINE,
        description: it.description || "",
        cost_center: it.cost_center || "",
        item_id: it.item_id ? String(it.item_id) : it.item && it.item.id ? String(it.item.id) : "",
        brand_id: it.brand_id ? String(it.brand_id) : it.brand && it.brand.id ? String(it.brand.id) : "",
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

  /* ---------- save draft (Supabase + Drive) ---------- */
  const brandNameOf = (id) => {
    const b = catalog.brands.find((x) => String(x.id) === String(id));
    return b ? b.brand_name : "";
  };
  // when every line agrees on one brand, that brand becomes the bill's cost center
  // (reports / Drive folders) — otherwise keep whatever is already there
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
      // the original file goes along as base64 so the server can upload it to Drive
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
        setErr(data.message || data.error || "Save failed.");
        setMsg("");
        return;
      }
      if (editingId) {
        if (data.warning) setMsg("Bill updated — but: " + data.warning);
        else setMsg("Bill updated.");
      } else {
        if (data.warning) setMsg("Saved as draft — but: " + data.warning);
        else if (data.bill && data.bill.drive_status === "not_configured")
          setMsg("Saved as draft. Original not uploaded — Google Drive is not configured yet.");
        else setMsg("Saved as draft.");
      }
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
    fetch("/api/purchase-bills")
      .then((r) => r.json())
      .then((d) => setBills(d.bills || []))
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
        const next = { ...it, item_id: id, match_how: "" };
        if (id && !it.brand_id) {
          const cat = catalog.items.find((c) => String(c.id) === String(id));
          const single = cat && (cat.brand_type === "Gourmaison" || cat.brand_type === "Taatsu") ? cat.brand_type : "";
          if (single) {
            const b = catalog.brands.find((x) => x.brand_name === single);
            if (b) next.brand_id = String(b.id);
          }
        }
        return next;
      })
    );
  }
  const addItem = () => setItems((arr) => [...arr, { ...EMPTY_LINE }]);
  const removeItem = (i) => setItems((arr) => arr.filter((_, j) => j !== i));

  // live totals while reviewing (the server recomputes the same numbers on save)
  const totals = useMemo(() => {
    if (!bill) return null;
    const subtotal = r2(items.reduce((a, it) => a + n(it.quantity) * n(it.rate), 0));
    const taxTotal = r2(
      items.reduce((a, it) => a + (n(it.quantity) * n(it.rate) * n(it.tax_rate)) / 100, 0)
    );
    const discount =
      bill.discount_type === "%"
        ? r2((subtotal * n(bill.discount_value)) / 100)
        : bill.discount_type === "Rs"
          ? r2(n(bill.discount_value))
          : 0;
    const computed = r2(subtotal - discount + taxTotal + n(bill.other_charges) + n(bill.freight_charges));
    const mismatch =
      bill.grand_total !== "" &&
      bill.grand_total != null &&
      Math.abs(n(bill.grand_total) - computed) > 1;
    return { subtotal, taxTotal, discount, computed, mismatch };
  }, [bill, items]);

  // submission gates: vendor resolved + every line has a standard item + brand
  const vendorOk = !!(bill && bill.vendor_id);
  const unresolved = bill ? items.filter((it) => !it.item_id || !it.brand_id).length : 0;
  const canSave = !!(bill && vendorOk && unresolved === 0 && !saving);

  // saved-bills search (client-side over the already-loaded list)
  const billsTerm = billsQ.trim().toLowerCase();
  const shownBills = bills.filter((b) => {
    if (billsStatus !== "all" && (b.status || "draft") !== billsStatus) return false;
    if (!billsTerm) return true;
    return `${b.invoice_number || ""} ${b.vendor_name || ""} ${b.vendor_gstin || ""} ${b.cost_center || ""} ${b.status || ""}`
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
        <div className="grid gap-4 lg:grid-cols-2">
          <section className={card}>
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

            {/* line items */}
            <h3 className={`${title} mt-4`}>Line items</h3>
            {unresolved > 0 && (
              <div
                className="mt-1 rounded-lg bg-amber-100 px-2 py-1 text-xs font-medium text-amber-700"
                data-test="unresolved_lines"
              >
                ⚠️ {unresolved} line{unresolved > 1 ? "s" : ""} still need{unresolved > 1 ? "" : "s"} a standard
                item and/or a brand before saving.
              </div>
            )}
            <div className="mt-1 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className={th}>Invoice wording</th>
                    <th className={th}>Standard item</th>
                    <th className={th}>Brand</th>
                    <th className={th}>Qty</th>
                    <th className={th}>Unit</th>
                    <th className={th}>Rate</th>
                    <th className={th}>Tax %</th>
                    <th className={th}>Printed line total</th>
                    <th className={th}>qty×rate</th>
                    <th className={th}></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => {
                    const needItem = !it.item_id;
                    const needBrand = !it.brand_id;
                    const known = catalog.items.find((c) => String(c.id) === String(it.item_id));
                    return (
                      <tr
                        key={i}
                        className={"border-t border-slate-100 dark:border-slate-800 " + (needItem || needBrand ? "bg-amber-50/60" : "")}
                        data-test="item_row"
                      >
                        <td className={td}>
                          <input
                            data-test={"item_desc_" + i}
                            className={`${tin} w-[260px]`}
                            value={it.description}
                            onChange={(e) => setItem(i, "description", e.target.value)}
                          />
                        </td>
                        <td className={td}>
                          <select
                            data-test={"item_item_" + i}
                            className={(needItem ? tinWarn : tin) + " w-[260px]"}
                            value={String(it.item_id || "")}
                            onChange={(e) => pickItem(i, e.target.value)}
                          >
                            <option value="">— choose item —</option>
                            {(suggestions[i] || []).length > 0 && (
                              <optgroup label="Suggested for this line">
                                {(suggestions[i] || []).map((s) => (
                                  <option key={"sug_" + s.id} value={String(s.id)}>
                                    {s.item_name} ({Math.round(s.score * 100)}%)
                                  </option>
                                ))}
                              </optgroup>
                            )}
                            <optgroup label="All items">
                              {catalog.items.map((c) => (
                                <option key={c.id} value={String(c.id)}>
                                  {c.item_name}
                                </option>
                              ))}
                            </optgroup>
                            {it.item_id && !known && (
                              <option value={String(it.item_id)}>{it.item_name || "(item " + it.item_id + ")"}</option>
                            )}
                          </select>
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
                        <td className={td}>
                          <select
                            data-test={"item_brand_" + i}
                            className={(needBrand ? tinWarn : tin) + " w-32"}
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
                        <td className={td}>
                          <input
                            data-test={"item_qty_" + i}
                            type="number"
                            step="0.01"
                            inputMode="decimal"
                            className={`${tin} w-24`}
                            value={it.quantity}
                            onChange={(e) => setItem(i, "quantity", e.target.value)}
                          />
                        </td>
                        <td className={td}>
                          <input data-test={"item_unit_" + i} className={`${tin} w-20`} value={it.unit} onChange={(e) => setItem(i, "unit", e.target.value)} />
                        </td>
                        <td className={td}>
                          <input
                            data-test={"item_rate_" + i}
                            type="number"
                            step="0.01"
                            inputMode="decimal"
                            className={`${tin} w-28`}
                            value={it.rate}
                            onChange={(e) => setItem(i, "rate", e.target.value)}
                          />
                        </td>
                        <td className={td}>
                          <input
                            data-test={"item_tax_" + i}
                            type="number"
                            step="0.01"
                            inputMode="decimal"
                            className={`${tin} w-20`}
                            value={it.tax_rate}
                            onChange={(e) => setItem(i, "tax_rate", e.target.value)}
                          />
                        </td>
                        <td className={td}>
                          <input
                            data-test={"item_lt_" + i}
                            type="number"
                            step="0.01"
                            inputMode="decimal"
                            className={`${tin} w-28`}
                            value={it.line_total}
                            onChange={(e) => setItem(i, "line_total", e.target.value)}
                          />
                        </td>
                        <td className={`${td} text-right text-slate-400`}>
                          {r2(n(it.quantity) * n(it.rate)).toLocaleString("en-IN")}
                        </td>
                        <td className={td}>
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

            {/* totals + mismatch warning */}
            <div className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-sm dark:border-slate-800">
              <Row label="Subtotal (Σ qty × rate)" value={totals.subtotal} />
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
                {saving ? "Saving…" : editingId ? "💾 Save changes" : "💾 Save draft"}
              </button>
              <button onClick={discard} className={btnGhost} data-test="discard">
                ↩️ Discard
              </button>
              {matchBusy && <span className={mute}>matching items…</span>}
            </div>
            {bill && (!vendorOk || unresolved > 0) && (
              <p className="mt-1 text-xs font-medium text-amber-700" data-test="save_blockers">
                {!vendorOk && "Resolve the vendor above (match, pick a candidate, or create one). "}
                {unresolved > 0 && unresolved + " line(s) still need a standard item and/or brand."}
              </p>
            )}
            <p className={`${mute} mt-2`}>
              Nothing is submitted automatically — review, save as draft, then approve from the list below.
            </p>
          </section>

          <section className={card}>
            <h2 className={title}>Original invoice</h2>
            <div className="mt-2 rounded-xl border border-slate-200 p-2 dark:border-slate-800">
              {fileKind === "image" ? (
                <img src={fileUrl} alt="Original invoice" className="mx-auto max-h-[75vh] rounded-lg" />
              ) : fileKind === "pdf" ? (
                <iframe src={fileUrl} title="Original invoice" className="h-[75vh] w-full rounded-lg bg-white" />
              ) : (
                <div className="p-6 text-center">
                  <p className={mute}>
                    {editingId ? "No new file attached for this edit." : "The original appears here after extraction."}
                  </p>
                  {editingId && bill.drive_file_link && (
                    <a href={bill.drive_file_link} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm text-sky-600 underline">
                      Open original in Drive ↗
                    </a>
                  )}
                </div>
              )}
            </div>
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
        </div>
      )}

      {/* 3. saved bills */}
      <section className={card}>
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
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={th}>Vendor</th>
                <th className={th}>Invoice</th>
                <th className={th}>Date</th>
                <th className={th}>Grand total</th>
                <th className={th}>Status</th>
                <th className={th}>Drive</th>
                <th className={th}>Zoho</th>
                <th className={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {shownBills.map((b) => (
                <tr key={b.id} className="border-t border-slate-100 dark:border-slate-800" data-test="bill_row">
                  <td className={td}>
                    {b.vendor_name || "—"}
                    <div className="text-xs text-slate-400">{b.cost_center || ""}</div>
                  </td>
                  <td className={td}>
                    {b.invoice_number || "—"}
                    <div className="text-xs text-slate-400">{b.vendor_gstin || ""}</div>
                  </td>
                  <td className={td}>{b.invoice_date || "—"}</td>
                  <td className={td}>{fm(b.computed_total)}</td>
                  <td className={td}>
                    <Badge t={b.status === "approved" ? "green" : "slate"}>{b.status}</Badge>
                  </td>
                  <td className={td}>
                    <Badge t={DRIVE_C[b.drive_status] || "slate"}>{b.drive_status}</Badge>
                    {b.drive_file_link && (
                      <a href={b.drive_file_link} target="_blank" rel="noreferrer" className="ml-1 text-xs text-sky-600 underline">
                        file
                      </a>
                    )}
                    {b.drive_error && <div className="text-xs text-rose-500">{b.drive_error.slice(0, 80)}</div>}
                  </td>
                  <td className={td}>
                    <Badge t={ZOHO_C[b.zoho_sync_status] || "slate"}>{b.zoho_sync_status}</Badge>
                    {b.zoho_sync_error && <div className="text-xs text-rose-500">{b.zoho_sync_error.slice(0, 80)}</div>}
                  </td>
                  <td className={td}>
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
                  <td className={td} colSpan={8}>
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
