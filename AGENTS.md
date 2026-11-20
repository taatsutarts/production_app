<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project history (agent-maintained — read before making changes)

All past changes, root causes, and environment gotchas are recorded in **`CHANGELOG.md`**
in this directory. Read it before writing code, and append a new entry at the TOP of that
file for every change session (date, files touched, root cause, changes, verification).
It exists so a fresh agent with zero memory (OpenCode, Claude Code, or any other tool)
can continue seamlessly.

Key gotchas already learned (details in CHANGELOG.md):
- Tailwind v4 + `next dev` can serve a **stale CSS build** when only JSX class names change →
  restart the dev server or touch `app/globals.css` to force a rebuild.
- All routes except `/login` are auth-guarded by `proxy.js`; for headless diagnostics
  TEMPORARILY add the route to `PUBLIC_PATHS` and revert immediately after.
- Never create test accounts in the real Supabase project.

## Roles and adding pages (admin vs store logins)

Two roles live in the `user_profiles` table: `admin` (whole app) and `store` (one outlet:
Matunga/Bandra/Kandivali — only that outlet's data). **`lib/access.js` is the page registry**
(two lists: `ADMIN_PAGES` and `STORE_PAGES`) — the sidebar, the store home cards and the route
guard in `proxy.js` all read it; its header comment is the how-to. In short:
- **Store pages live ONLY under `app/store/`** (URL `/store/...`). A store login can open nothing
  else; an admin login is redirected away from `/store/*` (`app/store/layout.js` re-checks).
- **Add a store page:** create `app/store/<name>/page.jsx` + one line in `STORE_PAGES`
  (`href`, `label`, `icon`, `desc`). Read the logged-in store with `getProfile()` (server,
  `lib/profile.js`) or `useProfile()` (client, `components/ProfileProvider.jsx`).
- **Add an admin page:** page anywhere in `app/` + a line in `ADMIN_PAGES`.
- **Reusing an admin page's UI for stores:** put the UI in a component next to the admin page
  (e.g. `app/dispatches/DispatchesView.jsx`) with a prop for the difference (`readOnly`,
  `lockedOutletId`) and render it from both pages. Do not add `if (role === "store")` checks
  inside admin pages.
- New table a store may touch → add a store RLS policy in SQL (template in `lib/access.js`);
  the database, not the page, is what limits a store to its own rows. Stores get 403 on every
  `/api` route (those use the service key).
- Adding a store login: create the auth user, then upsert its `user_profiles` row. Do NOT re-run
  `supabase_migration_store_users.sql` for that.
