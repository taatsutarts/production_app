/* Browser Supabase client — cookie-session based (@supabase/ssr), same storage as
   the /login client (lib/supabase/client.js). A plain createClient kept its
   session in localStorage, which the cookie-session login never fills — so
   requests went out as `anon` and RLS returned 0 rows (session 22f lockdown).
   With the shared cookie session the requests carry the logged-in user's JWT. */

import { createBrowserClient } from "@supabase/ssr";

export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);
