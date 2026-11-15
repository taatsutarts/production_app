// app/api/vendors/mappings/route.js
// Vendor wording -> master item mappings, managed on the Vendors page.
//   GET    ?vendor_id= -> that vendor's mappings (+ item name)
//   PATCH  { id, item_id } -> repoint a mapping to another master item
//   DELETE ?id=        -> remove a wrong mapping (the next bill re-asks it)
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export async function GET(request) {
  const vendorId = request.nextUrl.searchParams.get("vendor_id");
  if (!vendorId) return NextResponse.json({ error: "vendor_id query param is required." }, { status: 400 });
  const { data, error } = await sb
    .from("vendor_item_mappings")
    .select("id,vendor_id,vendor_item_name,normalized_vendor_item_name,item_id,created_at,item:purchase_items(id,item_name,brand_type)")
    .eq("vendor_id", vendorId)
    .order("vendor_item_name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ mappings: data || [] });
}

export async function PATCH(request) {
  try {
    const b = await request.json().catch(() => ({}));
    if (!b.id || !b.item_id) {
      return NextResponse.json({ error: "id and item_id are required." }, { status: 400 });
    }
    const { error } = await sb
      .from("vendor_item_mappings")
      .update({ item_id: b.item_id, updated_at: new Date().toISOString() })
      .eq("id", b.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("mapping repoint failed:", err);
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}

export async function DELETE(request) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id query param is required." }, { status: 400 });
  const { error } = await sb.from("vendor_item_mappings").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
