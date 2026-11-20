// Store home (/store): one card per store page, taken from STORE_PAGES (lib/access.js).
import Link from "next/link";
import { getProfile } from "@/lib/profile";
import { storeHomeCards } from "@/lib/access";

export default async function StoreHome() {
  const profile = await getProfile();
  const cards = storeHomeCards();
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold md:text-3xl">Taatsu · {profile.outletName || "Store"}</h1>
      <p className="mt-1 text-slate-500">Select a module to get started.</p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-blue-500 hover:shadow-md"
          >
            <h2 className="font-semibold group-hover:text-blue-600">{c.label}</h2>
            <p className="mt-1 text-sm text-slate-500">{c.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
