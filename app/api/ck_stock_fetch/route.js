// app/api/ck_stock_fetch/route.js
import { NextResponse } from "next/server";
import { supabase } from "../../lib/supabase"; // adjust path to your lib

// ignore case, extra spaces, trailing spaces
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

export async function POST(req) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.DISPATCH_API_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let { date, names } = await req.json();

  if (!Array.isArray(names) || names.length > 200) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  // no date sent -> use the latest date that has data
  if (!date) {
    const [lp, lo] = await Promise.all([
      supabase
        .from("production")
        .select("production_date")
        .order("production_date", { ascending: false })
        .limit(1),
      supabase
        .from("physical_opening")
        .select("opening_date")
        .order("opening_date", { ascending: false })
        .limit(1),
    ]);
    date = [lp.data?.[0]?.production_date, lo.data?.[0]?.opening_date]
      .filter(Boolean)
      .sort()
      .reverse()[0];
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) {
    return NextResponse.json({ error: "No date available" }, { status: 400 });
  }

  const [aliasRes, prodRes, openRes] = await Promise.all([
    supabase.from("item_aliases").select("item_id, alias"),
    supabase
      .from("production")
      .select("item_id, production_qty")
      .eq("production_date", date),
    supabase
      .from("physical_opening")
      .select("item_id, opening_qty")
      .eq("opening_date", date),
  ]);

  const err = aliasRes.error || prodRes.error || openRes.error;
  if (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  // alias text -> item_id
  const aliasToItem = {};
  aliasRes.data.forEach((a) => {
    aliasToItem[norm(a.alias)] = a.item_id;
  });

  // item_id -> opening + production
  const totals = {};
  openRes.data.forEach((o) => {
    totals[o.item_id] = (totals[o.item_id] || 0) + Number(o.opening_qty);
  });
  prodRes.data.forEach((p) => {
    totals[p.item_id] = (totals[p.item_id] || 0) + Number(p.production_qty);
  });

  // same order as the names sent from the sheet
  const results = names.map((n) => {
    const id = aliasToItem[norm(n)];
    if (id === undefined) return { name: n, matched: false, total: null };
    return { name: n, matched: true, total: totals[id] || 0 };
  });

  return NextResponse.json({ results });
}