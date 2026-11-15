// app/api/purchase-bills/vendors/route.js
// GET  ?q=...  -> search vendors (name or GSTIN)
// POST         -> create a vendor after human review (dup-checked: same GSTIN or the
//                 same normalized name never creates a second vendor — the existing
//                 one is returned so the UI can offer "use it").
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { norm } from "@/lib/purchaseMatch";

export const dynamic = "force-dynamic";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// 15 chars, e.g. 27AAPFU0939F1ZV (lenient: digits/letters, state code can be A-Z/digit)
const GSTIN_RE = /^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]{3}$/;

export async function GET(request) {
  const q = (request.nextUrl.searchParams.get("q") || "").trim();
  let query = sb
    .from("vendors")
    .select("id,vendor_name,gstin,phone,email,default_brand_id")
    .order("vendor_name")
    .limit(20);
  if (q) query = query.or(`vendor_name.ilike.%${q}%,gstin.ilike.%${q}%`);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ vendors: data || [] });
}

export async function POST(request) {
  try {
    const b = await request.json().catch(() => ({}));
    const vendorName = String(b.vendor_name || "").trim();
    if (!vendorName) {
      return NextResponse.json({ error: "Vendor name is required." }, { status: 400 });
    }
    const gstin = String(b.gstin || "").trim().toUpperCase().replace(/\s+/g, "");
    if (gstin && !GSTIN_RE.test(gstin)) {
      return NextResponse.json(
        { error: "GSTIN looks invalid — expected 15 characters like 27AAPFU0939F1ZV." },
        { status: 400 }
      );
    }

    // duplicate checks (case/spelling-insensitive via normalized name)
    const { data: all, error: allErr } = await sb
      .from("vendors")
      .select("id,vendor_name,gstin")
      .limit(5000);
    if (allErr) return NextResponse.json({ error: allErr.message }, { status: 500 });
    const rows = all || [];
    const dupGstin = gstin && rows.find((v) => (v.gstin || "").toUpperCase() === gstin);
    if (dupGstin) {
      return NextResponse.json(
        { error: "duplicate", existing: dupGstin, message: "A vendor with this GSTIN already exists." },
        { status: 409 }
      );
    }
    const dupName = rows.find((v) => norm(v.vendor_name) === norm(vendorName));
    if (dupName) {
      return NextResponse.json(
        {
          error: "duplicate_name",
          existing: dupName,
          message: "A vendor with a very similar name already exists — check before creating a new one.",
        },
        { status: 409 }
      );
    }

    const { data: created, error } = await sb
      .from("vendors")
      .insert({
        vendor_name: vendorName,
        gstin: gstin || null,
        phone: String(b.phone || "").trim() || null,
        email: String(b.email || "").trim() || null,
        address: String(b.address || "").trim() || null,
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
