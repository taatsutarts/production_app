import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY // server-only
);

export const PO_CATEGORIES = ["Garnishing", "Packaging", "Beverages", "Dairy"];

export async function getPurchaseItems() {
  const { data, error } = await supabase
    .from("purchase_items")
    .select("id, item_name, uom, uom_size, category, status")
    .eq("status", "Active")
    .in("category", PO_CATEGORIES)
    .order("item_name");

  if (error) return { items: [], error: error.message };

  // strip the "#_# " prefix and " - Taatsu" suffix only for display;
  // `name` stays the exact DB name so the dispatch API can match it
  const items = data.map((r) => ({
    name: r.item_name,
    label: r.item_name.replace(/^#_#\s*/, "").replace(/\s*-\s*Taatsu$/i, ""),
    category: r.category,
    uom: Number(r.uom_size) > 1 ? `${Number(r.uom_size)} ${r.uom}` : r.uom,
  }));
  return { items, error: null };
}