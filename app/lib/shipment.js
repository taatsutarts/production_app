import { supabase } from "./supabase";
import { getStockData } from "./stock";

export async function getShipmentData() {
  const d = await getStockData();
  if (d.error) return { error: d.error };

  const [o, s] = await Promise.all([
    supabase
      .from("outlets")
      .select(
        "name, outlet_type, fridge_capacity, cutoff_stock, weekday_avg, weekend_avg"
      )
      .neq("outlet_type", "office")
      .order("name"),
    supabase.from("item_sales_share").select("sales_pct, items(item_name)"),
  ]);

  if (o.error) return { error: o.error.message };
  if (s.error) return { error: s.error.message };

  return {
    error: "",
    dateCell: d.dateCell,
    stock: d.stock.filter((r) => r.section === "Tarts"),
    outlets: o.data || [],
    shares: (s.data || [])
      .filter((x) => x.items)
      .map((x) => ({ item: x.items.item_name, pct: Number(x.sales_pct) })),
  };
}