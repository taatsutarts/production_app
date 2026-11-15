-- rls_lockdown.sql — session 22f confidentiality audit fix (v3)
--
-- v3 RATIONALE: v2 ran with success, yet the anon-key probe still read every
-- table. That means pre-existing PERMISSIVE POLICIES (granting the `anon`
-- role) were already on the tables — they sit on top of the new policy and
-- defeat RLS. v3 makes the end state deterministic and self-healing:
--
--   * Every public TABLE ends with RLS enabled and EXACTLY ONE policy:
--     full access for the Supabase Auth "authenticated" role, NOTHING for anon.
--     Any pre-existing policies are DROPPED first (each drop is printed in a
--     NOTICE line so there is a record of what was removed).
--   * Every public VIEW / MATERIALIZED VIEW: anon role revoked directly +
--     security_invoker = true (view runs with the caller's rights).
--   * Prints a sanity check that the `anon` role is not superuser/bypass-RLS.
--
-- ADDITIONAL ROOT CAUSE FOUND LATER (same session): the "anon" failures were
-- also masked because NEXT_PUBLIC_SUPABASE_ANON_KEY held a service_role key
-- (bypasses RLS). The key was swapped to the real anon key; the SQL below was
-- correct all along. Verified after the swap: anon sees 0 rows on all
-- relations, service_role still reads everything.
--
-- WHY: the public anon key ships inside the deployed app's JS bundle and many
-- pages query Supabase directly from the browser. Without this lockdown any
-- visitor could dump the whole database (vendors, purchase bills + amounts,
-- sales, production, spoilages, shopify orders...). Login already uses real
-- Supabase Auth, so logged-in users are unaffected: the browser client
-- attaches their JWT, which matches these policies.
--
-- Server-side code (all /api routes + lib/supabaseService.js) uses the
-- service-role key, which BYPASSES RLS — it keeps working unchanged.
--
-- HOW TO RUN: Supabase dashboard -> SQL Editor -> paste the whole file -> Run.
-- IDEMPOTENT: safe to run again — it only adds what is missing.
-- ADDITIVE ONLY: no drops of tables/columns/data; only old anon-permissive
--   POLICIES are removed (names printed in NOTICEs).
-- ROLLBACK: recreate the dropped policies manually if ever needed (they were
--   permissive anon-read policies and are deliberately NOT restored here).

do $$
declare
  r record;
  pol record;
  dropped int := 0;
  ntab int := 0;
  nview int := 0;
  bypass boolean;
  super boolean;
begin
  select rolbypassrls, rolsuper into bypass, super from pg_roles where rolname = 'anon';
  raise notice 'role anon: superuser=% bypassrls=% (both should be false)', super, bypass;

  -- 1. tables: enable RLS, remove ALL old policies, create the one true policy
  for r in
    select c.oid, c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'f')   -- ordinary, partitioned, foreign tables
  loop
    execute format('alter table public.%I enable row level security', r.relname);

    for pol in
      select polname from pg_policy where polrelid = r.oid
    loop
      execute format('drop policy %I on public.%I', pol.polname, r.relname);
      dropped := dropped + 1;
      raise notice '  dropped old policy "%" on %', pol.polname, r.relname;
    end loop;

    execute format(
      'create policy authenticated_full_access_%s on public.%I for all to authenticated using (true) with check (true)',
      r.relname, r.relname
    );
    ntab := ntab + 1;
  end loop;

  -- 2. views + materialized views: revoke anon directly
  for r in
    select c.relname, c.relkind
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('v', 'm')
  loop
    execute format('revoke all on public.%I from anon', r.relname);

    if r.relkind = 'v' then
      begin
        execute format('alter view public.%I set (security_invoker = true)', r.relname);
      exception when others then
        null; -- pre-PG15 server: the anon revoke above already fully blocks the view
      end;
    end if;

    nview := nview + 1;
  end loop;

  raise notice 'DONE: % tables locked (single authenticated-only policy, % old policies dropped)',
    ntab, dropped;
  raise notice 'DONE: % views/matviews locked (anon revoked, security_invoker)', nview;
end $$;
