import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "crypto";

export const runtime = "nodejs";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: false } }
);

// "#_# Kunafa Chocolate Tart - Taatsu" -> "kunafa chocolate tart"
const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/#_#/g, "")
    .replace(/\s*-\s*taatsu\s*$/, "")
    .trim()
    .replace(/^tts\s+/, "")
    .replace(/\s+/g, " ")
    .trim();

const outletNorm = (s) => norm(s).replace(/\s*kytchens?$/, "");

// sheet tart names that don't match the items table names -> items.id
const TART_ALIASES = {
  "apple crumble cheesecake tart": 1,
  "brownie cheesecake tart": 3,
  "blueberry cheesecake tart": 4,
  "lemon mousse cheesecake tart": 5,
  "belgian chocolate cheesecake tart": 6,
  "original vanilla cheesecake tart": 7,
  "nutella cheesecake tart": 8,
  "salted caramel cheesecake tart": 9,
  "kunafa chocolate tart": 10,
  "black forest cheesecake tart": 13,
  "mushroom cheddar tart": 15,
  "jalapeno cheddar tart": 16,
};
const OUTLET_ALIASES = { "andheri west": "dn nagar" };

function authorized(req) {
  const sent = Buffer.from(req.headers.get("x-api-secret") || "");
  const real = Buffer.from(process.env.DISPATCH_API_SECRET || "");
  return real.length > 0 && sent.length === real.length && timingSafeEqual(sent, real);
}

const fail = (error, status) => NextResponse.json({ error }, { status });

export async function POST(req) {
  if (!authorized(req)) return fail("Unauthorized", 401);

  let body;
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON", 400);
  }
  const { location, dispatchedAt, items } = body || {};

  if (!location || typeof location !== "string") return fail("Missing location", 400);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(dispatchedAt || "") || isNaN(Date.parse(dispatchedAt)))
    return fail("Invalid dispatchedAt", 400);
  if (!Array.isArray(items) || items.length < 1 || items.length > 200) return fail("Invalid items", 400);

  const [o, i, p] = await Promise.all([
    admin.from("outlets").select("id,name"),
    admin.from("items").select("id,item_name"),
    admin.from("purchase_items").select("id,item_name"),
  ]);
  if (o.error || i.error || p.error) return fail((o.error || i.error || p.error).message, 500);

  const outletMap = new Map(o.data.map((x) => [outletNorm(x.name), x.id]));
  const itemMap = new Map();
  i.data.forEach((x) => itemMap.set(norm(x.item_name), { item_id: x.id }));
  p.data.forEach((x) => itemMap.set(norm(x.item_name), { purchase_item_id: x.id }));
  Object.entries(TART_ALIASES).forEach(([k, id]) => itemMap.set(k, { item_id: id }));

  const key = outletNorm(location);
  const outletId = outletMap.get(OUTLET_ALIASES[key] || key);
  if (!outletId) return fail(`Unknown outlet: ${location}`, 422);

  const rows = [];
  const unknown = [];
  const badQty = [];
  for (const it of items) {
    const hit = itemMap.get(norm(it.name));
    const qty = Number(it.qty);
    if (!hit) { unknown.push(it.name); continue; }
    if (!Number.isFinite(qty) || qty <= 0 || qty > 1e6) { badQty.push(it.name); continue; }
    rows.push({
      outlet_id: outletId,
      item_id: hit.item_id ?? null,
      purchase_item_id: hit.purchase_item_id ?? null,
      qty,
      dispatched_at: dispatchedAt,
    });
  }
  if (unknown.length) return fail(`Unknown items: ${unknown.join(", ")}`, 422);
  if (badQty.length) return fail(`Invalid quantity for: ${badQty.join(", ")}`, 422);

  // guard against the same PO being imported twice
  const { count } = await admin
    .from("dispatches")
    .select("id", { count: "exact", head: true })
    .eq("outlet_id", outletId)
    .eq("dispatched_at", dispatchedAt);
  if (count > 0) return fail("This dispatch was already imported.", 409);

  const { error } = await admin.from("dispatches").insert(rows);
  if (error) return fail(error.message, 500);

  return NextResponse.json({ ok: true, inserted: rows.length });
}