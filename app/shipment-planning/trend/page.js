import { getShipmentData } from "@/lib/shipment";
import TrendView from "./TrendView";

export const dynamic = "force-dynamic";

export default async function TrendPage() {
  return <TrendView d={await getShipmentData()} />;
}
