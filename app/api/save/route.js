import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export async function POST(request) {
  const { date, items, opening = [] } = await request.json();

  const hasQty = (i) => i.item_name && i.qty !== "" && i.qty != null;
  const prod = items.filter(hasQty);
  const open = opening.filter(hasQty);

  // look up ids (no new items are ever created)
  const { data: master, error: e1 } = await supabase
    .from("items")
    .select("id, item_name");
  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });

  const idByName = {};
  master.forEach((m) => (idByName[m.item_name.toLowerCase()] = m.id));
  const idOf = (n) => idByName[n.trim().toLowerCase()];

  // stop if any name is not in the master list
  const unknown = [...prod, ...open]
    .filter((i) => !idOf(i.item_name))
    .map((i) => i.item_name);
  if (unknown.length) {
    return NextResponse.json(
      { error: "Not in master list: " + unknown.join(", ") },
      { status: 400 }
    );
  }

  if (prod.length) {
    const { error } = await supabase.from("production").upsert(
      prod.map((i) => ({
        production_date: date,
        item_id: idOf(i.item_name),
        production_qty: Number(i.qty),
      })),
      { onConflict: "production_date,item_id" }
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (open.length) {
    const { error } = await supabase.from("physical_opening").upsert(
      open.map((i) => ({
        opening_date: date,
        item_id: idOf(i.item_name),
        opening_qty: Number(i.qty),
      })),
      { onConflict: "opening_date,item_id" }
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}