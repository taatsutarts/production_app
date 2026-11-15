// app/api/purchase-bills/match/route.js
// Server-side matching for the bill review screen. READ-ONLY: nothing is saved here.
// Input:  { vendor_gstin, vendor_name, vendor_id, items: [{ description }] }
// Output:
//   vendor:      { matched: <vendor|null>, candidates: [...] } — candidates are ADVICE,
//                never auto-linked (uncertain name matches must be confirmed by a person)
//   brands:      [ { id, brand_name } ]
//   items:       active master catalog for the review dropdowns
//   resolved:    [ { line, item_id, item_name, how: "mapping" | "exact" } ] — confident only:
//                this vendor's confirmed mapping, or an exact master-item name hit
//   suggestions: [ { line, options: [ { id, item_name, score } ] } ] — cautious similarity
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { norm, suggestItems, suggestVendors } from "@/lib/purchaseMatch";

export const dynamic = "force-dynamic";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const gstin = String(body.vendor_gstin || "").trim().toUpperCase();
    const name = String(body.vendor_name || "").trim();
    const lines = Array.isArray(body.items) ? body.items : [];

    // 1. catalog + brands + vendor list (small tables — one call each)
    const [itemsRes, brandsRes, vendorsRes] = await Promise.all([
      sb
        .from("purchase_items")
        .select("id,item_name,brand_type,uom")
        .eq("status", "Active")
        .order("item_name"),
      sb.from("brands").select("id,brand_name").order("brand_name"),
      sb.from("vendors").select("id,vendor_name,gstin").order("vendor_name").limit(2000),
    ]);
    const firstErr = itemsRes.error || brandsRes.error || vendorsRes.error;
    if (firstErr) return NextResponse.json({ error: firstErr.message }, { status: 500 });
    const catalog = itemsRes.data || [];
    const brands = brandsRes.data || [];
    const vendors = vendorsRes.data || [];

    // 2. vendor resolution — GSTIN is the stable identifier; name matches are only
    //    suggestions. An explicit vendor_id (linked earlier / editing a saved bill) wins.
    let matched = null;
    if (body.vendor_id) {
      const { data: byId, error: idErr } = await sb
        .from("vendors")
        .select("id,vendor_name,gstin")
        .eq("id", body.vendor_id)
        .maybeSingle();
      if (idErr) return NextResponse.json({ error: idErr.message }, { status: 500 });
      matched = byId || null;
    } else if (gstin) {
      const { data: byGstin, error: gErr } = await sb
        .from("vendors")
        .select("id,vendor_name,gstin")
        .eq("gstin", gstin)
        .limit(1);
      if (gErr) return NextResponse.json({ error: gErr.message }, { status: 500 });
      matched = (byGstin || [])[0] || null;
    }
    const candidates = !matched && name ? suggestVendors(name, vendors) : [];

    // 3. this vendor's confirmed wording -> item mappings
    let mappingMap = new Map();
    if (matched) {
      const { data: maps, error: mErr } = await sb
        .from("vendor_item_mappings")
        .select("normalized_vendor_item_name,vendor_item_name,item_id")
        .eq("vendor_id", matched.id);
      if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });
      mappingMap = new Map((maps || []).map((m) => [m.normalized_vendor_item_name, m]));
    }
    const byNormName = new Map(catalog.map((c) => [norm(c.item_name), c]));

    // 4. per line: confirmed mapping -> exact master name -> cautious suggestions
    const resolved = [];
    const suggestions = [];
    lines.forEach((l, i) => {
      const key = norm(l && l.description);
      if (!key) return;
      const m = mappingMap.get(key);
      if (m) {
        const cat = catalog.find((c) => c.id === m.item_id);
        if (cat) {
          resolved.push({ line: i, item_id: cat.id, item_name: cat.item_name, how: "mapping" });
          return;
        }
      }
      const exact = byNormName.get(key);
      if (exact) {
        resolved.push({ line: i, item_id: exact.id, item_name: exact.item_name, how: "exact" });
        return;
      }
      const opts = suggestItems(l.description, catalog);
      if (opts.length) suggestions.push({ line: i, options: opts });
    });

    return NextResponse.json({
      vendor: { matched, candidates },
      brands,
      items: catalog,
      resolved,
      suggestions,
    });
  } catch (err) {
    console.error("purchase-bills match failed:", err);
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}
