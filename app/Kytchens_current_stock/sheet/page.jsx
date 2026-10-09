import { getStockData } from "../../lib/stock";

export const dynamic = "force-dynamic";

export default async function SheetPage() {
  const d = await getStockData();

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-2xl font-bold">Current Stock (Sheet)</h1>

      {d.error && <p className="mt-6 text-red-600">{d.error}</p>}

      {!d.error && (
        <>
          <p className="mt-1 text-sm text-slate-500">
            Live from the Google Sheet
            {d.dateCell ? " · stock as on " + d.dateCell : ""}
          </p>

          <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  {d.rawHeader.map((h, i) => (
                    <th key={i} className="whitespace-nowrap px-4 py-2">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.rawBody.map((r, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    {d.rawHeader.map((_, j) => (
                      <td key={j} className="whitespace-nowrap px-4 py-2">
                        {r[j] || ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}