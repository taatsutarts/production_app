import { supabase } from "../lib/supabase";
import TrendView from "./TrendView";

export const dynamic = "force-dynamic";

export default async function TrendsPage() {
  // load the last 90 days of production
  const from = new Date();
  from.setDate(from.getDate() - 90);
  const fromDate = from.toISOString().slice(0, 10);

  // Supabase returns 1000 rows at a time, so load in pages
  let all = [];
  let start = 0;
  while (true) {
    const { data } = await supabase
      .from("production")
      .select("production_date, production_qty, items(item_name, category)")
      .gte("production_date", fromDate)
      .order("production_date")
      .order("id")
      .range(start, start + 999);
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < 1000) break;
    start += 1000;
  }

  const rows = all.map((r) => ({
    date: r.production_date,
    name: r.items?.item_name,
    category: r.items?.category || "OTHER",
    production: Number(r.production_qty),
  }));

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold">Production Trends</h1>
      <TrendView rows={rows} />
    </div>
  );
}