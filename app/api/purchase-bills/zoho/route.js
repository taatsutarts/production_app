// app/api/purchase-bills/zoho/route.js
// Retry endpoint for the Zoho Books sync — used by the "Sync to Zoho" button on
// approved bills. syncBill is duplicate-safe, so retrying never creates the bill twice.
// (Touch marker for dev-server rebuilds after lib/zoho.js edits — do not remove.)
import { NextResponse } from "next/server";
import { syncBill } from "@/lib/zoho";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  if (!body.billId) return NextResponse.json({ error: "billId is required" }, { status: 400 });
  const res = await syncBill(body.billId);
  if (res.reason === "not_found") {
    return NextResponse.json({ ...res, error: "Bill not found." }, { status: 404 });
  }
  return NextResponse.json(res);
}
