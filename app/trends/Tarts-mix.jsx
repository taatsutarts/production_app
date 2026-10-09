import { supabase } from "../lib/supabase";

export const dynamic = "force-dynamic";

function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export default async function TartMixPage({ searchParams }) {
  const params = await searchParams;
  let from = params?.from;
  let to = params?.to;

  // default: last 7 days, ending at the latest date with data
  if (!to) {
    const { data: last } = await supabase
      .from("production")
      .select("production_date")
      .order("production_date", { ascending: false })
      .limit(1);
    to = last?.[0]?.production_date || "";
  }
  if (!from && to) from = addDays(to, -6);

  // load tart production in the range (1000 rows at a time)
  let all = [];
  if (from && to) {
    let start = 0;
    while (true) {
      const { data } = await supabase
        .from("production")
        .select("production_qty, items!inner(item_name, category)")
        .eq("items.category", "TARTS")
        .gte("production_date", from)
        .lte("production_date", to)
        .range(start, start + 999);
      if (!data || data.length === 0) break;
      all = all.concat(data);
      if (data.length < 1000) break;
      start += 1000;
    }
  }

  // add up qty per tart
  const totals = {};
  all.forEach((r) => {
    const name = r.items?.item_name;
    totals[name] = (totals[name] || 0) + Number(r.production_qty);
  });

  const grand = Object.values(totals).reduce((s, v) => s + v, 0);

  const list = Object.keys(totals)
    .map((name) => ({
      name,
      qty: totals[name],
      pct: grand ? (totals[name] / grand) * 100 : 0,
    }))
    .sort((a, b) => b.qty - a.qty);

  const topPct = list[0]?.pct || 1;

  return (
    <div className="mx-auto max-w-3xl mb-[100px]">
      <h1 className="text-2xl font-bold">Tart Production %</h1>
      <p className="mt-1 text-sm text-slate-500">
        Share of each tart in total tart production
      </p>

      {/* Date range */}
      <form method="get" className="mt-4 flex flex-wrap items-center gap-2">
        <input
          type="date"
          name="from"
          defaultValue={from}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
        />
        <span className="text-sm text-slate-400">to</span>
        <input
          type="date"
          name="to"
          defaultValue={to}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Show
        </button>
      </form>

      {list.length === 0 && (
        <p className="mt-6 text-slate-500">No tart production in this range.</p>
      )}

      {list.length > 0 && (
        <div className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="grid grid-cols-[1fr_auto_auto] gap-4 bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-600">
            <span>Tart</span>
            <span className="w-16 text-right">Qty</span>
            <span className="w-16 text-right">Share</span>
          </div>

          {list.map((t, i) => (
            <div key={t.name} className="border-t border-slate-100 px-4 py-2.5">
              <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 text-sm">
                <span className="truncate">
                  <span className="mr-2 text-slate-400">{i + 1}</span>
                  {t.name}
                </span>
                <span className="w-16 text-right">{t.qty}</span>
                <span className="w-16 text-right font-semibold">
                  {t.pct.toFixed(1)}%
                </span>
              </div>
              <div className="mt-1.5 h-2 rounded bg-slate-100">
                <div
                  className="h-2 rounded bg-blue-500"
                  style={{ width: (t.pct / topPct) * 100 + "%" }}
                />
              </div>
            </div>
          ))}

          <div className="grid grid-cols-[1fr_auto_auto] gap-4 border-t-2 border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold">
            <span>Total tarts</span>
            <span className="w-16 text-right">{grand}</span>
            <span className="w-16 text-right">100%</span>
          </div>
        </div>
      )}
    </div>
  );
}