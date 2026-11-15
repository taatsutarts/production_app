// lib/supabaseService.js
// Server-only Supabase client using the service-role key (bypasses RLS).
//
// NEVER import this from client code ("use client" components / anything that
// runs in the browser) — the service key must never reach the browser bundle.
// Browser pages use @/lib/supabaseBrowser / @/lib/supabase/client (anon key),
// which are protected by RLS after rls_lockdown.sql runs.
import { createClient } from "@supabase/supabase-js";

export const supabaseService = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);
