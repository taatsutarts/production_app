"use client";

/* Closing stock for ONE store (/shipment-planning/closing-stock/<store>) — the admin
 * view of a store's page. The store is matched from the outlets table by URL slug
 * ("Matunga" -> "matunga"); the form itself is StoreClosingForm (shared with the
 * store login's own page, /store/closing-stock).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { slugify, fetchActiveStores, card, mute } from "../shared";
import StoreClosingForm from "../StoreClosingForm";

export default function StoreClosingStockPage() {
  const params = useParams();
  const slug = (params?.store || "").toString().toLowerCase();

  const [store, setStore] = useState(undefined); // undefined = loading, null = no match
  const [stores, setStores] = useState(null); // all active stores (for the not-found card)
  const [err, setErr] = useState(null);

  useEffect(() => {
    let alive = true;
    fetchActiveStores().then(({ data, error }) => {
      if (!alive) return;
      if (error) { setErr(error.message); setStore(null); return; }
      const list = data || [];
      setStores(list);
      setStore(list.find((s) => slugify(s.name).toLowerCase() === slug) || null);
    });
    return () => {
      alive = false;
    };
  }, [slug]);

  if (store) return <StoreClosingForm store={store} />;

  return (
    <div className="full-bleed min-h-screen bg-slate-50 pt-14 pb-20 text-base text-slate-900 md:pt-0">
      <div className="mx-auto max-w-[560px] px-3 sm:px-5">
        <header className="py-4">
          <h1 className="text-lg font-semibold tracking-tight">Closing stock</h1>
        </header>
        {store === undefined ? (
          <div className={`${card} text-center font-medium text-slate-500`}>Loading store…</div>
        ) : (
          <div className={card}>
            <div className="font-semibold text-rose-600">Store not found</div>
            <div className={`${mute} mt-1`}>
              {err ? "Could not read the outlets table: " + err : "No active store in the outlets table matches this link's address."}
              {stores && stores.length > 0 && (
                <div className="mt-2">
                  The store pages are:
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {stores.map((s) => (
                      <Link
                        key={s.id}
                        href={`/shipment-planning/closing-stock/${slugify(s.name)}`}
                        className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-medium hover:bg-slate-100"
                      >
                        {s.name}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
