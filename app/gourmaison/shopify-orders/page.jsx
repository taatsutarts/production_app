"use client";

// app/orders/page.jsx  (put it wherever you want the page to live)

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase"; // <- change to wherever your Supabase client is exported

/* ---------- formatting helpers ---------- */

const pad = (n) => String(n).padStart(2, "0");

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// "2026-10-21" -> "21/10/2026"
function fmtDate(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).split("-");
  return `${d}/${m}/${y}`;
}

// "05:00PM-07:00PM" -> "5PM-7PM"   ("07:30PM" -> "7:30PM")
function fmtSlot(slot) {
  if (!slot) return "";
  return slot.replace(/\b0?(\d{1,2}):(\d{2})\s*([AP]M)/gi, (_, h, m, ap) =>
    m === "00" ? `${h}${ap.toUpperCase()}` : `${h}:${m}${ap.toUpperCase()}`
  );
}

// "7738801114" -> "+91 77388 01114"
function fmtPhone(p) {
  if (!p) return "";
  let d = String(p).replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10) return `+91 ${d.slice(0, 5)} ${d.slice(5)}`;
  return String(p);
}

const itemLine = (i) =>
  `${i.title}${i.variant ? ` - ${i.variant}` : ""} x ${i.qty}`;

// shown instead of the customer's address when an order has no address1
// (collected at the store) — keep in sync with the popup heading in addressHeading()
const PICKUP_ADDRESS = [
  "Gourmaison",
  "9/11 ground floor Vasundhara building",
  "Same building as Audi Mumbai South",
  "Tardeo, Mumbai, Maharashtra 400026",
];

function addressHeading(o) {
  return o.address1 ? "Delivery address" : "Pickup Address";
}

function addressLines(o) {
  if (!o.address1) return PICKUP_ADDRESS;
  return [
    o.ship_name || o.customer_name,
    o.address1,
    o.address2,
    [o.zip, o.city, o.province_code].filter(Boolean).join(" "),
    o.country,
    fmtPhone(o.phone),
  ].filter(Boolean);
}

function dateLine(o) {
  return fmtDate(o.delivery_date);
}

// "#7239" (Shopify order_name) -> "Website Order #7239"
function orderLabel(o) {
  return `Website Order ${o.order_name || `#${o.id}`}`;
}

// "2026-11" -> "November 2026"
function monthName(key) {
  if (!key) return "No date";
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en", { month: "long", year: "numeric" });
}

// which month an order belongs to: delivery month decides, placed month as fallback
const monthKey = (o) => String(o.delivery_date || String(o.placed_at || "").slice(0, 10)).slice(0, 7);

function buildCopyText(o) {
  const head = [orderLabel(o), o.customer_name || o.ship_name, dateLine(o), fmtSlot(o.delivery_slot)]
    .filter(Boolean)
    .join("\n");
  const items = (o.items || []).map(itemLine).join("\n");
  const address = [addressHeading(o), ...addressLines(o)].join("\n");
  return [head, items, address].filter(Boolean).join("\n\n");
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // fallback for browsers/contexts without the async clipboard API
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {}
    document.body.removeChild(ta);
    return ok;
  }
}

/* ---------- icons ---------- */

const CopyIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V6a2 2 0 0 1 2-2h9" />
  </svg>
);

const CheckIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

const CloseIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

/* ---------- page ---------- */

export default function OrdersPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [copied, setCopied] = useState(false);
  // month filter: null = current month, "YYYY-MM" = that month, "all" = everything
  const [monthSel, setMonthSel] = useState(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("shopify_orders")
      .select("*")
      .order("placed_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(200);

    if (error) setError(error.message);
    else {
      setError(null);
      setOrders(data ?? []);
    }
    setLoading(false);
  }, []);

  // initial load + live updates (new orders appear without a refresh)
  useEffect(() => {
    load();
    const channel = supabase
      .channel("orders-feed")
      .on("postgres_changes", { event: "*", schema: "public", table: "shopify_orders" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  const selected = orders.find((o) => o.id === selectedId) || null;

  // close on Escape, lock page scroll while the popup is open
  useEffect(() => {
    if (!selected) return;
    const onKey = (e) => e.key === "Escape" && setSelectedId(null);
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [selected]);

  const openOrder = (id) => {
    setCopied(false);
    setSelectedId(id);
  };

  const handleCopy = async () => {
    if (!selected) return;
    const ok = await copyToClipboard(buildCopyText(selected));
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  const today = todayISO();
  const thisMonth = today.slice(0, 7);
  const activeMonth = monthSel || thisMonth;

  // one pill per month that has orders, newest first (with order counts)
  const monthList = useMemo(() => {
    const counts = new Map();
    for (const o of orders) {
      const k = monthKey(o);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [orders]);

  // the delivery month decides (an order placed in October but delivering in
  // November still shows in November); "all" shows every month
  const visible = orders.filter((o) => (activeMonth === "all" ? true : monthKey(o) === activeMonth));

  return (
    <main className="og-page">
      <style>{css}</style>

      <header className="og-head">
        <h1>Orders</h1>
        {!loading && !error && (
          <p className="og-sub">
            {visible.length} {visible.length === 1 ? "order" : "orders"}, newest first
          </p>
        )}
        {!loading && !error && monthList.length > 0 && (
          <div className="og-months">
            {monthList.map(([k, n]) => (
              <button
                key={k || "nodate"}
                type="button"
                className={`og-pill ${activeMonth === k ? "is-active" : ""}`}
                onClick={() => setMonthSel(k)}
              >
                {monthName(k)} <span>{n}</span>
              </button>
            ))}
            <button
              type="button"
              className={`og-pill ${activeMonth === "all" ? "is-active" : ""}`}
              onClick={() => setMonthSel("all")}
            >
              All months
            </button>
          </div>
        )}
      </header>

      {loading && <p className="og-note">Loading orders…</p>}

      {error && (
        <p className="og-note og-error">
          Couldn’t load orders: {error}. Check the Supabase connection and that the
          orders table has a read policy for your login.
        </p>
      )}

      {!loading && !error && visible.length === 0 && (
        <p className="og-note">
          No orders for this month yet. New paid orders from Shopify appear here as soon as they arrive.
        </p>
      )}

      <section className="og-grid">
        {visible.map((o) => (
          <button
            key={o.id}
            type="button"
            className="og-card"
            onClick={() => openOrder(o.id)}
          >
            <span className="og-order">{orderLabel(o)}</span>
            <span className="og-name">{o.customer_name || o.ship_name || "Unnamed"}</span>
            <span className="og-date">
              {dateLine(o) || "No delivery date"}
              {fmtSlot(o.delivery_slot) && <span className="og-date-slot">{fmtSlot(o.delivery_slot)}</span>}
              {o.delivery_date === today && <em className="og-chip">Today</em>}
            </span>
            <span className="og-foot">
              <span>
                {(o.items || []).length} {(o.items || []).length === 1 ? "item" : "items"}
              </span>
              <span className="og-order-no">
                {o.is_test && <em className="og-chip og-chip-test">Test</em>}
              </span>
            </span>
          </button>
        ))}
      </section>

      {selected && (
        <div className="og-overlay" onClick={() => setSelectedId(null)}>
          <div
            className="og-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`Website Order ${selected.order_name || ""}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="og-modal-top">
              <div>
                <p className="og-modal-order">{orderLabel(selected)}</p>
                <h2>{selected.customer_name || selected.ship_name}</h2>
                <p className="og-line">{dateLine(selected)}</p>
                <p className="og-line og-line-slot">{fmtSlot(selected.delivery_slot)}</p>
              </div>
              <div className="og-actions">
                <button
                  type="button"
                  className={`og-icon-btn ${copied ? "is-done" : ""}`}
                  onClick={handleCopy}
                  aria-label="Copy order details"
                  title="Copy order details"
                >
                  {copied ? <CheckIcon /> : <CopyIcon />}
                </button>
                <button
                  type="button"
                  className="og-icon-btn"
                  onClick={() => setSelectedId(null)}
                  aria-label="Close"
                  title="Close"
                >
                  <CloseIcon />
                </button>
              </div>
            </div>

            <span className="og-live" aria-live="polite">
              {copied ? "Copied to clipboard" : ""}
            </span>

            <ul className="og-items">
              {(selected.items || []).map((i, idx) => (
                <li key={idx}>{itemLine(i)}</li>
              ))}
            </ul>

            <div className="og-address">
              <h3>{addressHeading(selected)}</h3>
              {addressLines(selected).map((l, idx) => (
                <p key={idx}>{l}</p>
              ))}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

/* ---------- styles ---------- */

const css = `
.og-page {
  --bg: #f3f4f1;
  --surface: #ffffff;
  --ink: #1c2320;
  --muted: #667069;
  --line: #dadfd9;
  --accent: #2e5b4d;
  --accent-soft: #e3ece7;
  --serif: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
  --sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;

  min-height: 100vh;
  background: var(--bg);
  color: var(--ink);
  font-family: var(--sans);
  padding: 32px 20px 64px;
}
.og-head { max-width: 1120px; margin: 0 auto 24px; }
.og-head h1 { font-family: var(--serif); font-size: 32px; font-weight: 600; margin: 0; letter-spacing: -0.01em; }
.og-sub { margin: 4px 0 0; color: var(--muted); font-size: 14px; }
.og-note { max-width: 1120px; margin: 0 auto; color: var(--muted); font-size: 15px; }
.og-error { color: #9b2c2c; }

.og-grid {
  max-width: 1120px; margin: 0 auto;
  display: grid; gap: 14px;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
}

.og-card {
  display: flex; flex-direction: column; align-items: flex-start; gap: 6px;
  text-align: left; width: 100%;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 16px 16px 14px;
  font: inherit; color: inherit; cursor: pointer;
}
.og-card:hover { border-color: var(--accent); }
.og-card:focus-visible, .og-icon-btn:focus-visible {
  outline: 2px solid var(--accent); outline-offset: 2px;
}
.og-order { font-family: var(--serif); font-size: 22px; font-weight: 600; color: var(--accent); line-height: 1.15; }
.og-name { font-size: 16px; font-weight: 600; margin-top: 2px; }
.og-date { font-size: 14px; color: var(--muted); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.og-date-slot { color: var(--accent); font-weight: 600; }
.og-foot {
  display: flex; justify-content: space-between; align-items: center; width: 100%;
  margin-top: 8px; padding-top: 10px; border-top: 1px solid var(--line);
  font-size: 13px; color: var(--muted);
}
.og-order-no { display: inline-flex; align-items: center; gap: 8px; }
.og-chip {
  font-style: normal; font-size: 12px; font-weight: 600;
  background: var(--accent-soft); color: var(--accent);
  padding: 2px 8px; border-radius: 999px;
}
.og-chip-test { background: #f1e7c9; color: #7a5d12; }

.og-months { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
.og-pill {
  font-family: var(--sans); font-size: 13px;
  padding: 7px 14px; border-radius: 999px;
  border: 1px solid var(--line); background: var(--surface); color: var(--ink); cursor: pointer;
}
.og-pill span { opacity: 0.6; }
.og-pill:hover { border-color: var(--accent); }
.og-pill.is-active { background: var(--accent); border-color: var(--accent); color: #fff; }
.og-pill.is-active span { opacity: 0.8; }

.og-overlay {
  position: fixed; inset: 0; z-index: 50;
  background: rgba(28, 35, 32, 0.45);
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
}
.og-modal {
  width: 100%; max-width: 460px; max-height: 90vh; overflow-y: auto;
  background: var(--surface); border-radius: 14px;
  padding: 24px; box-shadow: 0 20px 50px rgba(0, 0, 0, 0.25);
}
.og-modal-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
.og-modal h2 { font-family: var(--serif); font-size: 24px; font-weight: 400; margin: 0 0 6px; line-height: 1.2; }
.og-modal-order { margin: 0 0 3px; font-size: 13px; font-weight: 600; color: var(--muted); }
.og-line { margin: 0; font-size: 15px; color: var(--muted); }
.og-line-slot { color: var(--accent); font-weight: 600; }

.og-actions { display: flex; gap: 8px; flex-shrink: 0; }
.og-icon-btn {
  width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center;
  background: var(--surface); color: var(--ink);
  border: 1px solid var(--line); border-radius: 8px; cursor: pointer;
}
.og-icon-btn:hover { border-color: var(--accent); color: var(--accent); }
.og-icon-btn.is-done { background: var(--accent); border-color: var(--accent); color: #fff; }
.og-live { display: block; min-height: 18px; margin-top: 6px; text-align: right; font-size: 12px; color: var(--accent); }

.og-items { list-style: none; margin: 14px 0 0; padding: 16px 0 0; border-top: 1px solid var(--line); }
.og-items li { font-size: 15px; line-height: 1.5; padding: 2px 0; }

.og-address { margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--line); }
.og-address h3 { margin: 0 0 6px; font-size: 13px; font-weight: 600; color: var(--muted); }
.og-address p { margin: 0; font-size: 15px; line-height: 1.5; }

@media (max-width: 480px) {
  .og-page { padding: 24px 14px 48px; }
  .og-modal { padding: 20px; }
}
`;
