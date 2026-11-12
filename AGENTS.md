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
