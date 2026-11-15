// app/api/purchase-bills/extract/route.js
// Server-side Gemini extraction for Purchase Bills. The API key stays on the server.
// Same @google/genai setup and model fallback as /api/extract.
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { NextResponse } from "next/server";
import dns from "dns";

// This machine's IPv6 routing is broken: Node hangs connecting to Google's APIs over
// IPv6 (curl falls back to IPv4, Node doesn't). Force IPv4-first DNS resolution.
dns.setDefaultResultOrder("ipv4first");

export const maxDuration = 60;

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// same two models as /api/extract, so failed tries don't use up the free quota
const MODELS = ["gemini-flash-latest", "gemini-3.5-flash-lite"];

// The company's cost centers (brands) live in the `brands` table — no brand names
// hardcoded in code. Gemini suggests which brand each LINE belongs to by comparing
// that line's description with these names; the review screen preselects the
// suggestion (the user can always change it before saving).
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

let ccCache = null;
let ccCacheAt = 0;
async function costCenters() {
  if (ccCache && Date.now() - ccCacheAt < 60000) return ccCache;
  const { data, error } = await sb.from("brands").select("brand_name").order("brand_name");
  ccCache = error ? [] : (data || []).map((r) => r.brand_name).filter(Boolean);
  ccCacheAt = Date.now();
  return ccCache;
}

function buildPrompt(cc) {
  return `You are reading an Indian GST purchase invoice (photo or PDF).
Extract exactly the JSON shape below. Rules:
- NEVER invent information. If a value is not printed on the invoice or cannot be identified confidently, return null (or [] for items). Do not guess.
- Numbers must be plain numbers without commas or currency symbols ("1,234.50" -> 1234.5).
- Dates must be YYYY-MM-DD (convert 05/11/2026 or "5 Apr 2026" style dates).
- discount_type: "%" for a percentage discount, "Rs" for a flat rupee discount, null if none. discount_value is the number.
- Per line item: description, quantity, unit (pcs/kg/box...), rate (price per unit BEFORE tax), tax_rate (the GST % for that line, 0 if exempt), line_total (the total printed on that line, null if not printed), cost_center (the brand/section this line belongs to — see the rule below).
- cost_center: this company's cost centers (brands/sections) are: ${cc.length ? cc.join(", ") : "(none configured yet)"}. For EACH line, infer which brand it belongs to by comparing THAT line's description with those names (one invoice can contain items for several brands). If the list is empty or the line is not clearly one of them, return null for that line — do not guess.
- List EVERY line separately, in invoice order — never merge or skip lines, even on long invoices where the same product repeats.
- subtotal, tax_total and grand_total: the totals AS PRINTED on the invoice (null if one is not printed).
- other_charges: extra charges that are not GST and not freight (packing, handling, round off...). 0 if none appear.
- freight_charges: logistics / transport / freight charge. 0 if none appear.
Return JSON only:
{"vendor_name": null, "vendor_gstin": null, "invoice_number": null, "invoice_date": null, "due_date": null, "discount_type": null, "discount_value": null, "items": [{"description": null, "quantity": 0, "unit": null, "rate": 0, "tax_rate": 0, "line_total": null, "cost_center": null}], "subtotal": null, "tax_total": null, "grand_total": null, "other_charges": 0, "freight_charges": 0}`;
}

class ExtractError extends Error {}

// send the file + prompt to Gemini; try the next model if one fails
async function ask(mimeType, base64, prompt) {
  let lastError;
  for (const model of MODELS) {
    try {
      console.log("purchase-bills: trying " + model);
      const response = await ai.models.generateContent({
        model,
        contents: [{ inlineData: { mimeType, data: base64 } }, { text: prompt }],
        config: { responseMimeType: "application/json" },
      });
      return JSON.parse(response.text);
    } catch (err) {
      console.log(model + " failed: " + err.message);
      lastError = err;
    }
  }
  const m = String((lastError && lastError.message) || lastError);
  if (/429|RESOURCE_EXHAUSTED|quota/i.test(m)) {
    throw new ExtractError("Gemini quota is used up (429). Wait a minute and try again.");
  }
  if (/503|UNAVAILABLE|overload/i.test(m)) {
    throw new ExtractError("Gemini is overloaded right now (503). Try again in a few minutes.");
  }
  throw new ExtractError("Gemini could not read this invoice: " + m.slice(0, 200));
}

// "1,234.50", "₹ 500", " 12 " -> plain number; null/"" -> null
function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(String(v).replace(/[₹,\s]/g, ""));
  return isFinite(x) ? x : null;
}

// accept only real YYYY-MM-DD strings — anything else stays null (never guess)
function dateStr(v) {
  if (!v) return null;
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[0] : null;
}

export async function POST(request) {
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: "Server has no GEMINI_API_KEY configured." }, { status: 500 });
  }
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "Send the invoice as multipart form field 'file'." }, { status: 400 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    let mimeType = file.type || "application/octet-stream";
    let data;
    if (mimeType.startsWith("image/")) {
      // shrink big camera photos so they upload fast and still read well
      data = await sharp(buf)
        .rotate()
        .resize({ width: 1600, withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
      mimeType = "image/jpeg";
    } else if (mimeType === "application/pdf") {
      data = buf; // PDFs go to Gemini as-is
    } else {
      return NextResponse.json({ error: "Only image or PDF invoices are supported." }, { status: 400 });
    }

    const cc = await costCenters();
    const raw = await ask(mimeType, data.toString("base64"), buildPrompt(cc));

    // normalise Gemini's answer: clean numbers, force ISO dates, keep unknowns null
    const d = raw || {};
    const items = Array.isArray(d.items)
      ? d.items.map((it) => ({
          description: it && it.description ? String(it.description).trim() : null,
          cost_center: it && it.cost_center ? String(it.cost_center).trim() : null,
          quantity: num(it && it.quantity) ?? 0,
          unit: it && it.unit ? String(it.unit).trim() : null,
          rate: num(it && it.rate) ?? 0,
          tax_rate: num(it && it.tax_rate) ?? 0,
          line_total: num(it && it.line_total),
        }))
      : [];

    // bill-level cost center: only when EVERY line agrees on the same brand (never guess)
    const ccs = items.map((it) => it.cost_center);
    const uniform = ccs.length > 0 && ccs.every(Boolean) && new Set(ccs).size === 1 ? ccs[0] : null;

    const out = {
      vendor_name: d.vendor_name ? String(d.vendor_name).trim() : null,
      vendor_gstin: d.vendor_gstin ? String(d.vendor_gstin).trim() : null,
      invoice_number: d.invoice_number ? String(d.invoice_number).trim() : null,
      invoice_date: dateStr(d.invoice_date),
      due_date: dateStr(d.due_date),
      cost_center: uniform,
      discount_type: d.discount_type === "%" || d.discount_type === "Rs" ? d.discount_type : null,
      discount_value: num(d.discount_value),
      subtotal: num(d.subtotal),
      tax_total: num(d.tax_total),
      grand_total: num(d.grand_total),
      other_charges: num(d.other_charges) ?? 0,
      freight_charges: num(d.freight_charges) ?? 0,
      items,
    };
    return NextResponse.json({ data: out });
  } catch (err) {
    console.error("purchase-bills extract failed:", err);
    const friendly = err instanceof ExtractError
      ? err.message
      : "Extraction failed: " + String(err.message || err);
    return NextResponse.json({ error: friendly }, { status: 503 });
  }
}
