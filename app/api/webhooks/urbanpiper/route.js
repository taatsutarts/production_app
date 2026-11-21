// app/api/webhooks/urbanpiper/route.js
// Receives sales data by POST from an outside system. NO secret/signature is checked (by request), so this
// route only STORES what it receives (raw, in public.urbanpiper_webhook_events) and never acts on it.
// Any other method (GET, PUT, ...) gets 405 automatically because only POST is exported.
// proxy.js lists /api/webhooks in SELF_AUTH_PATHS (shared with the Shopify webhook) so the call is not bounced to /login.
// Table: supabase_migration_urbanpiper_webhook.sql

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 2 * 1024 * 1024; // refuse anything bigger than 2 MB

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function POST(request) {
  let raw;
  try {
    raw = await request.text();
  } catch {
    return NextResponse.json({ ok: false, error: "could not read the body" }, { status: 400 });
  }
  if (raw.length > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: "payload too large" }, { status: 413 });
  }
  if (!raw.trim()) {
    return NextResponse.json({ ok: false, error: "empty body" }, { status: 400 });
  }

  // JSON when it is JSON; anything else is kept as text so nothing is lost
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = { _raw_text: raw };
  }

  const { error } = await getSupabase()
    .from("urbanpiper_webhook_events")
    .insert({
      payload,
      content_type: request.headers.get("content-type") || null,
      source_ip: (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null,
    });

  if (error) {
    console.error("urbanpiper webhook: could not store the event:", error.message);
    // 500 so the sender retries instead of assuming it was saved
    return NextResponse.json({ ok: false, error: "could not store the event" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
