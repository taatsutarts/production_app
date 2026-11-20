// /store/current-stock — this store's current stock: its rows in the Google sheet, else its
// newest closing-stock entry (the stores are usually not in the sheet). Server page using the
// service key, so it filters to the logged-in store itself.
import { getStockData } from "@/lib/stock";
import { getProfile } from "@/lib/profile";
import { stockForOutlet } from "@/lib/storeStock";
import ByOutletView from "@/app/Kytchens_current_stock/by-outlet/ByOutletView";

export const dynamic = "force-dynamic";

export default async function StoreCurrentStockPage() {
  const [d, profile] = await Promise.all([getStockData(), getProfile()]);
  const s = await stockForOutlet(profile, d.error ? [] : d.stock || []);

  let note = "Live from the Google Sheet" + (d.dateCell ? " · stock as on " + d.dateCell : "");
  if (s.source === "closing") note = "Your closing stock entry of " + s.date;
  if (s.source === "none") note = "No stock entered yet — use Closing Stock to enter it.";
  const showError = d.error && s.stock.length === 0;

  return (
    <div className="w-full">
      <h1 className="text-2xl font-bold">Current Stock · {profile.outletName}</h1>
      {showError ? (
        <p className="mt-6 text-red-600">{d.error}</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-slate-500">{note}</p>
          <ByOutletView
            stock={s.stock}
            warnings={{ outlets: [], items: [] }}
            lockOutlet={profile.outletName}
          />
        </>
      )}
    </div>
  );
}
