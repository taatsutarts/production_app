# CHANGELOG — AI Agent Build History

> **READ THIS FIRST (for AI agents, human eyes optional)**
>
> This file is the project's institutional memory, written by AI agents for AI agents.
> If you (agent) are starting a session on this codebase and the user asks for changes,
> read the entries below before writing code — they explain what was already built,
> why, and which traps were already stepped in.
>
> **Maintenance rules:**
> - Append every change session as a new entry at the TOP (newest first).
> - Each entry: date, files touched, root cause of the bug, what changed, how it was verified.
> - Record workarounds and environment quirks — they recur.
> - This file is for agent handoff: the user may switch agents/tools between sessions
>   (OpenCode → Claude Code → ...). Write so a fresh agent with zero memory can continue seamlessly.

---

## Known environment gotchas (learned the hard way)

- **Tailwind v4 + Next dev stale CSS build:** when only JSX class names change, the dev
  server may NOT rebuild the CSS — new classes silently don't apply (e.g. a map container
  was 0 px tall → "white screen"). Fix: restart `next dev`, or touch `app/globals.css`
  to force a rebuild. Don't assume a missing style means a missing class in the markup —
  probe the browser's computed styles first.
- **Auth:** every route except `/login` is login-protected by `proxy.js`
  (Next 16's middleware replacement; it redirects to `/login` via Supabase session check).
  Headless/diagnostic browsers have no session — to test a page, either log in or
  TEMPORARILY add the route to `PUBLIC_PATHS` in `proxy.js` and revert immediately after.
- **No test credentials in `.env.local`** — don't create test accounts in the real
  Supabase project; bypass via `PUBLIC_PATHS` (temporarily, always reverted) instead.
- **Next 16 note:** `AGENTS.md` contains an auto-generated block from `next dev`
  (between the `BEGIN/END:nextjs-agent-rules` markers). Don't remove it; content outside
  the markers is ours.
- **Docs check:** `node_modules/next/dist/docs/` referenced by the AGENTS.md block may not
  exist at all times — it's generated transiently by `next dev`. If absent, proceed carefully
  with standard App Router patterns already used in this codebase.

---

## 2026-11-12 (session 2) — Add dispatch routes from Central Kitchen to the maps page

**Agent:** OpenCode (GLM) · **Status:** Built and verified (headless-Chrome screenshots + DOM probes, zero console errors).

### What was built
Best driving routes from the Central Kitchen (Tardeo) to every outlet, on
`/shipment-planning/maps`:

**`app/shipment-planning/maps/MapView.jsx`**
- Road routes via the **OSRM free demo server** (`router.project-osrm.org`), same pattern as
  `app/shipment-planning/planner/RouteMap.jsx`. Distances/durations shown are typical drive
  times, not live traffic.
- New floating panel (top-right, `zIndex: 1000` inline to sit above Leaflet panes):
  - `<select>`: "All routes (overview)" or a specific outlet.
  - **All view:** every CK → outlet route drawn in the outlet's colour; list of all outlets
    sorted **nearest-first** (km · min), rows clickable to focus that outlet.
  - **Focused view:** only that route (heavier stroke), map refits to CK + outlet,
    panel shows "Road route: X km · about Y min driving" + back-link.
- Outlet dots are now coloured per outlet (`COLORS` palette, `colorFor(i)`) matching route
  lines and list rows; CK dot stays dark.
- Fetching: module-level `cache` Map (keyed by outlet name) so re-renders/StrictMode never
  refetch; 4 concurrent workers drain the queue; failed OSRM calls are removed from the
  cache so a later mount retries.
- Fallback: dashed straight line CK → outlet when OSRM fails, with "road n/a" in the list
  and an amber notice in the focused view.
- `Fit` helper refits on selection change (`focusPoints` gets a fresh array identity per
  selection so the effect re-runs; padding `[140, 40]` for overview, `[60, 40]` focused).

### Gotcha found this session (added to knowledge)
- **react-leaflet/Leaflet `setStyle` merges options:** the dashed *fallback* Polyline is
  mounted first; when the road route loads, updating `pathOptions` on the same instance
  **keeps the old `dashArray`** (merge never unsets it) — routes stayed dashed forever.
  Fix: key each Polyline with the loading state (`key={name + "-road" | "-approx"}`) so the
  switch to real road geometry remounts a clean instance. Verified: focused view went from
  16 solid + 1 dashed paths to 17 solid + 0 dashed.
- Per the earlier gotcha: new Tailwind classes + stale dev CSS — forced a rebuild by
  touching `app/globals.css` (comment added then removed) before verifying.

### Verification
- Headless Chrome (CDP): panel + select render, all 15 OSRM routes load, list sorted
  nearest-first ("Gamdevi 2.3 km · 3 min, Worli 4.0 km · 5 min, Matunga 10.0 km · 9 min…"),
  clicking a row focuses the outlet (panel + solid road route + refit confirmed),
  screenshots for both views, **no console errors**.
- `proxy.js` was TEMPORARILY opened for the diagnostic browser and reverted; `globals.css`
  rebuilt-touch reverted; route returns 200 after revert.

### Open follow-ups
- [ ] Add "Outlet Maps" to the Shipment Planning section in `app/components/Sidebar.jsx`.
- [ ] Consider hover-only tooltips for the dense Mumbai cluster (labels overlap at low zoom).

---

## 2026-11-12 — Fix `/shipment-planning/maps` (white screen) + remove custom pins

**Agent:** OpenCode (GLM) · **Status:** Fixed and verified (headless-Chrome screenshots + DOM/CSS probes, zero console errors).

### Symptoms
- `http://localhost:3000/shipment-planning/maps` showed a **white/blank screen**
  (sidebar rendered, content area empty).
- The map used a custom text pin (`𖡡` divIcon) for outlets and a 🏭 divIcon for the Central Kitchen.

### Root cause
Stale Tailwind CSS build (see gotcha above): the compiled CSS never contained the maps
page's height classes — old (`h-[calc(100vh-64px)]`, `min-h-[600px]`) or new. Evidence:
`.h-full`/`.min-h-screen` existed in the CSS but every arbitrary-value class from the maps
page was missing; DevTools probe showed the map container at `1042x0`. The white screen
predated all code changes.

### Changes

**`app/shipment-planning/maps/MapView.jsx`** (rewritten)
- Removed the custom pin (`L.divIcon` with `𖡡`), the 🏭 factory divIcon, and all `Marker` usage.
- Outlets + Central Kitchen are now `CircleMarker` dots (blue outlets, larger dark CK dot)
  with permanent `Tooltip` labels — no icon images, avoids the broken Leaflet default-marker
  bundling issue entirely.
- Map fills its wrapper (`h-full w-full`) instead of the overflowing hardcoded `90vh`.
- Tile layer: `maxNativeZoom={16}` + map `maxZoom={18}` — previously `maxZoom={16}` on the
  tile layer blanked the map when zooming past 16.
- Added `FitBounds` helper (`useMap`): fits the view to all 16 locations on load so the Pune
  outlets (Kalyani Nagar, Baner) are visible; `padding: [140, 40]` so right-edge labels
  ("Kalyani Nagar (Pune)") aren't clipped; `maxZoom: 11` cap.
- CK tooltip `direction="top"` so it isn't clipped at the map's left edge.

**`app/shipment-planning/maps/page.jsx`**
- Wrapper height matches the real layout chrome: `h-[calc(100vh-7.5rem)]` mobile,
  `md:h-[calc(100vh-5rem)]`, `min-h-[560px]`. (Old `h-[calc(100vh-64px)]` ignored the
  layout's `pt-20 / pb-10` padding → overflow.)

### Verification
- Headless Chrome (CDP) with DOM + computed-style probes: wrapper and map both `1042x722`,
  20 tiles, 16 SVG dots, all tooltips present, `md:` media query matched and applied.
- Screenshots confirmed: no clipped labels, Pune outlets visible, no overflow/scrollbars.
- Console captured during load: **no errors**.

### Notes
- `proxy.js` was TEMPORARILY modified during diagnosis (maps route added to `PUBLIC_PATHS`)
  and reverted immediately after — auth fully intact.
- The Maps page is **not linked in the sidebar** (Shipment Planning group lists only
  "Send PO (new)", "Send PO", "Outlet Stock Trend"); reachable by URL only.
- `CHANGELOG.md`, `AGENTS.md` (agent section), and `CLAUDE.md` (import pointer) were added
  in this session for agent handoff.

### Open follow-ups
- [ ] Add "Outlet Maps" to the Shipment Planning section in `app/components/Sidebar.jsx`.
- [ ] Consider hover-only tooltips for the dense Mumbai cluster (labels overlap at low zoom).
