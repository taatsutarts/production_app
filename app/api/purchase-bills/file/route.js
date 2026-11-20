// app/api/purchase-bills/file/route.js
// GET ?id=<bill id>  ->  the invoice file saved with that bill (Supabase Storage, private bucket),
// streamed back through OUR API so it stays behind the app login (stores get 403 from proxy.js)
// and a PDF displays inline in the review screen's <iframe>.
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { readBillOriginal } from "@/lib/storage";

export const dynamic = "force-dynamic";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export async function GET(request) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const { data: bill, error } = await sb.from("purchase_bills").select("id,storage_path").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!bill) return NextResponse.json({ error: "Bill not found." }, { status: 404 });
  if (!bill.storage_path) {
    return NextResponse.json({ error: "No original file is stored for this bill." }, { status: 404 });
  }

  const f = await readBillOriginal(bill.storage_path);
  if (!f.ok) return NextResponse.json({ error: "Could not read the stored file: " + f.error }, { status: 502 });

  return new Response(f.bytes, {
    headers: {
      "Content-Type": f.contentType,
      "Content-Disposition": `inline; filename="${encodeURIComponent(f.filename)}"`,
      "Cache-Control": "private, no-store", // a replaced file must show up immediately
    },
  });
}
