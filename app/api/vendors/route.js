// app/api/vendors/route.js
// Full CRUD for the vendors master list (the "Vendors" page).
//   GET    ?q=   -> vendors + bill/mapping counts + default brand name
//   POST         -> create (GSTIN format check; never creates a duplicate GSTIN/name)
//   PATCH        -> update one vendor (validated fields only)
//   DELETE ?id=  -> hard delete, but BLOCKED while bills still reference the vendor
//                   (purchase_bills.vendor_id FK; mappings cascade with the vendor).
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { norm } from "@/lib/purchaseMatch";

export const dynamic = "force-dynamic";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const GSTIN_RE = /^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]{3}$/;

export function cleanGstin(v) {
  const g = String(v || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!g) return null;
  if (!GSTIN_RE.test(g)) return undefined; // invalid marker
  return g;
}

async function dupCheck(vendorName, gstin, excludeId) {
  const { data: all, error } = await sb.from("vendors").select("id,vendor_name,gstin").limit(5000);
  if (error) return { error: error.message };
  const rows = all || [];
  if (gstin) {
    const byGstin = rows.find(
      (v) => (v.gstin || "").toUpperCase() === gstin && String(v.id) !== String(excludeId)
    );
    if (byGstin) return { dup: byGstin, kind: "gstin" };
  }
  const byName = rows.find(
    (v) => norm(v.vendor_name) === norm(vendorName) && String(v.id) !== String(excludeId)
  );
  if (byName) return { dup: byName, kind: "name" };
  return { dup: null };
}

export async function GET(request) {
  const q = (request.nextUrl.searchParams.get("q") || "").trim();
  let query = sb
    .from("vendors")
    .select("id,vendor_name,gstin,phone,email,address,zoho_vendor_id,default_brand_id,default_brand:brands(brand_name),created_at")
    .order("vendor_name");
  if (q) query = query.or(`vendor_name.ilike.%${q}%,gstin.ilike.%${q}%,phone.ilike.%${q}%`).limit(100);
  const [
    { data: vendors, error },
    { data: maps, error: mapErr },
    { data: bills, error: billErr },
    { data: brands, error: brandErr },
  ] = await Promise.all([
    query,
    sb.from("vendor_item_mappings").select("vendor_id"),
    sb.from("purchase_bills").select("vendor_id"),
    sb.from("brands").select("id,brand_name").order("brand_name"),
  ]);
  const firstErr = error || mapErr || billErr || brandErr;
  if (firstErr) return NextResponse.json({ error: firstErr.message }, { status: 500 });
  const mapCount = {};
  for (const m of maps || []) mapCount[m.vendor_id] = (mapCount[m.vendor_id] || 0) + 1;
  const billCount = {};
  for (const b of bills || []) billCount[b.vendor_id] = (billCount[b.vendor_id] || 0) + 1;
  const rows = (vendors || []).map((v) => ({
    ...v,
    mapping_count: mapCount[v.id] || 0,
    bill_count: billCount[v.id] || 0,
  }));
  return NextResponse.json({ vendors: rows, brands: brands || [] });
}

export async function POST(request) {
  try {
    const b = await request.json().catch(() => ({}));
    const vendorName = String(b.vendor_name || "").trim().replace(/\s+/g, " ");
    if (!vendorName) return NextResponse.json({ error: "Vendor name is required." }, { status: 400 });
    const gstin = cleanGstin(b.gstin);
    if (gstin === undefined) {
      return NextResponse.json(
        { error: "GSTIN looks invalid — expected 15 characters like 27AAPFU0939F1ZV." },
        { status: 400 }
      );
    }
    const { dup, kind, error: dupErr } = await dupCheck(vendorName, gstin, null);
    if (dupErr) return NextResponse.json({ error: dupErr }, { status: 500 });
    if (dup) {
      return NextResponse.json(
        { error: "duplicate", existing: dup, message: kind === "gstin" ? "A vendor with this GSTIN already exists." : "A vendor with a very similar name already exists." },
        { status: 409 }
      );
    }
    const { data: created, error } = await sb
      .from("vendors")
      .insert({
        vendor_name: vendorName,
        gstin,
        phone: String(b.phone || "").trim() || null,
        email: String(b.email || "").trim() || null,
        address: String(b.address || "").trim() || null,
        zoho_vendor_id: String(b.zoho_vendor_id || "").trim() || null,
        default_brand_id: b.default_brand_id || null,
      })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ vendor: created });
  } catch (err) {
    console.error("vendor create failed:", err);
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const b = await request.json().catch(() => ({}));
    if (!b.id) return NextResponse.json({ error: "id is required." }, { status: 400 });

    const patch = {};
    if (b.vendor_name !== undefined) {
      const vendorName = String(b.vendor_name || "").trim().replace(/\s+/g, " ");
      if (!vendorName) return NextResponse.json({ error: "Vendor name cannot be empty." }, { status: 400 });
      patch.vendor_name = vendorName;
    }
    let gstinProvided = false;
    let gstin;
    if (b.gstin !== undefined) {
      gstin = cleanGstin(b.gstin);
      if (gstin === undefined) {
        return NextResponse.json(
          { error: "GSTIN looks invalid — expected 15 characters like 27AAPFU0939F1ZV." },
          { status: 400 }
        );
      }
      patch.gstin = gstin;
      gstinProvided = true;
    }
    if (b.phone !== undefined) patch.phone = String(b.phone || "").trim() || null;
    if (b.email !== undefined) patch.email = String(b.email || "").trim() || null;
    if (b.address !== undefined) patch.address = String(b.address || "").trim() || null;
    if (b.zoho_vendor_id !== undefined) patch.zoho_vendor_id = String(b.zoho_vendor_id || "").trim() || null;
    if (b.default_brand_id !== undefined) patch.default_brand_id = b.default_brand_id || null;

    // duplicate checks against OTHER vendors (name always; GSTIN when it changes)
    const { data: self, error: selfErr } = await sb
      .from("vendors")
      .select("id,vendor_name,gstin")
      .eq("id", b.id)
      .maybeSingle();
    if (selfErr) return NextResponse.json({ error: selfErr.message }, { status: 500 });
    if (!self) return NextResponse.json({ error: "Vendor not found." }, { status: 404 });
    const { dup, kind, error: dupErr } = await dupCheck(
      patch.vendor_name ?? self.vendor_name,
      gstinProvided ? patch.gstin : self.gstin,
      b.id
    );
    if (dupErr) return NextResponse.json({ error: dupErr }, { status: 500 });
    if (dup) {
      return NextResponse.json(
        { error: "duplicate", existing: dup, message: kind === "gstin" ? "Another vendor already uses this GSTIN." : "Another vendor already uses this name." },
        { status: 409 }
      );
    }

    if (!Object.keys(patch).length) {
      return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    }
    patch.updated_at = new Date().toISOString();
    const { data: updated, error } = await sb
      .from("vendors")
      .update(patch)
      .eq("id", b.id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ vendor: updated });
  } catch (err) {
    console.error("vendor update failed:", err);
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const id = request.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id query param is required." }, { status: 400 });
    // friendly block before the FK error: bills reference this vendor
    const { count, error: cntErr } = await sb
      .from("purchase_bills")
      .select("id", { count: "exact", head: true })
      .eq("vendor_id", id);
    if (cntErr) return NextResponse.json({ error: cntErr.message }, { status: 500 });
    if (count > 0) {
      return NextResponse.json(
        { error: "referenced", message: `This vendor has ${count} saved bill(s) — vendors used by bills cannot be deleted.` },
        { status: 409 }
      );
    }
    const { error } = await sb.from("vendors").delete().eq("id", id); // mappings cascade
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("vendor delete failed:", err);
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}
