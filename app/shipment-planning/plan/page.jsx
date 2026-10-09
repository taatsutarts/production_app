import { supabase } from "../../lib/supabase";
import { getShipmentData } from "../../lib/shipment";
import PlanView from "./PlanView";

export const dynamic = "force-dynamic";

export default async function PlanPage({ searchParams }) {
  const params = await searchParams;
  const d = await getShipmentData();

  if (d.error) {
    return (
      <div className="w-full">
        <h1 className="text-2xl font-bold">Plan Shipment</h1>
        <p className="mt-6 text-red-600">{d.error}</p>
      </div>
    );
  }

  // if no date picked, use the latest date that has data
  let date = params?.date;
  if (!date) {
    const { data: lp } = await supabase
      .from("production")
      .select("production_date")
      .order("production_date", { ascending: false })
      .limit(1);
    const { data: lo } = await supabase
      .from("physical_opening")
      .select("opening_date")
      .order("opening_date", { ascending: false })
      .limit(1);
    const dates = [lp?.[0]?.production_date, lo?.[0]?.opening_date].filter(
      Boolean
    );
    date = dates.sort().reverse()[0] || "";
  }

  // all active tart flavours
  const { data: tartItems } = await supabase
    .from("items")
    .select("id, item_name")
    .eq("category", "TARTS")
    .eq("is_active", true) // <- the only change
    .order("id");

  const map = {};
  (tartItems || []).forEach((i) => {
    map[i.id] = { item: i.item_name, opening: 0, production: 0 };
  });

  // CK stock = physical opening + production on that date
  if (date) {
    const [p, o] = await Promise.all([
      supabase
        .from("production")
        .select("item_id, production_qty")
        .eq("production_date", date),
      supabase
        .from("physical_opening")
        .select("item_id, opening_qty")
        .eq("opening_date", date),
    ]);
    (p.data || []).forEach((r) => {
      if (map[r.item_id]) map[r.item_id].production += Number(r.production_qty);
    });
    (o.data || []).forEach((r) => {
      if (map[r.item_id]) map[r.item_id].opening += Number(r.opening_qty);
    });
  }

  const items = Object.values(map)
    .map((x) => ({ item: x.item, ck: x.opening + x.production }))
    .sort((a, b) => b.ck - a.ck);

  return (
    <div className="w-full">
      <h1 className="text-2xl font-bold">Plan Shipment</h1>
      <p className="mt-1 text-sm text-slate-500">
        CK stock is opening + production. Outlet stock is live from the Google
        Sheet{d.dateCell ? " · as on " + d.dateCell : ""}.
      </p>

      <form method="get" className="mt-4 flex items-end gap-2">
        <div>
          <label className="text-xs font-semibold text-slate-500">
            CK stock date
          </label>
          <input
            type="date"
            name="date"
            defaultValue={date}
            className="mt-1 block rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Show
        </button>
      </form>

      <PlanView
        items={items}
        outlets={d.outlets}
        stock={d.stock}
        shares={d.shares}
      />
    </div>
  );
}