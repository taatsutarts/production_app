import { supabaseService as supabase } from "./supabaseService";
import { monthStartISO, key, num } from "./utils";

export async function fetchStores() {
  const { data, error } = await supabase
    .from("outlets")
    .select("id, name, address, poc_name, poc_contact")
    .eq("outlet_type", "store")
    .order("id"); // outlet ids 1-3 are the stores; id order keeps the current display order
  if (error) throw error;
  return data || [];
}

export async function fetchSupplies() {
  const { data, error } = await supabase
    .from("supplies")
    .select("id, product_title, base_unit")
    .order("id");
  if (error) throw error;
  return data;
}

// { "outletId:supplyId": monthly_qty }
export async function fetchRequirements() {
  const { data, error } = await supabase
    .from("outlet_requirements")
    .select("outlet_id, supply_id, monthly_qty");
  if (error) throw error;
  const map = {};
  data.forEach((r) => {
    map[key(r.outlet_id, r.supply_id)] = num(r.monthly_qty);
  });
  return map;
}

// { "outletId:supplyId": total qty dispatched this calendar month }
export async function fetchDispatchedThisMonth() {
  const { data, error } = await supabase
    .from("dispatch_log")
    .select("outlet_id, supply_id, qty")
    .gte("dispatched_at", monthStartISO());
  if (error) throw error;
  const map = {};
  data.forEach((r) => {
    const k = key(r.outlet_id, r.supply_id);
    map[k] = (map[k] || 0) + num(r.qty);
  });
  return map;
}

export async function saveRequirements(rows) {
  const { error } = await supabase
    .from("outlet_requirements")
    .upsert(
      rows.map((r) => ({ ...r, updated_at: new Date().toISOString() })),
      { onConflict: "outlet_id,supply_id" }
    );
  if (error) throw error;
}

export async function logDispatch(rows) {
  const { error } = await supabase.from("dispatch_log").insert(rows);
  if (error) throw error;
}
