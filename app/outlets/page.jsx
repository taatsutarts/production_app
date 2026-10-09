import { supabase } from "../lib/supabase";
import OutletsView from "./OutletsView";

export const dynamic = "force-dynamic";

export default async function OutletsPage() {
  const { data: outlets } = await supabase
    .from("outlets")
    .select(
      "id, name, outlet_type, city, address, google_maps_link, poc_name, poc_contact, fridge_capacity"
    )
    .order("name");

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold">Outlets</h1>
      <p className="mt-1 text-sm text-slate-500">
        Tap Edit to change the POC name or contact.
      </p>
      <OutletsView outlets={outlets || []} />
    </div>
  );
}