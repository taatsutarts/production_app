import { getShipmentData } from "../../lib/shipment";
import SendView from "./SendView";

export const dynamic = "force-dynamic";

export default async function SendPage({ searchParams }) {
  const params = await searchParams;
  const d = await getShipmentData();

  return (
    <div className="w-full">
      <h1 className="text-2xl font-bold">Send to Outlet</h1>

      {d.error && <p className="mt-6 text-red-600">{d.error}</p>}

      {!d.error && (
        <>
          <p className="mt-1 text-sm text-slate-500">
            Stock is live from the Google Sheet
            {d.dateCell ? " · as on " + d.dateCell : ""}
          </p>
          <SendView
            outlets={d.outlets}
            stock={d.stock}
            shares={d.shares}
            initialOutlet={params?.outlet || ""}
          />
        </>
      )}
    </div>
  );
}