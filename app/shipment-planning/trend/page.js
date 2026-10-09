import Link from "next/link";
import { getShipmentData } from "../../lib/shipment";

export const dynamic = "force-dynamic";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// the two top sellers, and the stock level below which they turn red
const BELGIAN = "BELGIAN CHOCOLATE CHEESE TART";
const VANILLA = "TTS ORIGINAL VANILLA CHEESECAKE TART";
const LOW = 60;

// "09/10/2026" (dd/mm/yyyy) -> date. Falls back to today.
function parseDate(s) {
  const m = (s || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  const n = new Date();
  return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()));
}
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const ddmm = (d) =>
  String(d.getUTCDate()).padStart(2, "0") +
  "/" +
  String(d.getUTCMonth() + 1).padStart(2, "0");
const r1 = (n) => Math.round(n * 10) / 10;

function status(sendIn) {
  if (sendIn === 0)
    return { text: "SEND TODAY", cls: "bg-red-100 text-red-700" };
  if (sendIn === null)
    return { text: "Not needed (7+ days)", cls: "bg-green-100 text-green-700" };
  if (sendIn <= 2)
    return { text: "Send within 2 days", cls: "bg-orange-100 text-orange-700" };
  return { text: "Later this week", cls: "bg-yellow-100 text-yellow-700" };
}

export default async function TrendPage() {
  const d = await getShipmentData();

  if (d.error) {
    return (
      <div className="w-full">
        <h1 className="text-2xl font-bold">Outlet Stock Trend</h1>
        <p className="mt-6 text-red-600">{d.error}</p>
      </div>
    );
  }

  const start = parseDate(d.dateCell);
  const dates = [1, 2, 3, 4, 5, 6, 7].map((k) => addDays(start, k));

  const rows = d.outlets.map((o) => {
    const mine = d.stock.filter((r) => r.outlet === o.name);
    const current = mine.reduce((s, r) => s + r.qty, 0);
    const cutoff = Number(o.cutoff_stock);
    const wd = Number(o.weekday_avg);
    const we = Number(o.weekend_avg);

    if (mine.length === 0 || !cutoff) return { name: o.name, noData: true };

    // stock of the two top sellers
    const belgian = mine
      .filter((r) => r.item === BELGIAN)
      .reduce((s, r) => s + r.qty, 0);
    const vanilla = mine
      .filter((r) => r.item === VANILLA)
      .reduce((s, r) => s + r.qty, 0);

    // projected stock for the next 7 days
    let level = current;
    const levels = dates.map((dt) => {
      const dow = dt.getUTCDay();
      level -= dow === 0 || dow === 6 ? we : wd;
      return level;
    });

    // first day the stock goes below the cut-off
    let sendIn = null;
    let atLevel = current;
    if (current < cutoff) {
      sendIn = 0;
    } else {
      const k = levels.findIndex((l) => l < cutoff);
      if (k !== -1) {
        sendIn = k + 1;
        atLevel = levels[k];
      }
    }

    return {
      name: o.name,
      current,
      belgian,
      vanilla,
      cutoff,
      levels,
      sendIn,
      sendBy: sendIn === null ? null : addDays(start, sendIn),
      shortfall: sendIn === null ? 0 : r1(cutoff - atLevel),
      margin: current - cutoff,
    };
  });

  const ranked = rows
    .filter((r) => !r.noData)
    .sort((a, b) => {
      if (a.sendIn !== null && b.sendIn !== null)
        return a.sendIn - b.sendIn || b.shortfall - a.shortfall;
      if (a.sendIn !== null) return -1;
      if (b.sendIn !== null) return 1;
      return a.margin - b.margin;
    });
  const noData = rows.filter((r) => r.noData);

  const today = ranked.filter((r) => r.sendIn === 0).length;
  const soon = ranked.filter(
    (r) => r.sendIn !== null && r.sendIn >= 1 && r.sendIn <= 2
  ).length;
  const later = ranked.filter((r) => r.sendIn !== null && r.sendIn > 2).length;

  const lowCell = (v) =>
    v < LOW ? "bg-red-50 font-medium text-red-600" : "";

  return (
    <div className="w-full">
      <h1 className="text-2xl font-bold">Outlet Stock Trend</h1>
      <p className="mt-1 text-sm text-slate-500">
        Tart stock per outlet for the next 7 days, using each outlet's average
        daily sales. Stock as on {ddmm(start)}. Red means below the cut-off.
        Belgian and Vanilla turn red below {LOW}.
      </p>

      <div className="mt-4 flex flex-wrap gap-2 text-xs font-medium">
        <span className="rounded-full bg-red-100 px-3 py-1 text-red-700">
          Send today: {today}
        </span>
        <span className="rounded-full bg-orange-100 px-3 py-1 text-orange-700">
          Within 2 days: {soon}
        </span>
        <span className="rounded-full bg-yellow-100 px-3 py-1 text-yellow-700">
          Later this week: {later}
        </span>
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th className="px-2 py-2">#</th>
              <th className="px-2 py-2">Outlet</th>
              <th className="px-2 py-2 text-right">Stock</th>
              <th className="px-2 py-2 text-right leading-tight">Belgian</th>
              <th className="px-2 py-2 text-right leading-tight">Vanilla</th>
              <th className="px-2 py-2 text-right">Cut-off</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2">Send by</th>
              <th className="px-2 py-2 text-right">Days</th>
              <th className="px-2 py-2 text-right">Shortfall</th>
              {dates.map((dt) => (
                <th
                  key={dt.getTime()}
                  className="px-2 py-2 text-right leading-tight"
                >
                  {DAYS[dt.getUTCDay()]}
                  <br />
                  {ddmm(dt)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ranked.map((r, i) => {
              const st = status(r.sendIn);
              return (
                <tr key={r.name} className="border-t border-slate-100">
                  <td className="px-2 py-2 text-slate-400">{i + 1}</td>
                  <td className="whitespace-nowrap px-2 py-2 font-medium">
                    <Link
                      href={
                        "/shipment-planning/send?outlet=" +
                        encodeURIComponent(r.name)
                      }
                      className="text-blue-600 hover:underline"
                    >
                      {r.name}
                    </Link>
                  </td>
                  <td className="px-2 py-2 text-right">
                    {Math.round(r.current)}
                  </td>
                  <td className={`px-2 py-2 text-right ${lowCell(r.belgian)}`}>
                    {Math.round(r.belgian)}
                  </td>
                  <td className={`px-2 py-2 text-right ${lowCell(r.vanilla)}`}>
                    {Math.round(r.vanilla)}
                  </td>
                  <td className="px-2 py-2 text-right">{r.cutoff}</td>
                  <td className="px-2 py-2">
                    <span
                      className={`whitespace-nowrap rounded-full px-2 py-0.5 font-medium ${st.cls}`}
                    >
                      {st.text}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-2">
                    {r.sendBy ? ddmm(r.sendBy) : "-"}
                  </td>
                  <td className="px-2 py-2 text-right">
                    {r.sendIn === null ? "7+" : r.sendIn}
                  </td>
                  <td className="px-2 py-2 text-right">
                    {r.shortfall > 0 ? r.shortfall : "-"}
                  </td>
                  {r.levels.map((l, k) => (
                    <td
                      key={k}
                      className={`px-2 py-2 text-right ${
                        l < r.cutoff ? "bg-red-50 font-medium text-red-600" : ""
                      }`}
                    >
                      {Math.round(l)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {noData.length > 0 && (
        <p className="mt-3 text-xs text-slate-500">
          No stock found in the stock sheet for:{" "}
          {noData.map((r) => r.name).join(", ")}.
        </p>
      )}
    </div>
  );
}