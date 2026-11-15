// app/api/purchase-bills/items/route.js
// GET   -> active master-item catalog (review dropdowns + the "Item brands" page)
// POST  -> create a master item (dup-checked by normalized name; never silent)
// PATCH -> set brand_type on one or many items at once (bulk classify)
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { norm } from "@/lib/purchaseMatch";

export const dynamic = "force-dynamic";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const BRAND_TYPES = ["Gourmaison", "Taatsu", "Both"];

export async function GET() {
  const { data, error } = await sb
    .from("purchase_items")
    .select("id,item_name,uom,uom_size,category,brand_type,status,purchase_rate")
    .eq("status", "Active")
    .order("item_name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data || [] });
}

export async function POST(request) {
  try {
    const b = await request.json().catch(() => ({}));
    const itemName = String(b.item_name || "").trim().replace(/\s+/g, " ");
    if (!itemName) {
      return NextResponse.json({ error: "Item name is required." }, { status: 400 });
    }
    const brandType = BRAND_TYPES.includes(b.brand_type) ? b.brand_type : null;

    // duplicate check — same normalized name must not create a second master item
    const { data: all, error: allErr } = await sb
      .from("purchase_items")
      .select("id,item_name")
      .limit(10000);
    if (allErr) return NextResponse.json({ error: allErr.message }, { status: 500 });
    const dup = (all || []).find((r) => norm(r.item_name) === norm(itemName));
    if (dup) {
      return NextResponse.json(
        { error: "duplicate", existing: dup, message: "An item with this name already exists." },
        { status: 409 }
      );
    }

    const rate = Number(String(b.purchase_rate ?? "").replace(/[₹,\s]/g, ""));
    const { data: created, error } = await sb
      .from("purchase_items")
      .insert({
        item_name: itemName,
        status: "Active",
        used_in_recipe: false, // required column; master items for buying are not recipe items
        brand_type: brandType,
        uom: String(b.uom || "").trim() || null,
        purchase_rate: isFinite(rate) && rate > 0 ? rate : null,
        added_by: "manual",
        added_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ item: created });
  } catch (err) {
    console.error("item create failed:", err);
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const b = await request.json().catch(() => ({}));
    const ids = (Array.isArray(b.ids) ? b.ids : b.id ? [b.id] : []).map(Number).filter(Boolean);
    if (!ids.length) {
      return NextResponse.json({ error: "ids (array) are required." }, { status: 400 });
    }
    if (ids.length > 500) {
      return NextResponse.json({ error: "Too many ids (max 500 per call)." }, { status: 400 });
    }
    const brandType = b.brand_type === "" || b.brand_type == null ? null : String(b.brand_type);
    if (brandType && !BRAND_TYPES.includes(brandType)) {
      return NextResponse.json(
        { error: "brand_type must be Gourmaison, Taatsu, Both (or empty)." },
        { status: 400 }
      );
    }
    const { error } = await sb.from("purchase_items").update({ brand_type: brandType }).in("id", ids);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ updated: ids.length });
  } catch (err) {
    console.error("item brand_type patch failed:", err);
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}
