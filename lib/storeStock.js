// lib/storeStock.js
// Server-only. Stock for ONE outlet, for the store-login views of the
// Current Stock and Stock Trend pages (they read with the service key, so they
// must filter to the store's outlet themselves).
//
// The stores (Matunga / Bandra / Kandivali) usually have no rows in the Google
// stock sheet — their stock is what the team enters on the closing-stock page
// (stores_closing_stock). So: sheet rows for the outlet when there are any,
// else the newest closing-stock entry.
import { supabaseService as sb } from "./supabaseService";

const words = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);

// "Belgian Chocolate" -> "BELGIAN CHOCOLATE CHEESE TART" (all words contained);
// no unique match keeps the short name
function toItemName(short, tartNames) {
  const w = words(short);
  const hits = tartNames.filter((n) => {
    const nw = new Set(words(n));
    return w.every((x) => nw.has(x));
  });
  return hits.length === 1 ? hits[0] : short;
}

/* sheetStock = getStockData().stock (all outlets). Returns
 * { stock: rows for this outlet (same shape as the sheet rows), source, date } */
export async function stockForOutlet({ outletId, outletName }, sheetStock = []) {
  const mine = sheetStock.filter((r) => r.outlet === outletName);
  if (mine.length > 0) return { stock: mine, source: "sheet", date: null };
  if (!outletId) return { stock: [], source: "none", date: null };

  const { data: last } = await sb
    .from("stores_closing_stock")
    .select("stock_date")
    .eq("outlet_id", outletId)
    .order("stock_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!last) return { stock: [], source: "none", date: null };

  const [{ data: rows }, { data: tarts }] = await Promise.all([
    sb
      .from("stores_closing_stock")
      .select("item_name, qty")
      .eq("outlet_id", outletId)
      .eq("stock_date", last.stock_date),
    sb.from("items").select("item_name").eq("category", "TARTS").eq("is_active", true),
  ]);
  const tartNames = (tarts || []).map((t) => t.item_name);
  return {
    stock: (rows || []).map((r) => ({
      outlet: outletName,
      item: toItemName(r.item_name, tartNames),
      section: "Tarts",
      uom: "piece",
      qty: Number(r.qty) || 0,
    })),
    source: "closing",
    date: last.stock_date,
  };
}
