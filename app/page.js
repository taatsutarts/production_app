import Link from "next/link";

export default function Home() {
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold md:text-3xl">
        Taatsu Production & Shipment Management
      </h1>
      <p className="mt-1 text-slate-500">Select a module to get started.</p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link
          href="/production"
          className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-blue-500 hover:shadow-md"
        >
          <div className="text-3xl">🏭</div>
          <h2 className="mt-3 font-semibold group-hover:text-blue-600">Production</h2>
          <p className="mt-1 text-sm text-slate-500">
            Record and review daily production.
          </p>
        </Link>

        <Link
          href="/items"
          className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-blue-500 hover:shadow-md"
        >
          <div className="text-3xl">🏭</div>
          <h2 className="mt-3 font-semibold group-hover:text-blue-600">Item Master</h2>
          <p className="mt-1 text-sm text-slate-500">
            Taatsu Items List
          </p>
        </Link>
      </div>
    </div>
  );
}