// lib/profile.js
// Server-only: the logged-in user's role (user_profiles, see lib/access.js).
// Returns { role: "admin" | "store" | null, outletId, outletName }.
// Before supabase_migration_store_users.sql runs, every login is treated as admin
// (same rule as proxy.js).
import { createClient } from "@/lib/supabase/server";

export async function getProfile() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { role: null, outletId: null, outletName: null };

  const { data, error } = await supabase
    .from("user_profiles")
    .select("role, outlet_id, outlets(name)")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error?.code === "PGRST205") return { role: "admin", outletId: null, outletName: null };
  if (!data) return { role: null, outletId: null, outletName: null };
  return {
    role: data.role,
    outletId: data.outlet_id ?? null,
    outletName: data.outlets?.name ?? null,
  };
}
