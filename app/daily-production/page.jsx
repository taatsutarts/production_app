import { supabase } from "../lib/supabase";
import DailyView from "./DailyView";

export const dynamic = "force-dynamic";

export default async function DailyProductionPage({ searchParams }) {
  const params = await searchParams;
  let date = params?.date;

  // if no date picked, use the latest date that has data
  if (!date) {
    const { data: last } = await supabase
      .from("production")
      .select("production_date")
      .order("production_date", { ascending: false })
      .limit(1);
    date = last?.[0]?.production_date || "";
  }

  let rows = [];

  if (date) {
    const { data } = await supabase
      .from("production")
      .select("production_qty, items(item_name, category)")
      .eq("production_date", date);

    rows = (data || []).map((r) => ({
      name: r.items?.item_name,
      category: r.items?.category || "OTHER",
      production: Number(r.production_qty),
    }));
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold">Daily Production</h1>

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

      <DailyView rows={rows} />
    </div>
  );
}