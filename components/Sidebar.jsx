"use client";
// App sidebar. Icons are minimal single-color inline SVGs (stroke = currentColor),
// no emoji, no icon dependency.
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { menuFor } from "@/lib/access"; // the page registry: add pages there

/* ---------- minimal icon set (24x24, stroke) ---------- */
const ICONS = {
  home: (
    <>
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5.5 10v10h13V10" />
    </>
  ),
  cart: (
    <>
      <circle cx="9" cy="20" r="1.4" />
      <circle cx="17.5" cy="20" r="1.4" />
      <path d="M2.5 3.5h2l2.4 12.1a1.2 1.2 0 0 0 1.2 1h9.7a1.2 1.2 0 0 0 1.2-.9L21 8H6.2" />
    </>
  ),
  factory: (
    <>
      <path d="M3 21V9.5l5.5 3.75V9.5L14 13.25V9.5l7 4.5V21H3Z" />
      <path d="M7.5 17.5h.01M11.5 17.5h.01M15.5 17.5h.01" />
    </>
  ),
  list: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 20v-1a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v1" />
      <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8" />
      <path d="M21 20v-1a5 5 0 0 0-3.5-4.8" />
    </>
  ),
  receipt: (
    <>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
      <path d="M9.5 8h5M9.5 12h5" />
    </>
  ),
  package: (
    <>
      <path d="M21 8.5 12 3.5l-9 5v7l9 5 9-5v-7Z" />
      <path d="M3 8.5l9 5 9-5" />
      <path d="M12 13.5V21" />
    </>
  ),
  store: (
    <>
      <path d="M4 9.5 5.5 4h13L20 9.5" />
      <path d="M5 9.5V20h14V9.5" />
      <path d="M9.5 20v-5.5h5V20" />
    </>
  ),
  chart: (
    <>
      <path d="M3.5 20.5h17" />
      <path d="M7 20.5v-8M12 20.5V6.5M17 20.5v-5" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="16" rx="2" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9.5 7V4.5h5V7" />
      <path d="M6.5 7l.8 13h9.4l.8-13" />
      <path d="M10 11v5M14 11v5" />
    </>
  ),
  calculator: (
    <>
      <rect x="5" y="3.5" width="14" height="17" rx="2" />
      <path d="M8.5 7.5h7" />
      <path d="M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 15.5h.01M12 15.5h.01M15.5 15.5h.01" />
    </>
  ),
  trendUp: (
    <>
      <path d="M3 17l6-6 4 4 8-8.5" />
      <path d="M15 6.5h6v6" />
    </>
  ),
  warehouse: (
    <>
      <path d="M3 21V8.5L12 3l9 5.5V21" />
      <path d="M7 21v-8h10v8" />
      <path d="M3 21h18" />
    </>
  ),
  send: (
    <>
      <path d="M22 2.5 11 13.5" />
      <path d="M22 2.5 15 21.5l-4-8.5-8.5-4L22 2.5Z" />
    </>
  ),
  truck: (
    <>
      <path d="M2.5 5.5H14v11.5H2.5V5.5Z" />
      <path d="M14 8.5h4.2l2.3 3.5v5H14" />
      <circle cx="6.7" cy="18.3" r="1.9" />
      <circle cx="17" cy="18.3" r="1.9" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21.5S5.5 15.8 5.5 10.5a6.5 6.5 0 0 1 13 0c0 5.3-6.5 11-6.5 11Z" />
      <circle cx="12" cy="10.5" r="2.3" />
    </>
  ),
  boxes: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.2" />
    </>
  ),
  logout: (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
};

function Icon({ name, className = "h-[18px] w-[18px] shrink-0" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {ICONS[name] || ICONS.list}
    </svg>
  );
}

export default function Sidebar({ profile }) {
  const isStore = profile?.role === "store";
  const nav = menuFor(profile?.role);
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState({});

  // must stay AFTER all hooks
  if (pathname === "/login") return null;

  async function handleLogout() {
    await createClient().auth.signOut();
    setOpen(false);
    router.push("/login");
    router.refresh();
  }

  // Home links ("/" admin, "/store" store) match exactly; every other link matches its subpages too
  const isActive = (href) =>
    href === "/" || href === "/store" ? pathname === href : pathname.startsWith(href);

  const linkClass = (active) =>
    `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
      active ? "bg-blue-600 text-white" : "hover:bg-slate-800 hover:text-white"
    }`;

  return (
    <>
      {/* Mobile top bar */}
      <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-3 bg-slate-900 px-4 text-white md:hidden">
        <button
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="text-slate-200"
        >
          <Icon name="menu" className="h-5 w-5" />
        </button>
        <span className="font-semibold tracking-wide">TAATSU</span>
      </header>

      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-slate-900 text-slate-300 transition-transform duration-200 md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="border-b border-slate-800 px-6 py-5">
          <p className="text-lg font-bold tracking-widest text-white">TAATSU</p>
          <p className="text-xs text-slate-400">
            {isStore ? `${profile.outletName || "Store"} store` : "Production & Shipment"}
          </p>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {nav.map((item) => {
            if (!item.children) {
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={linkClass(isActive(item.href))}
                >
                  <Icon name={item.icon} />
                  {item.label}
                </Link>
              );
            }

            const groupActive = pathname.startsWith(item.base);
            const isOpen = expanded[item.label] ?? groupActive;

            return (
              <div key={item.label}>
                <button
                  onClick={() =>
                    setExpanded({ ...expanded, [item.label]: !isOpen })
                  }
                  className={`${linkClass(false)} w-full ${
                    groupActive ? "text-white" : ""
                  }`}
                >
                  <Icon name={item.icon} />
                  <span className="flex-1 text-left">{item.label}</span>
                  <span className="text-xs">{isOpen ? "▾" : "▸"}</span>
                </button>

                {isOpen && (
                  <div className="ml-5 mt-1 space-y-1 border-l border-slate-700 pl-3">
                    {item.children.map((child) => (
                      <Link
                        key={child.href}
                        href={child.href}
                        onClick={() => setOpen(false)}
                        className={`block rounded-lg px-3 py-2 text-sm transition-colors ${
                          isActive(child.href)
                            ? "bg-blue-600 text-white"
                            : "hover:bg-slate-800 hover:text-white"
                        }`}
                      >
                        {child.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className="border-t border-slate-800 px-3 py-3">
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors hover:bg-slate-800 hover:text-white"
          >
            <Icon name="logout" />
            Log out
          </button>
          <p className="px-3 pt-2 text-xs text-slate-500">v1.0</p>
        </div>
      </aside>
    </>
  );
}
