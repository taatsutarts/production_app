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

## 2026-11-12 (session 13) — Shopify Orders: no-address1 orders show the pickup address

**Agent:** OpenCode (GLM) · **Status:** Built and verified (headless-Chrome probe + screenshot, zero exceptions).

### What was asked
If `address1` is null in `shopify_orders`, the popup (and copied text) should show the
heading **"Pickup Address"** instead of "Delivery address", with the fixed store address:
"Gourmaison, 9/11 ground floor Vasundhara building, Same building as Audi Mumbai South,
Tardeo, Mumbai, Maharashtra 400026".

### Changes — `app/gourmaison/shopify-orders/page.jsx` only
- New `PICKUP_ADDRESS` constant (4 display lines, user's wording verbatim) + new
  `addressHeading(o)` helper ("Delivery address" / "Pickup Address").
- `addressLines(o)`: when `!o.address1` (null/empty) → returns `PICKUP_ADDRESS` (customer
  name/phone lines omitted, per the request); otherwise unchanged.
- Popup `<h3>` and `buildCopyText` both use `addressHeading()`.

### Data facts (read-only REST probe)
2 orders have null `address1`, both November deliveries: #7221 Shalin Desai (07/11) and
#7197 Prerna Jatia (03/11).

### Verification (headless, fresh load, zero exceptions)
- #7221 popup: heading "Pickup Address", lines exactly the fixed address; copied text:
  "Website Order #7221 / Shalin Desai / 07/11/2026 / 3PM-5PM / item / **Pickup Address** /
  Gourmaison / 9/11 ground floor Vasundhara building / Same building as Audi Mumbai South /
  Tardeo, Mumbai, Maharashtra 400026".
- #7239 (has address1): heading "Delivery address", customer name + address + phone
  unchanged.
- `proxy.js` page-path bypass reverted; route 200; browser + scripts (incl. REST probe) cleaned.

---

## 2026-11-12 (session 12) — Shopify Orders: month pills, copy includes order #, popup name not bold

**Agent:** OpenCode (GLM) · **Status:** Built and verified (headless-Chrome probe + screenshots, zero exceptions).

### What was asked (follow-up to session 11)
1. An option to see past months' order cards (session 11 hard-filtered to the current month).
2. The copy-to-clipboard text should start with the popup's top header line
   ("Website Order #<order_name>").
3. The popup's customer name is bold — don't want that.

### Changes — `app/gourmaison/shopify-orders/page.jsx` only
- **Month pills** under the page header: one pill per month that has orders, newest first,
  each with its order count ("November 2026 43", "October 2026 16") plus "All months".
  Active pill = filled accent. New state `monthSel` (null = current month, "YYYY-MM",
  "all"); `monthKey(o)` (delivery month, placed-month fallback) + `monthName()` helpers
  at module level; `monthList` derived via `useMemo` from `orders` (survives realtime
  reloads); `visible` filters on the active pill. Header count text follows the selection.
- **`buildCopyText`**: head now starts with `orderLabel(o)` → copied text begins
  "Website Order #7239", then name, date, slot, items, address.
- **Popup `<h2>`** font-weight 600 → 400 (serif, same size — not bold anymore).
  Card name untouched (only the popup was in scope).

### Verification (headless, fresh load, zero exceptions)
- Pills render with counts and correct active states; November → 43 cards (all /11/),
  October → 16 (all /10/ incl. the null-delivery order filed under its placed month),
  All → 59; count line tracks the selection.
- Popup: name computed font-weight 400; clipboard intercepted — copied text confirmed:
  "Website Order #7239\nZeeba Sajnani\n12/11/2026\n3PM-5PM\n\nPlatter 2 - Hard Gift Box x 1\n\nDelivery address…".
- `proxy.js` page-path bypass reverted; route 200; browser + scripts cleaned.

---

## 2026-11-12 (session 11) — Shopify Orders page: order # headers, popup eyebrow, no day name, current-month only

**Agent:** OpenCode (GLM) · **Status:** Built and verified (headless-Chrome probe + screenshots, zero exceptions).

### What was asked (gourmaison/shopify-orders)
1. "Change the time slot in the header of the div" → clarified with the user: the card's
   big header becomes **"Website Order #<order_name>"** (the time slot moves to the date
   line); the popup gets the same label **above the customer name**, then the rest.
2. Remove the day name after the date ("12/11/2026, Thursday" → "12/11/2026").
3. Hide last-month orders — only the current month shows. Clarified: **delivery month**
   decides (an order placed in October but delivering in November still shows); orders
   with no delivery date fall back to their placed month.

### Data facts (read-only REST probe of shopify_orders, 59 rows)
- `order_name` always "#7239"-style → `orderLabel(o)` = `Website Order ${order_name || "#"+id}`.
- `delivery_slot` "03:00PM-05:00PM" → fmtSlot already renders "3PM-5PM" (formatting fine).
- `delivery_day` held the day name ("Thursday") — now unused for display.
- Months: delivery 2026-10 ×15 + 1 null-delivery (placed Oct), 2026-11 ×43 → the filter
  leaves exactly 43.

### Changes — `app/gourmaison/shopify-orders/page.jsx` only
- `dateLine()` drops `o.delivery_day` (affects card, popup, and the copy-to-clipboard text).
- New `orderLabel(o)` helper; card header `.og-slot` → `.og-order` (serif accent, 26px → 22px
  so "Website Order #7239" fits one line); slot now a green `.og-date-slot` span on the date
  line; foot no longer repeats the order number (Test chip kept).
- Popup: new `.og-modal-order` eyebrow line above the `<h2>` name; date/slot lines unchanged.
- Current-month filter: `visible = orders.filter(o => monthOf(delivery_date || placed_at) === thisMonth)`
  (client-side, after the realtime reload — query itself untouched). Header count, empty
  note ("No orders for this month yet."), and grid all use `visible`.

### Verification (headless, fresh load, zero exceptions)
- Grid: 43 cards, headers "Website Order #7239/#7238/#7237"…, date lines "12/11/2026 3PM-5PM"
  + Today chip (×4 today), 0 day names, 0 non-November dates, 0 order numbers in feet.
- Popup: eyebrow "Website Order #7239" above "Zeeba Sajnani", lines ["12/11/2026","3PM-5PM"].
- Supabase read is client-side (anon key) → needed no `/api` bypass; only the page path was
  temp-opened in `proxy.js` and reverted; route 200; browser + scripts (incl. the REST probe)
  cleaned.

---

## 2026-11-12 (session 10) — Planner route map: Pune trips (Baner, Kalyani Nagar) now render

**Agent:** OpenCode (GLM) · **Status:** Built and verified (headless-Chrome probe + screenshots, zero exceptions on fresh loads).

### What was asked
"the route of Baner and Kalyani Nagar is not showing on map" — the two Pune outlets
(`Z = "P"`, planner N[10]/N[11]) had no route drawn.

### Root cause (two separate reasons, both real)
1. **By design (old):** `RouteMap.jsx` filtered `Z[o] == "P"` trips out of *everything* —
   no polyline fetch, no pins, grey dots suppressed, and `maxBounds` was a Mumbai-only box
   they couldn't even pan into. Legend said "off the Mumbai map".
2. **Baner wasn't dispatched at all** in the default plan (5th-lowest cover 3.5 d; the
   "Add lowest stock to reach 4" option picks Kalyani/Thane/Bandra/Worli) — so no Baner
   trip existed to draw. Only clicking the Baner outlet chip (or an option incl. it)
   creates that trip. Kalyani Nagar *was* dispatched (Trip 3) but invisible per (1).

### Changes — `app/shipment-planning/planner/RouteMap.jsx` only
- Pune trips now render **exactly like Mumbai trips**: routes fetched for every trip
  (`mumbai` → `all`), numbered pins, grey dots for all unused outlets (incl. Pune),
  `fitPts` includes Pune points.
- Adaptive bounds: new `PUNE_BOUNDS` (18.4–19.4 lat, 72.65–74.1 lng) + a `Bounds` component
  that calls `setMaxBounds(pune ? PUNE_BOUNDS : BOUNDS)` when a Pune trip appears/disappears;
  `minZoom` lowered 10 → 7 so the ~150 km fit isn't clamped by the old min zoom.
- Legend tag: `(Pune)` suffix on the trip line instead of the old off-map note.
- **dashArray persistence fix (same as maps page session 2):** road/fallback `Polyline`s get
  distinct remount keys (`"-road"` / `"-approx"`) — Leaflet's `setStyle` never removes the
  fallback's `dashArray`, so swapping pathOptions in place left the OSRM road line dashed.

### Verification (headless, fresh load, zero exceptions)
- Default plan: legend "Trip 3 (Pune) 158.4 km · about 130 min" (Kitchen → Kalyani Nagar),
  solid OSRM road line, pins ①②; screenshot `planner_pune_default`.
- After clicking the Baner chip: combined Pune run "Trip 3 (Pune) 170.9 km · about 158 min"
  (Kitchen → Baner ① → Kalyani Nagar ②), solid line; screenshot `planner_pune_baner`.
- First run showed the OSRM line still dashed → remount-key fix → re-run solid.
- Note for future sessions: **Baner's route only appears once Baner is in the plan** — that's
  correct behaviour, not a bug. If the user wants Baner always dispatched, that's a planner
  option change, not a map change.
- `proxy.js` (incl. `/api/stock`) temp bypass reverted; route 200; browser + scripts cleaned.

---

## 2026-11-12 (session 9) — Stock table: no blanks, 0 instead of "not carried"

**Agent:** OpenCode (GLM) · **Status:** Built and verified (headless-Chrome probe + screenshot, zero exceptions).

### What was asked
"Stock of every outlet" showed "–" for flavours an outlet has no sheet row for — the user
wants **a number in every cell: 0 when there is no value** (no blanks, all editable).

### Semantics change (deliberate)
The planner's hidden `null = "not carried"` concept is retired:
- `split()` only mix-allocated flavours with `S[o][i] != null`; with the change every outlet
  is mix-allocated for all 9 sales-mix flavours (mix % denominator is the full 99.6 for
  everyone). Quantities for outlets with previously-missing mix flavours (Thane, Kalyani
  Nagar, …) now include those flavours — richer/complete allocations.
- `*` flavours (mix 0, e.g. Biscoff) are now 0 + editable everywhere instead of locked "–".

### Changes
- **`outletStock.js`**: after the manual-stock fill AND after `missing` is computed (so the
  data-gap warnings stay truthful), all remaining `null` cells are swept to `0`.
- **`planner.js`** `initialStock()`: fallback (pre-load/error) stock now maps `null → 0` too
  (`Math.max(0, f[2][o] || 0)`) — no blanks in any state.
- **`page.jsx`** stock table cell: renders the `NumInput` unconditionally with
  `value={S[o][i] ?? 0}` (the `–` branch is gone).

### Verification (headless, fresh load)
- 0 blank cells (sampled columns: all 85/85 rendered as editable inputs); Biscoff row 0
  everywhere incl. the three stores; Thane's previously-dash mix flavours (Kunafa, Apple,
  Lemon Mousse, Salted Caramel) = 0; sheet/manual values untouched (Belgian 77/99/98…).
- Outlet chip totals unchanged (stk already treated null as 0). Day plan recomputes with the
  fuller allocations (Trip 1: Worli 312 + Bandra 318 = 630 tarts; Kitchen 2412 sent, 561 left).
- `proxy.js` (incl. `/api/stock`) temp bypass reverted; route 200; browser + scripts cleaned.

---

## 2026-11-12 (session 8) — Planner: hardcoded stock for the 3 stores missing from the sheet

**Agent:** OpenCode (GLM) · **Status:** Built and verified (headless-Chrome probe + screenshot, zero exceptions on fresh load).

### What was asked
Bandra, Matunga, Kandivali have no rows in the stock sheet (session 7 finding) — the user
supplied their stock as a table and asked to hardcode it "for now".

### Changes

**`app/shipment-planning/planner/outletStock.js`**
- New `MANUAL_STOCK` constant: the owner-provided table, values keyed by planner outlet name
  (Bandra / Matunga / Kandivali), arrays in **FL order**; blank Biscoff row → `null`
  (not carried). TODO comment: remove once the stores report stock in the sheet themselves.
- `fetchOutletStock()` fills these AFTER the sheet rows and only into `null` slots, so
  **sheet data always wins** if the stores ever start reporting. `missing` is now computed
  after the fill, so manual-covered outlets are no longer a "data gap" badge — instead the
  return gains `manual[]` (outlets filled from MANUAL_STOCK).
- Fallback `empty` object includes `manual: []`.

**`app/shipment-planning/planner/page.jsx`**
- Stock fold header: new amber badge `manual stock: N`; warnings block line
  "hardcoded stock (not reporting in sheet yet): Bandra, Matunga, Kandivali".

### Verification (headless, fresh load, zero exceptions)
- All 17 rows match the user's table exactly (Bandra/Matunga/Kandivali columns; Biscoff "–"
  at all three; e.g. Belgian 77/99/98, Apple 13/53/26, Black Forest 18/19/4).
- Per-flavour Totals now include the stores (Kunafa 390, Belgian 1505…).
- Outlet chips: Bandra 471 · 2.9d, Matunga 836 · 3.6d, Kandivali 807 · 5.5d — the ⚡ critical
  marker dropped from all three; only Kalyani Nagar (184 · 1.5d) stays critical.
- Planner re-picked options automatically ("Add lowest stock to reach 4", ₹3.6/tart,
  2028 tarts sent, Kitchen 945 left — no shortfall anymore).
- Note: sheet numbers drifted slightly between runs (Juhu 908→906 etc.) — live sheet is
  being edited during the day; expected.
- `proxy.js` (incl. `/api/stock`) temp bypass reverted; route 200; browser + scripts cleaned.

---

## 2026-11-12 (session 7) — Planner: real outlet stock from the sheet + flipped stock table

**Agent:** OpenCode (GLM) · **Status:** Built and verified (full-pipeline simulation + headless-Chrome probe + screenshot, zero exceptions).

### What was asked
1. "Stock of every outlet" in `/shipment-planning/planner` used hardcoded stock
   (`initialStock()` from the `FL[2]` arrays) — make it come from the **same spreadsheet
   import the `/shipment-planning/po-send` page uses**, without depending on that page's code.
2. **Flip the table**: outlets as columns, products as rows.

### Data path (validated end-to-end before wiring)
`Google Sheet "Kytchens Current Stock"` → `app/lib/stock.js` (`getStockData`, server-side;
maps sheet outlet/item spellings to DB names via `outlets`/`outlet_aliases`/`items`/
`item_aliases`) → **`/api/stock`** route (filters `section === "Tarts"`, returns
`{ dateCell, stock: [{outlet, item, qty}] }`) → planner mapping. The planner page calls
`/api/stock` directly like po-send does — no cross-page import.

### Changes

**NEW `app/shipment-planning/planner/outletStock.js`**
- `fetchOutletStock()`: `fetch("/api/stock")`, reshapes rows into the S matrix
  `S[outlet (N index)][flavour (FL index)] = qty`.
- Outlet matching: normalise + drop "Kytchens/Kytchen/Store/Cloud" words; planner
  "Andheri West" ↔ DB "DN Nagar" via one explicit alias (DB aliases already map sheet
  spellings, including the "Juhu Kytchen" typo → Juhu).
- Item matching: reuses `normItem`/`itemKeysMatch` now **exported from `ckStock.js`**
  (handles `#_#`/`TTS `/`- Taatsu`, filler words, the Choc-Coconut/PB&J aliases).
- Negative sheet quantities (found real ones: Biscoff −1, Black Forest −1 ×3, PB&J −3)
  clamp to 0 per the planner's "negatives are system errors" rule.
- Absence semantics: the sheet lists every SKU an outlet carries, so **a missing
  outlet+flavour row → null = "not carried"** (unchanged planner semantics; locked "–" cell).
- Returns `{ ok, date, S, missing[], unknownOutlets[], unknownItems[] }`; `missing` =
  planner outlets with NO tarts rows at all.

**`app/shipment-planning/planner/page.jsx`**
- New `sheetInfo` state + mount effect: fetch, `setS(r.S)`, then `redo()` (stock change
  re-picks outlets/drops overrides — same rule as manual stock edits; hardcoded values
  remain the pre-load/error fallback).
- Stock fold header: `sheet {dateCell}` / "sheet: loading…" / "sheet failed — manual values",
  plus an amber badge when outlets lack sheet data.
- Warnings block inside the fold: "no stock rows in sheet: …" (missing outlets), "in sheet
  but not in planner: …" (unknown outlets — e.g. "Mira Road Kytchens" if it had tart rows),
  "stock items not matched to a planner flavour: …".
- **Table flipped**: header `Product | <15 outlets> | Total`, one row per flavour
  (`S[o][i]` cells, "–" when null, still editable NumInputs), new per-flavour Total column.

### Verification
- Full-pipeline simulation (sheet CSV + lib logic replicated read-only in Node) matched the
  headless page probe exactly: Belgian Chocolate Gamdevi 145/Juhu 162 …, Kunafa total 250,
  Biscoff Powai 0 (clamped), PB&J Gamdevi 0 (clamped), Bandra/Matunga/Kandivali columns "–".
- Outlet chips recomputed from real stock (Gamdevi 813, Juhu 908, …); planner auto-picked
  "All critical outlets" (4 outlets under 2 days: Kalyani Nagar 1.5d + the three empty
  stores); Kitchen correctly shows "short 1797" against that demand. Zero exceptions.
- **Data-coverage caveat surfaced:** the sheet currently has **no rows for Bandra, Matunga,
  Kandivali** (stores) — they show 0 stock/not carried and drive the "critical" pick. Flagged
  to the user; keeping hardcoded values for sheet-missing outlets is the alternative if asked.
- `proxy.js` temp bypass included `/api/stock` for the diagnostic browser (the API 401s
  unauthenticated by design) — reverted; route 200; browser + temp scripts cleaned up.

### Learnings
- Replicating lib logic in a standalone Node test: Supabase REST helpers return the data
  array directly (`r.json()`), NOT `{ data }` — reading `resp.data` silently yields `[]` and
  every DB-alias match "fails" while rows still flow through raw. Debug the map sizes, not
  just the output.
- `/api/stock` is login-guarded by `proxy.js` (JSON 401 for non-browser callers) — planner
  pages call it with the user session; headless diagnostics need it in PUBLIC_PATHS temporarily.

---

## 2026-11-12 (session 6) — Planner: real "In CK" stock from last day's closing

**Agent:** OpenCode (GLM) · **Status:** Built and verified (headless-Chrome probe + screenshot, zero exceptions).

### What was asked
The Kitchen fold's **In CK** column in `/shipment-planning/planner` was hardcoded
(`initialCK()` in `planner.js`: a synthetic 3,800-tart pool split by sales mix %).
Replace it with the **closing stock of yesterday** for TARTS (daily stock report "Opening").

### Changes

**NEW `app/shipment-planning/planner/ckStock.js`**
- `fetchCKClosing(planDate)` — read-only Supabase queries, exact same tables/math as
  `/daily-stock-report`: finds the **latest date ≤ planDate−1 that has a `physical_opening`
  entry** (walks back over days with no entry), then
  `closing = phys + production − spoilage(full_qty × batch_size + open_qty, outlet_id=6)`.
- Maps DB `items` (category TARTS, active) onto the planner's 17 `FL` rows via a name
  normaliser (`#_#`/`TTS `/`- Taatsu` stripping, punctuation, filler words "the/tart/cheese(cake)")
  + word-prefix matching + 2 aliases: "Coconut Chocolate Tart"→Choc Coconut*, "Peanut butter
  jelly tart"→PB&J*. "mushroom cheesecake tart" matches Mushroom Cheddar* by prefix.
  Returns `{ ok, date, qty[] (FL-aligned), missing[], extra[] }`.
- Verified standalone against live data: all 17 rows match, total 2,973 (plan date 2026-11-12
  → report date 2026-11-11). Only `Biscoff*` has no DB item → 0.

**`app/shipment-planning/planner/page.jsx`**
- New `ckInfo` state + effect on `date`: fetches and `setCK(qty)` (values stay editable
  NumInputs; changing the plan date re-fetches — manual CK edits are replaced by the new day's
  stock, consistent with `redo()` semantics).
- Kitchen fold header now shows `opening {date}` / "opening: loading…" / "opening: no stock
  entry — manual values" (when no `physical_opening` exists at or before planDate−1, the old
  values are kept and flagged). Note lines inside the fold: "no stock entry for: …" (flavours
  with no DB item) and "in stock report but not in planner: …" (future-proofing for new items).
- `planner.js` untouched (still pure logic; `initialCK()` remains the pre-load fallback).

### Verification (fresh page load, plan date 2026-11-12)
- Kitchen header: "opening 2026-11-11 · 2973 in stock · 2973 left".
- In CK per flavour = real closing: Belgian 570, Original Vanilla 444, Nutella 312,
  Salted Caramel 294, Lemon Mousse 270, Blueberry 192, Apple Crumble 180, Kunafa 162,
  Jalapeno 144, Brownie 126, Motichoor 78, Tiramisu 69, Black Forest 60, Mushroom 60,
  Choc Coconut 12, PB&J 0, Biscoff 0 — total 2,973 = stock report total.
- Note "no stock entry for: Biscoff*" renders; options/pricing computed fine (no exceptions).
- `proxy.js` temp bypass reverted; route 200; headless browser + temp scripts cleaned up.

---

## 2026-11-12 (session 5) — Data access verified: last-day closing stock (TARTS)

**Agent:** OpenCode (GLM) · **Status:** Read-only diagnostic; NO repo files changed.

### Question from the user
"Do you have access to the closing stock of last day — /daily-stock-report,
'daily stock report' table, 'Opening' column, TARTS only?"

### Answer / verified data path
Yes. **"Opening" on date D ≡ "Closing" on D-1** — identical formula and inputs
(`app/daily-stock-report/page.jsx` lines 124–152):
- `opening(D) = phys_opening(D-1) + production(D-1) − waste(D-1)`
- waste = `spoilages.full_qty × items.batch_size + open_qty`, only rows with
  `outlet_id = 6` (Central Kitchen)
- items filtered by `items.category = 'TARTS'` (and `is_active = true`)

Tables (all readable via the browser anon key in `.env.local` → `app/lib/supabaseBrowser.js`):
`items`, `physical_opening` (key: `opening_date`), `production` (key: `production_date`),
`spoilages` (key: `spoilage_date`, `outlet_id`), `dispatches` (timestamp range).

Live verification (read-only REST query, 2026-11-11 = "last day"):
16 TARTS items, closing total **2,973 pcs** (largest: Belgian Chocolate Cheese 570,
Original Vanilla Cheesecake 444; Peanut Butter Jelly = 0). Matches the page's Opening column.

### Note for future agents
- Direct REST from Node works (`fetch` + `apikey`/`Authorization: Bearer` headers) with the
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` from `.env.local`. Read-only SELECTs are fine; still never
  create test accounts.
- A transient 401 "Invalid API key" can appear when firing 4 parallel REST requests at once
  (single sequential requests all returned 200 with the identical key) — retry sequentially
  before concluding the key is bad.
- Candidate use (pending user decision): wire this as the shipment planner's real opening
  stock instead of hardcoded `initialStock` in `app/shipment-planning/planner/planner.js`.

---

## 2026-11-12 (session 4) — Planner: quantities accordion + slightly larger fonts

**Agent:** OpenCode (GLM) · **Status:** Built and verified (headless-Chrome probes + screenshot, zero exceptions on fresh load).

### What was asked
1. Under **Quantities**, only ONE outlet fold should be expanded at a time (accordion).
2. Make the page's texts and fonts slightly larger.

### Changes

**`app/shipment-planning/planner/page.jsx`**
- `Fold` now supports a controlled mode: pass `open` + `onToggle`; it forwards React 19's
  canonical `onToggle={(e) => onToggle(e.currentTarget.open)}` to the `<details>`.
  Uncontrolled folds (Kitchen, Sales/freezer, Stock tables) pass neither and keep native behavior.
- New state `openOutlet` (the one open outlet index; -1 = none; null = uninitialized) with an
  init effect defaulting it to `SEL[0]` (the most critical outlet) once outlets are picked.
- Quantities folds wired as an accordion: `open={openOutlet === o}` and
  `onToggle={(requested) => setOpenOutlet((cur) => (requested ? o : cur === o ? -1 : cur))}` —
  the pure updater is StrictMode/double-invoke safe.
- Fonts: every `text-xs` → `text-sm` (20 spots: tables, chips, badges, inputs, selects,
  cost-card labels), section headings `text-sm` → `text-base`, page root `text-sm` → `text-base`.
- **`RouteMap.jsx`**: its legend `text-xs` → `text-sm` (matches the page).

### Key learning (added to knowledge)
- **React 19.2 controlled `<details>`:** do NOT build controlled accordions with
  `preventDefault()` on the summary click — React 19.2 manages `<details open>` itself and the
  preventDefault approach silently broke (opening a fold closed everything). The canonical
  pattern works: `open={isOpen}` + `onToggle={(e) => handler(e.currentTarget.open)}` — the DOM
  toggles natively, React syncs siblings, and the handler receives the requested state.
- Transient dev-only console noise: editing `RouteMap.jsx` while a browser tab is open can
  throw "Map container is being reused by another instance" / Leaflet `appendChild` errors via
  Fast Refresh remounts. They do NOT reproduce on a fresh load — verified zero exceptions after
  navigating anew. Don't chase these in a tab that lived through an HMR edit; reload first.

### Verification (fresh page load)
- Picked "Send to the 4 lowest" → 4 quantities folds, exactly 1 open (the first outlet).
- Clicking another fold → still exactly 1 open (previous one closed); closing → 0 open.
- `th` computed font-size 14px (was 12px), page root 16px (was 14px).
- Route map renders (458×384, tiles + kitchen pin + route dots), zero exceptions.
- `proxy.js` was TEMPORARILY opened for the diagnostic browser and reverted immediately.

---

## 2026-11-12 (session 3) — Planner page: force light mode + remove white margins

**Agent:** OpenCode (GLM) · **Status:** Built and verified (headless-Chrome screenshot + computed-style probes, zero console errors).

### Symptoms (reported by the user)
- `/shipment-planning/planner` showed a **dark background** with **white margins on all sides**.

### Root cause
- The planner page uses ~40 `dark:` Tailwind variants. Tailwind v4's default `dark:` variant
  follows the **OS setting** (`prefers-color-scheme`), so a machine in dark mode rendered the
  page near-black (`dark:bg-slate-950`). The root layout's `main` padding then showed the
  light body background around it — dark rectangle + white margins.
- The margins themselves: `main` in `app/layout.js` has `px-6 pt-20 pb-10 md:px-10 md:pt-10`,
  and page content boxes sit inside it.

### Changes
**`app/globals.css`** (these rules are app-wide but currently only the planner uses `dark:`/full-bleed)
- `@custom-variant dark (&:is(.dark *));` — scopes every `dark:` variant to an ancestor
  `.dark` class. Nothing adds that class, so **the app is always light** regardless of the OS
  setting. Reversible: put `class="dark"` on `<html>` to re-enable dark mode.
- `main:has(> .full-bleed) { padding: 0; }` — opt-in edge-to-edge pages: any page root marked
  `.full-bleed` cancels the layout's main padding (page provides its own spacing).

**`app/shipment-planning/planner/page.jsx`**
- Root div: `full-bleed min-h-screen bg-slate-50 pt-14 pb-20 text-sm text-slate-900 md:pt-0`
  (was `min-h-screen bg-slate-50 … dark:bg-slate-950 dark:text-slate-100`). `pt-14` clears the
  fixed mobile top bar; `md:pt-0` is flush on desktop where the top bar is hidden.
- The early-return "Loading…" div got the same `full-bleed` treatment so the flash before
  data loads is edge-to-edge too.
- All inner `dark:` classes left in place — inert under the scoped variant; if dark mode is
  re-enabled someday they start working again with zero further changes.

### Verification
- Headless Chrome (CDP): `main` computed padding `0px`, page rect starts at `x=256, y=0`
  (flush with the 256px sidebar and viewport top), page bg = light slate-50, cards white,
  dark text, no horizontal scroll, **no console errors**; screenshot confirmed.
- `proxy.js` was TEMPORARILY opened for the diagnostic browser and reverted immediately.

### Order-of-edits note (ties into the stale-CSS gotcha)
Edited the page classes FIRST, then `globals.css` — the globals edit triggers the CSS
rebuild that scans the already-updated page, so the new classes (`full-bleed`, `pt-14`,
`md:pt-0`) are guaranteed to be in the emitted CSS.

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
