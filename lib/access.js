// lib/access.js — THE page registry. Two plain lists: what admins see, what stores see.
// The menus, the store home cards and the route guard (proxy.js) all read it.
// Pure data + helpers (no server imports, no JSX) so proxy.js can use it too.
//
// ── The layout ─────────────────────────────────────────────────────────────────
//   admin pages  → anywhere in app/ (as always), listed in ADMIN_PAGES
//   store pages  → ONLY under app/store/…  (URL /store/…), listed in STORE_PAGES
// proxy.js: a store login can open nothing but /store/*; an admin login is sent away
// from /store/* (those pages need a store's outlet). app/store/layout.js re-checks it.
//
// ── How to add a STORE page ────────────────────────────────────────────────────
//   1. create  app/store/<name>/page.jsx          → URL /store/<name>
//   2. add one line to STORE_PAGES below:
//        { href: "/store/<name>", label: "My page", icon: "list", desc: "Text for the home card." },
//   3. get the logged-in store:  server page → `await getProfile()` (lib/profile.js)
//                                client page → `useProfile()` (components/ProfileProvider.jsx)
//      both give { role, outletId, outletName }.
//   4. NEW TABLE? give stores an RLS policy (template below) — the database, not the page,
//      is what limits a store to its own rows.
//   Want to reuse an admin page's UI? Put the UI in a component (e.g. FooView.jsx next to the
//   admin page) with a prop for the difference (readOnly, lockedOutletId…) and render it from
//   both pages — see app/dispatches/DispatchesView.jsx for the pattern.
//
// ── How to add an ADMIN page ───────────────────────────────────────────────────
//   create the page anywhere in app/ and add a line to ADMIN_PAGES (or a group's children).
//
// Store database rule template (Supabase SQL editor):
//    create policy store_<table>_rw on public.<table> for all to authenticated
//      using (outlet_id = public.my_outlet()) with check (outlet_id = public.my_outlet());
//    ("for select" instead of "for all" for read-only tables). Admins already have full access
//    to every table through the generic admin policy.
// ────────────────────────────────────────────────────────────────────────────────
//
//   leaf  { href, label, icon, desc? }
//   group { label, icon, base, children: [leaf…] }   (admin menu only)
//   icon = a name from the ICONS map in components/Sidebar.jsx

export const NO_ACCESS_PATH = "/no-access";
export const STORE_HOME = "/store";

export const ADMIN_PAGES = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/gourmaison/shopify-orders", label: "Shopify Orders", icon: "cart" },
  { href: "/production", label: "Production Import", icon: "factory" },
  { href: "/items", label: "Items", icon: "list" },
  { href: "/vendors", label: "Vendors", icon: "users" },
  { href: "/purchase-items", label: "Purchase Items", icon: "package" },
  { href: "/purchase-bills", label: "Purchase Bills", icon: "receipt" },
  { href: "/outlets", label: "Outlets", icon: "store" },
  { href: "/daily-stock-report", label: "Daily Stock Report", icon: "chart" },
  { href: "/daily-production", label: "Daily Production", icon: "calendar" },
  { href: "/spoilage", label: "Spoilages", icon: "trash" },
  { href: "/totals", label: "CK Closing Stock", icon: "calculator" },
  { href: "/trends", label: "Production Trends", icon: "trendUp" },
  {
    label: "Outlets Current Stock",
    icon: "warehouse",
    base: "/Kytchens_current_stock",
    children: [
      { href: "/Kytchens_current_stock/sheet", label: "Current Stock (Sheet)" },
      { href: "/Kytchens_current_stock/by-outlet", label: "Stock by Outlet" },
    ],
  },
  {
    label: "Shipment Planning",
    icon: "send",
    base: "/shipment-planning",
    children: [
      { href: "/shipment-planning/planner", label: "Planner" },
      { href: "/shipment-planning/closing-stock", label: "Outlet Closing Stock" },
      { href: "/shipment-planning/po-send", label: "Send PO" },
      { href: "/shipment-planning/trend", label: "Outlet Stock Trend" },
    ],
  },
  { href: "/dispatches", label: "Dispatches", icon: "truck" },
  { href: "/dispatch_tracker", label: "Dispatch Tracker", icon: "pin" },
  {
    label: "Supplies Dispatches",
    icon: "boxes",
    base: "/dispatch",
    children: [
      { href: "/dispatch/challan", label: "Generage Supplies Challan" },
      { href: "/dispatch/requirement", label: "Supplies Monthly Req" },
    ],
  },
];

export const STORE_PAGES = [
  { href: STORE_HOME, label: "Home", icon: "home" },
  {
    href: "/store/closing-stock",
    label: "Closing Stock",
    icon: "calculator",
    desc: "Enter today's end-of-day stock.",
  },
  {
    href: "/store/dispatches",
    label: "Dispatches",
    icon: "truck",
    desc: "What the kitchen sent to your store.",
  },
  {
    href: "/store/dispatch-tracker",
    label: "Dispatch Tracker",
    icon: "pin",
    desc: "Your dispatches over time.",
  },
  {
    href: "/store/spoilage",
    label: "Spoilages",
    icon: "trash",
    desc: "Record and review spoiled stock.",
  },
  {
    href: "/store/current-stock",
    label: "Current Stock",
    icon: "warehouse",
    desc: "Your store's current stock.",
  },
  {
    href: "/store/stock-trend",
    label: "Stock Trend",
    icon: "trendUp",
    desc: "When your store needs the next delivery.",
  },
  // ── add new store pages here ──
];

/* ---------- helpers (proxy.js, Sidebar, store home) ---------- */

export const menuFor = (role) =>
  role === "admin" ? ADMIN_PAGES : role === "store" ? STORE_PAGES : [];

// cards on the store home (every store page that has a desc)
export const storeHomeCards = () => STORE_PAGES.filter((p) => p.desc);

// a store login may open the store area only
export const storeMayOpen = (pathname) =>
  pathname === STORE_HOME || pathname.startsWith(STORE_HOME + "/");
