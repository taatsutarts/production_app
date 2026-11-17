/* Browser Supabase client — cookie-session based (@supabase/ssr), same storage as
   the /login client (lib/supabase/client.js). REQUIRED since the RLS lockdown
   (session 22f): a plain createClient keeps its session in localStorage, which
   the cookie-session login never fills — so every request went out as `anon`
   and RLS returned 0 rows on every table (planner: "Outlet setup incomplete").
   With the shared cookie session the requests carry the logged-in user's JWT
   and match the authenticated_full_access_* policies. */

import { createBrowserClient } from "@supabase/ssr";

export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);
