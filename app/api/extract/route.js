import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import dns from "dns";

// IPv6-first DNS hangs on this machine (broken IPv6 routing) — force IPv4-first.
dns.setDefaultResultOrder("ipv4first");

export const maxDuration = 60;

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Pinned, stable models. NOT the "-latest" aliases or the newest previews: on the free tier those
// hang or answer 503 under load (gemini-flash-latest / gemini-3.8-flash did, 2026-11-20), and a
// hung call used to block the whole request until the host killed it. Each try is also cut
// off after ATTEMPT_MS, so a stuck model falls through to the next one instead.
const MODELS = ["gemini-3.5-flash", "gemini-3.1-flash-lite"];
const ATTEMPT_MS = 20000; // 2 tries x 20 s fits the 60 s function limit
const OPENING_CATEGORIES = ["TARTS"]; // add "MINIS" if wanted

// sends photo + instructions to Gemini; tries the next model if one fails
async function ask(prompt, mimeType, base64) {
  let lastError;
  for (const model of MODELS) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ATTEMPT_MS);
    try {
      console.log("trying " + model);
      const response = await ai.models.generateContent({
        model,
        contents: [
          { inlineData: { mimeType, data: base64 } },
          { text: prompt },
        ],
        config: { responseMimeType: "application/json", abortSignal: ctl.signal },
      });
      return JSON.parse(response.text);
    } catch (err) {
      const timedOut = ctl.signal.aborted;
      console.log(model + (timedOut ? " timed out after " + ATTEMPT_MS / 1000 + "s" : " failed: " + err.message));
      lastError = timedOut ? new Error("Gemini took too long to answer (over " + ATTEMPT_MS / 1000 + " s). Try again.") : err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

export async function POST(request) {
  try {
    // 1. master names from the database
    const { data: master, error } = await supabase
      .from("items")
      .select("item_name, category")
      .order("id");
    if (error) throw error;
    const names = master.map((i) => i.item_name);

    // 2. read the photo and shrink it
    const form = await request.formData();
    const file = form.get("image");
    const small = await sharp(Buffer.from(await file.arrayBuffer()))
      .rotate()
      .resize({ width: 1600, withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    const base64 = small.toString("base64");

    // 3. one prompt: read every row, all columns
    const prompt = `This is a photo of a production board with TWO tables side by side.
Read the date at the top-left (format YYYY-MM-DD).
Read EVERY row that has a product name and at least one handwritten number.
LEFT table columns, in order: Product Name, Wastage, Open, Target, Production, Filling Box.
RIGHT table columns, in order: Product Name, Yield, Open, Target, Production, Wastage.
Copy numbers exactly as handwritten. Use null for an empty cell. A written 0 is 0, not null.
For each row, set "master_name" to the matching name from this MASTER LIST (exactly as written there), or null if nothing matches:
${names.join("\n")}
Return JSON only:
{"date": "YYYY-MM-DD",
 "left": [{"board_name": "...", "master_name": "...", "wastage": null, "open": 0, "target": null, "production": 0}],
 "right": [{"board_name": "...", "master_name": "...", "yield": null, "open": null, "target": null, "production": 0, "wastage": null}]}`;

    const data = await ask(prompt, "image/jpeg", base64);
    console.log("RAW:", JSON.stringify(data));

    // 4. helpers
    const lookup = {};
    names.forEach((n) => (lookup[n.toLowerCase()] = n));
    const categoryOf = {};
    master.forEach(
      (m) => (categoryOf[m.item_name] = String(m.category).trim().toUpperCase())
    );
    const key = (n) => String(n ?? "").trim().toLowerCase();
    const has = (v) => v !== null && v !== undefined && v !== "";

    // 5. the code decides: Production from both tables, Opening for tarts only
    const rows = {};
    [...(data.left || []), ...(data.right || [])].forEach((r) => {
      const exact = lookup[key(r.master_name)];
      const name = exact || "??? " + r.board_name;
      const row = rows[name] || { item_name: name, opening: "", production: "" };

      if (has(r.production)) row.production = r.production;
      if (has(r.open) && exact && OPENING_CATEGORIES.includes(categoryOf[exact])) {
        row.opening = r.open;
      }
      if (row.production !== "" || row.opening !== "") rows[name] = row;
    });

    // keep the same order as your items table
    const order = (n) => {
      const k = names.indexOf(n);
      return k === -1 ? 9999 : k;
    };
    const merged = Object.values(rows).sort(
      (a, b) => order(a.item_name) - order(b.item_name)
    );

    return NextResponse.json({ date: data.date, rows: merged });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}