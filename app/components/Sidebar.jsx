"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Home", icon: "🏠" },
  { href: "/production", label: "Production", icon: "🏭" },
  { href: "/items", label: "Items", icon: "📋" },
  { href: "/daily-production", label: "Daily Production", icon: "📅" },
  { href: "/totals", label: "Opening + Production", icon: "➕" },
  { href: "/trends", label: "Production Trends", icon: "📈" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <>
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

        <nav className="flex-1 space-y-1 px-3 py-4">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive(item.href)
                  ? "bg-blue-600 text-white"
                  : "hover:bg-slate-800 hover:text-white"
              }`}
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="border-t border-slate-800 px-6 py-4 text-xs text-slate-500">
          v1.0
        </div>
      </aside>
    </>
  );
}