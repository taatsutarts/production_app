/* Outlet coordinates + freezer capacity for the planner, from the Supabase `outlets`
   table (anon-readable; the browser client is fine). Needs the latitude/longitude
   columns from outlets_add_coords.sql at the project root — until that runs, mapConfig
   falls back to the built-in constants in planner.js and the page shows a note.

   Read-only; no writes anywhere in here. */

import { supabase } from "@/lib/supabaseBrowser";
import { mapConfig } from "./planner";

export async function fetchOutletConfig() {
  const empty = { ok: false, cfg: null, error: null };
  try {
    const { data, error } = await supabase.from("outlets").select("*").eq("is_active", true);
    if (error) return { ...empty, error: error.message };
    return { ok: true, cfg: mapConfig(data || []) };
  } catch (e) {
    return { ...empty, error: e.message };
  }
}
