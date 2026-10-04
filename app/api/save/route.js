import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export async function POST(request) {
  const { date, items } = await request.json();

  const clean = items.filter(
    (i) => i.item_name && i.qty !== "" && i.qty != null
  );

  // look up ids (no new items are ever created)
  const { data: master, error: e1 } = await supabase
    .from("items")
    .select("id, item_name");
  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });

  const idByName = {};
  master.forEach((m) => (idByName[m.item_name.toLowerCase()] = m.id));

  // stop if any name is not in the master list
  const unknown = clean
    .filter((i) => !idByName[i.item_name.trim().toLowerCase()])
    .map((i) => i.item_name);
  if (unknown.length) {
    return NextResponse.json(
      { error: "Not in master list: " + unknown.join(", ") },
      { status: 400 }
    );
  }

  const rows = clean.map((i) => ({
    production_date: date,
    item_id: idByName[i.item_name.trim().toLowerCase()],
    production_qty: Number(i.qty),
  }));
  const { error: e2 } = await supabase
    .from("production")
    .upsert(rows, { onConflict: "production_date,item_id" });
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}