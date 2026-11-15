// app/api/items/route.js
// Full CRUD for the production master items table (the "Items" page).
//   GET    ?q=   -> all items + how often production / spoilages reference each
//   POST         -> create (normalized-name dup check)
//   PATCH        -> update one item (partial; validated fields only)
//   DELETE ?id=  -> SOFT delete: is_active -> false. Items are referenced by
//                   production, spoilages, item_aliases and item_sales_share, so a
//                   hard delete would break history — the page can Restore instead.
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { norm } from "@/lib/purchaseMatch";

export const dynamic = "force-dynamic";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(String(v).replace(/[,\s]/g, ""));
  return isFinite(x) && x >= 0 ? x : null;
};

async function dupCheck(itemName, excludeId) {
  const { data: all, error } = await sb.from("items").select("id,item_name").limit(5000);
  if (error) return { error: error.message };
  const dup = (all || []).find(
    (r) => norm(r.item_name) === norm(itemName) && String(r.id) !== String(excludeId)
  );
  return { dup: dup || null };
}

export async function GET(request) {
  const q = (request.nextUrl.searchParams.get("q") || "").trim();
  let query = sb
    .from("items")
    .select("id,item_name,category,batch_size,is_active,created_at,updated_at")
    .order("item_name");
  if (q) query = query.ilike("item_name", `%${q}%`).limit(500);
  const [{ data: items, error }, { data: prod, error: prodErr }, { data: spoil, error: spoilErr }] =
    await Promise.all([
      query,
      sb.from("production").select("item_id"),
      sb.from("spoilages").select("item_id"),
    ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (prodErr || spoilErr) console.error("items reference-count fetch failed:", prodErr || spoilErr);
  const prodCount = {};
  for (const r of prod || []) prodCount[r.item_id] = (prodCount[r.item_id] || 0) + 1;
  const spoilCount = {};
  for (const r of spoil || []) spoilCount[r.item_id] = (spoilCount[r.item_id] || 0) + 1;
  const rows = (items || []).map((i) => ({
    ...i,
    production_count: prodCount[i.id] || 0,
    spoilage_count: spoilCount[i.id] || 0,
  }));
  return NextResponse.json({ items: rows });
}

export async function POST(request) {
  try {
    const b = await request.json().catch(() => ({}));
    const itemName = String(b.item_name || "").trim().replace(/\s+/g, " ");
    if (!itemName) return NextResponse.json({ error: "Item name is required." }, { status: 400 });

    const { dup, error: dupErr } = await dupCheck(itemName, null);
    if (dupErr) return NextResponse.json({ error: dupErr }, { status: 500 });
    if (dup) {
      return NextResponse.json(
        { error: "duplicate", existing: dup, message: "An item with this name already exists." },
        { status: 409 }
      );
    }

    const { data: created, error } = await sb
      .from("items")
      .insert({
        item_name: itemName,
        category: String(b.category || "").trim() || null,
        batch_size: num(b.batch_size),
        is_active: true,
      })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ item: created });
  } catch (err) {
    console.error("items create failed:", err);
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const b = await request.json().catch(() => ({}));
    if (!b.id) return NextResponse.json({ error: "id is required." }, { status: 400 });

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
    if (b.category !== undefined) patch.category = String(b.category || "").trim() || null;
    if (b.batch_size !== undefined) patch.batch_size = num(b.batch_size);
    if (b.is_active !== undefined) {
      const active = b.is_active === true || b.is_active === "true";
      const inactive = b.is_active === false || b.is_active === "false";
      if (!active && !inactive) return NextResponse.json({ error: "is_active must be true or false." }, { status: 400 });
      patch.is_active = active;
    }
    if (!Object.keys(patch).length) {
      return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    }
    patch.updated_at = new Date().toISOString();

    const { data: updated, error } = await sb
      .from("items")
      .update(patch)
      .eq("id", b.id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ item: updated });
  } catch (err) {
    console.error("items update failed:", err);
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}

export async function DELETE(request) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id query param is required." }, { status: 400 });
  // soft delete — production, spoilages and aliases keep pointing at a real row
  const { error } = await sb
    .from("items")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, soft_deleted: true });
}
