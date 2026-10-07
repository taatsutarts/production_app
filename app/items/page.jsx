import { supabase } from "../lib/supabase";

export const dynamic = "force-dynamic";

export default async function ItemsPage() {
  const { data: items } = await supabase
    .from("items")
    .select("id, item_name, category")
    .order("id");

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold">Items ({items?.length || 0})</h1>

      <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th className="px-4 py-2">#</th>
              <th className="px-4 py-2">Item</th>
              <th className="px-4 py-2">Category</th>
            </tr>
          </thead>
          <tbody>
            {(items || []).map((item) => (
              <tr key={item.id} className="border-t border-slate-100">
                <td className="px-4 py-2 text-slate-400">{item.id}</td>
                <td className="px-4 py-2">{item.item_name}</td>
                <td className="px-4 py-2 text-slate-500">{item.category}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}