/* Shared bits for the closing-stock pages (overview + per-store routes).
 *
 * The stores' closing stock lives in the `stores_closing_stock` table
 * (supabase_migration_planner_v8.sql): one row per store × item × day, upserted
 * on save. The shipment planner reads the newest entry at or before its dispatch
 * date from that table (planner/outletStock.js) — no hardcoded stock anywhere.
 */

import { supabase } from "@/lib/supabaseBrowser";
import { FL } from "../planner/planner";

// planner flavour names without the seasonal "*" marker (so the planner's
// name matching is exact)
export const ITEMS = FL.map((f) => f[0].replace(/\*$/, ""));

// "DN Nagar" -> "dn-nagar" — the per-store route segment (/closing-stock/dn-nagar)
export const slugify = (name) =>
  (name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export const today = () => new Date().toLocaleDateString("en-CA");
export const yesterday = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString("en-CA");
};

// the active rows of the outlets table that report closing stock (outlet_type = store)
export function fetchActiveStores() {
  return supabase
    .from("outlets")
    .select("id,name")
    .eq("outlet_type", "store")
    .eq("is_active", true)
    .order("id");
}

/* ---------- shared styles + Badge (same family as the other pages) ---------- */

export const card = "rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900";
export const title = "text-base font-semibold";
export const mute = "text-sm text-slate-500 dark:text-slate-400";
export const th = "px-2 py-1.5 text-left text-sm font-medium text-slate-500 dark:text-slate-400";
export const td = "px-2 py-1.5";
export const row = "border-t border-slate-100 dark:border-slate-800";
export const cell =
  "w-20 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-right text-sm tabular-nums outline-none focus:border-slate-400 focus:bg-white dark:border-slate-700 dark:bg-slate-800 dark:focus:bg-slate-900";

const TONE = {
  red: "bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  amber: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  green: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
};
export const Badge = ({ t, children }) => (
  <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-sm font-medium ${TONE[t]}`}>{children}</span>
);
