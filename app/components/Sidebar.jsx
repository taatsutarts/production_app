"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Home", icon: "🏠" },
  { href: "/production", label: "Production Import with AI", icon: "🏭" },
  { href: "/items", label: "Items", icon: "📋" },
  { href: "/outlets", label: "Outlets", icon: "🏪" },
  { href: "/daily-production", label: "Daily Production", icon: "📅" },
  { href: "/totals", label: "CK Closing Stock", icon: "➕" },
  { href: "/trends", label: "Production Trends", icon: "📈" },
  {
    label: "Outlets Current Stock",
    icon: "📦",
    base: "/Kytchens_current_stock",
    children: [
      { href: "/Kytchens_current_stock/sheet", label: "Current Stock (Sheet)" },
      { href: "/Kytchens_current_stock/by-outlet", label: "Stock by Outlet" },
    ],
  },

  {
  label: "Shipment Planning",
  icon: "🚚",
  base: "/shipment-planning",
  children: [
    { href: "/shipment-planning/send", label: "Send to Outlet" },
    { href: "/shipment-planning/trend", label: "Outlet Stock Trend" },
    { href: "/shipment-planning/plan", label: "Plan Shipment" },
  ],
},
];

export default function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState({});

  const isActive = (href) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

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
          className="text-xl"
        >
          ☰
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
          <p className="text-xs text-slate-400">Production & Shipment</p>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {NAV.map((item) => {
            // normal button
            if (!item.children) {
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={linkClass(isActive(item.href))}
                >
                  <span className="text-base">{item.icon}</span>
                  {item.label}
                </Link>
              );
            }

            // button with sub buttons
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
                  <span className="text-base">{item.icon}</span>
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

        <div className="border-t border-slate-800 px-6 py-4 text-xs text-slate-500">
          v1.0
        </div>
      </aside>
    </>
  );
}