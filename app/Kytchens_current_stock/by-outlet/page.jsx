import { getStockData } from "../../lib/stock";
import ByOutletView from "./ByOutletView";

export const dynamic = "force-dynamic";

export default async function ByOutletPage() {
  const d = await getStockData();

  return (
    <div className="w-full">
      <h1 className="text-2xl font-bold">Stock by Outlet</h1>

      {d.error && <p className="mt-6 text-red-600">{d.error}</p>}

      {!d.error && (
        <>
          <p className="mt-1 text-sm text-slate-500">
            Live from the Google Sheet
            {d.dateCell ? " · stock as on " + d.dateCell : ""}
          </p>
          <ByOutletView stock={d.stock} warnings={d.warnings} />
        </>
      )}
    </div>
  );
}