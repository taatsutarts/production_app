import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "crypto";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY // server-only
);

function authorized(req) {
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.DISPATCH_API_SECRET}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const norm = (s) => String(s).trim().toLowerCase();

export async function POST(req) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { location, dispatchedAt, items } = body ?? {};
  if (
    typeof location !== "string" ||
    !Array.isArray(items) ||
    items.length === 0 ||
    items.some((i) => typeof i?.name !== "string" || !(Number(i?.qty) > 0))
  ) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const [outletsRes, itemsRes, purchaseRes] = await Promise.all([
    supabase.from("outlets").select("id, name"),
    supabase.from("items").select("id, item_name"),
    supabase.from("purchase_items").select("id, item_name"),
  ]);

  const err = outletsRes.error || itemsRes.error || purchaseRes.error;
  if (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  const outlet = outletsRes.data.find((o) => norm(o.name) === norm(location));
  if (!outlet) {
    return NextResponse.json({ error: `Unknown outlet: ${location}` }, { status: 422 });
  }

  const itemMap = new Map(itemsRes.data.map((i) => [norm(i.item_name), i.id]));
  const purchaseMap = new Map(purchaseRes.data.map((i) => [norm(i.item_name), i.id]));

  const when = dispatchedAt ? new Date(dispatchedAt).toISOString() : new Date().toISOString();
  const unknown = [];
  const rows = [];

  for (const i of items) {
    const key = norm(i.name);
    const itemId = itemMap.get(key);
    const purchaseId = purchaseMap.get(key);

    if (itemId === undefined && purchaseId === undefined) {
      unknown.push(i.name);
      continue;
    }

    rows.push({
      outlet_id: outlet.id,
      item_id: itemId ?? null,
      purchase_item_id: itemId !== undefined ? null : purchaseId,
      qty: Number(i.qty),
      dispatched_at: when,
    });
  }

  if (unknown.length) {
    return NextResponse.json({ error: "Unknown items", unknown }, { status: 422 });
  }

  const { error } = await supabase.from("dispatches").insert(rows);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, inserted: rows.length });
}