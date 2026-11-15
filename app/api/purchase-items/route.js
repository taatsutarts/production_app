// app/api/purchase-items/route.js
// Full CRUD for the purchase_items master list (the "Purchase Items" page).
//   GET    ?q=            -> all items (all statuses; the page filters client-side)
//   POST                  -> create (normalized-name dup check)
//   PATCH                 -> update one item (partial; validated fields only)
//   DELETE ?id=           -> SOFT delete: status -> 'inactive'. The item is referenced
//                            by saved bills, vendor mappings and the PO features, so a
//                            hard delete would break history — hiding it is the safe
//                            equivalent, and the page can restore it later.
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { norm } from "@/lib/purchaseMatch";

export const dynamic = "force-dynamic";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const BRAND_TYPES = ["Gourmaison", "Taatsu", "Both"];
const STATUSES = ["Active", "Inactive"];
const CATEGORIES = ["Garnishing", "Packaging", "Beverages", "Dairy", "General", "Other"];

const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(String(v).replace(/[₹,\s]/g, ""));
  return isFinite(x) ? x : null;
};

async function dupCheck(itemName, excludeId) {
  const { data: all, error } = await sb.from("purchase_items").select("id,item_name").limit(10000);
  if (error) return { error: error.message };
  const dup = (all || []).find(
    (r) => norm(r.item_name) === norm(itemName) && String(r.id) !== String(excludeId)
  );
  return { dup: dup || null };
}

export async function GET(request) {
  const q = (request.nextUrl.searchParams.get("q") || "").trim();
  let query = sb
    .from("purchase_items")
    .select("id,item_name,status,uom,uom_size,category,super_category,cost_category,purchase_rate,tax_rate,brand_type,zoho_item_id,used_in_recipe,added_by,modified_at")
    .order("item_name");
  if (q) query = query.ilike("item_name", `%${q}%`).limit(500);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data || [] });
}

export async function POST(request) {
  try {
    const b = await request.json().catch(() => ({}));
    const itemName = String(b.item_name || "").trim().replace(/\s+/g, " ");
    if (!itemName) return NextResponse.json({ error: "Item name is required." }, { status: 400 });
    const brandType = BRAND_TYPES.includes(b.brand_type) ? b.brand_type : null;
    const status = STATUSES.includes(b.status) ? b.status : "Active";

    const { dup, error: dupErr } = await dupCheck(itemName, null);
    if (dupErr) return NextResponse.json({ error: dupErr }, { status: 500 });
    if (dup) {
      return NextResponse.json(
        { error: "duplicate", existing: dup, message: "An item with this name already exists." },
        { status: 409 }
      );
    }

    const { data: created, error } = await sb
      .from("purchase_items")
      .insert({
        item_name: itemName,
        status,
        brand_type: brandType,
        category: String(b.category || "").trim() || null,
        uom: String(b.uom || "").trim() || null,
        uom_size: num(b.uom_size),
        purchase_rate: num(b.purchase_rate),
        tax_rate: num(b.tax_rate),
        used_in_recipe: false,
        added_by: "manual",
        added_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ item: created });
  } catch (err) {
    console.error("purchase-items create failed:", err);
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const b = await request.json().catch(() => ({}));
    if (!b.id) return NextResponse.json({ error: "id is required." }, { status: 400 });

    // only whitelisted, validated fields ever reach the DB
    const patch = {};
    if (b.item_name !== undefined) {
      const itemName = String(b.item_name || "").trim().replace(/\s+/g, " ");
      if (!itemName) return NextResponse.json({ error: "Item name cannot be empty." }, { status: 400 });
      const { dup, error: dupErr } = await dupCheck(itemName, b.id);
      if (dupErr) return NextResponse.json({ error: dupErr }, { status: 500 });
      if (dup) {
        return NextResponse.json(
          { error: "duplicate", existing: dup, message: "Another item already uses this name." },
          { status: 409 }
        );
      }
      patch.item_name = itemName;
    }
    if (b.brand_type !== undefined) {
      if (b.brand_type !== null && b.brand_type !== "" && !BRAND_TYPES.includes(b.brand_type)) {
        return NextResponse.json({ error: "brand_type must be Gourmaison, Taatsu or Both." }, { status: 400 });
      }
      patch.brand_type = b.brand_type === "" ? null : b.brand_type;
    }
    if (b.status !== undefined) {
      if (!STATUSES.includes(b.status)) return NextResponse.json({ error: "Invalid status." }, { status: 400 });
      patch.status = b.status;
    }
    if (b.category !== undefined) patch.category = String(b.category || "").trim() || null;
    if (b.uom !== undefined) patch.uom = String(b.uom || "").trim() || null;
    if (b.uom_size !== undefined) patch.uom_size = num(b.uom_size);
    if (b.purchase_rate !== undefined) patch.purchase_rate = num(b.purchase_rate);
    if (b.tax_rate !== undefined) patch.tax_rate = num(b.tax_rate);
    if (!Object.keys(patch).length) {
      return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    }
    patch.modified_by = "app";
    patch.modified_at = new Date().toISOString();

    const { data: updated, error } = await sb
      .from("purchase_items")
      .update(patch)
      .eq("id", b.id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ item: updated });
  } catch (err) {
    console.error("purchase-items update failed:", err);
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}

export async function DELETE(request) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id query param is required." }, { status: 400 });
  // soft delete — history (bills, mappings, POs) must keep pointing at a real row
  const { error } = await sb
    .from("purchase_items")
    .update({ status: "Inactive", modified_by: "app", modified_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, soft_deleted: true });
}
