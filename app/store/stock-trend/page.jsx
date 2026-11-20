// /store/stock-trend — this store's 7-day stock projection (same view as the admin trend page,
// narrowed to the logged-in store).
import { getShipmentData } from "@/lib/shipment";
import { getProfile } from "@/lib/profile";
import { stockForOutlet } from "@/lib/storeStock";
import TrendView from "@/app/shipment-planning/trend/TrendView";

export const dynamic = "force-dynamic";

export default async function StoreStockTrendPage() {
  const [d, profile] = await Promise.all([getShipmentData(), getProfile()]);
  let stockDate = null;
  if (!d.error) {
    d.outlets = d.outlets.filter((o) => o.name === profile.outletName);
    const s = await stockForOutlet(profile, d.stock);
    d.stock = s.stock.filter((r) => r.section === "Tarts");
    if (s.source === "closing") stockDate = s.date;
  }
  return <TrendView d={d} stockDate={stockDate} />;
}
