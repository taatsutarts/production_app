// app/api/planner/dispatch/route.js
// "Send PO" for the shipment planner (spec section 15):
//   1. saves the whole plan (date, vehicles, route order, boxes, dry ice, cost,
//      cost per tart) into `dispatch_history`,
//   2. saves every outlet + item quantity (tarts, packaging, garnishing) into the
//      linked `dispatch_plan_items` child table,
//   3. returns the saved plan with SKUs + batch/expiry dates so the page can print
//      one delivery challan PDF per outlet (spec section 16).
//
// Needs supabase_migration_planner_v6.sql (adds the two tables + items.sku).
// Server-only: uses the service-role client. No external API calls (no DNS fix needed).

import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { norm } from "@/lib/purchaseMatch";

export const dynamic = "force-dynamic";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

const pad2 = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/* batch rules (spec section 16): manufacturing = yesterday, batch = mfg without
 * slashes, expiry = mfg + 30 days (= the product's shelf life) */
function batchInfo(dispatchDate, expiryDays = 30) {
  const mfg = new Date(dispatchDate + "T00:00");
  mfg.setDate(mfg.getDate() - 1);
  const exp = new Date(mfg);
  exp.setDate(exp.getDate() + expiryDays);
  return {
    batch_no: dmyNoSlash(mfg),
    mfg_date: iso(mfg),
    expiry_date: iso(exp),
  };
}
const dmyNoSlash = (d) => `${pad2(d.getDate())}${pad2(d.getMonth() + 1)}${d.getFullYear()}`;

const num = (v) => {
  const x = Number(v);
  return Number.isFinite(x) && x >= 0 ? x : 0;
};

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const dispatchDate = String(body.dispatch_date || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dispatchDate))
    return NextResponse.json({ error: "dispatch_date (YYYY-MM-DD) is required" }, { status: 400 });
  const trips = Array.isArray(body.trips) ? body.trips : [];
  if (!trips.length) return NextResponse.json({ error: "The plan has no trips to save" }, { status: 400 });

  // outlet name -> DB id, item name -> SKU (single lookups, batched)
  const [{ data: outletRows, error: outletErr }, { data: itemRows, error: itemErr }] = await Promise.all([
    sb.from("outlets").select("id,name"),
    sb.from("items").select("id,item_name,sku,category").eq("is_active", true),
  ]);
  if (outletErr) return NextResponse.json({ error: outletErr.message }, { status: 500 });
  if (itemErr) return NextResponse.json({ error: itemErr.message }, { status: 500 });

  const outletByName = new Map((outletRows || []).map((r) => [norm(r.name), r]));
  const skuByName = new Map((itemRows || []).map((r) => [norm(r.item_name), r.sku || null]));

  const batch = batchInfo(dispatchDate, Number(body.challan_expiry_days) || 30);

  // flatten stops -> child rows
  const childRows = [];
  const challans = []; // one per outlet, for the PDF step on the page
  trips.forEach((trip, ti) => {
    (trip.stops || []).forEach((stop) => {
      const outlet = outletByName.get(norm(stop.outlet)) || null;
      const lines = [
        ...(stop.items || []).map((x) => ({ ...x, category: "tarts", unit: "piece" })),
        ...(stop.packaging || []).map((x) => ({ ...x, category: "packaging", unit: "piece" })),
        ...(stop.garnishing || []).map((x) => ({ ...x, category: "garnishing", unit: "gram" })),
      ].filter((x) => num(x.qty) > 0);
      if (!lines.length) return;
      challans.push({
        outlet: stop.outlet,
        outlet_id: outlet?.id ?? null,
        address: stop.address || null,
        contact: stop.contact || null,
        tarts: num(stop.tarts),
      });
      lines.forEach((x) => {
        childRows.push({
          outlet_id: outlet?.id ?? null,
          outlet_name: stop.outlet,
          item_name: x.name,
          item_sku: x.sku != null ? x.sku : skuByName.get(norm(x.name)) || null,
          category: x.category,
          unit: x.unit,
          qty: num(x.qty),
          trip_no: ti + 1,
          vehicle_key: trip.vehicle_key || null,
        });
      });
    });
  });
  if (!childRows.length)
    return NextResponse.json({ error: "Nothing to save — every stop is empty" }, { status: 400 });

  const historyRow = {
    dispatch_date: dispatchDate,
    total_tarts: num(body.total_tarts),
    total_cost: num(body.total_cost),
    cost_per_tart: Number.isFinite(Number(body.cost_per_tart)) ? Number(body.cost_per_tart) : null,
    dry_ice_kg: Number.isFinite(Number(body.dry_ice_kg)) ? Number(body.dry_ice_kg) : null,
    vehicle_summary: (trips || []).map((t) => t.vehicle_label || t.vehicle_key || "").join(" + ") || null,
    route_summary: (trips || [])
      .map((t) => (t.stops || []).map((s) => s.outlet).join(" → "))
      .join(" | ") || null,
    plan_json: body.plan_json ?? body,
  };

  const { data: saved, error: histErr } = await sb
    .from("dispatch_history")
    .insert(historyRow)
    .select("id")
    .single();
  if (histErr) {
    const missing = /relation|does not exist|schema cache/i.test(histErr.message || "");
    return NextResponse.json(
      {
        error: missing
          ? "dispatch_history table not found — run supabase_migration_planner_v6.sql in Supabase first."
          : histErr.message,
      },
      { status: 500 },
    );
  }

  const withHistory = childRows.map((r) => ({ ...r, history_id: saved.id, ...batch }));
  const { error: childErr } = await sb.from("dispatch_plan_items").insert(withHistory);
  if (childErr) {
    return NextResponse.json(
      {
        error:
          "Plan header saved but the item rows failed: " +
          (childErr.message || "") +
          " (run supabase_migration_planner_v6.sql)",
        id: saved.id,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    id: saved.id,
    items_saved: withHistory.length,
    challans: challans.map((c) => ({
      outlet: c.outlet,
      outlet_id: c.outlet_id,
      tarts: c.tarts,
      batch_no: batch.batch_no,
      mfg_date: batch.mfg_date,
      expiry_date: batch.expiry_date,
    })),
  });
}

/* recent plans, newest first (for a future history view) */
export async function GET() {
  const { data, error } = await sb
    .from("dispatch_history")
    .select("id,dispatch_date,total_tarts,total_cost,cost_per_tart,vehicle_summary,route_summary,created_at")
    .order("id", { ascending: false })
    .limit(50);
  if (error) {
    const missing = /relation|does not exist|schema cache/i.test(error.message || "");
    return NextResponse.json(
      { error: missing ? "Run supabase_migration_planner_v6.sql first." : error.message },
      { status: 500 },
    );
  }
  return NextResponse.json({ history: data || [] });
}
