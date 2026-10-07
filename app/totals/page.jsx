import { supabase } from "../lib/supabase";
import TotalsView from "./TotalsView";

export const dynamic = "force-dynamic";

export default async function TotalsPage({ searchParams }) {
  const params = await searchParams;
  let date = params?.date;

  // if no date picked, use the latest date that has data
  if (!date) {
    const { data: lastProd } = await supabase
      .from("production")
      .select("production_date")
      .order("production_date", { ascending: false })
      .limit(1);
    const { data: lastOpen } = await supabase
      .from("physical_opening")
      .select("opening_date")
      .order("opening_date", { ascending: false })
      .limit(1);
    const dates = [
      lastProd?.[0]?.production_date,
      lastOpen?.[0]?.opening_date,
    ].filter(Boolean);
    date = dates.sort().reverse()[0] || "";
  }

  let prod = [];
  let open = [];

  if (date) {
    const p = await supabase
      .from("production")
      .select("item_id, production_qty, items(item_name, category)")
      .eq("production_date", date);
    const o = await supabase
      .from("physical_opening")
      .select("item_id, opening_qty, items(item_name, category)")
      .eq("opening_date", date);
    prod = p.data || [];
    open = o.data || [];
  }

  // combine opening + production per item
  const map = {};

  open.forEach((o) => {
    map[o.item_id] = map[o.item_id] || {
      name: o.items?.item_name,
      category: o.items?.category || "OTHER",
      opening: 0,
      production: 0,
    };
    map[o.item_id].opening += Number(o.opening_qty);
  });

  prod.forEach((p) => {
    map[p.item_id] = map[p.item_id] || {
      name: p.items?.item_name,
      category: p.items?.category || "OTHER",
      opening: 0,
      production: 0,
    };
    map[p.item_id].production += Number(p.production_qty);
  });

  const rows = Object.values(map);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold">Opening + Production</h1>

      <form method="get" className="mt-4 flex items-center gap-2">
        <input
          type="date"
          name="date"
          defaultValue={date}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Show
        </button>
      </form>

      <TotalsView rows={rows} />
    </div>
  );
}