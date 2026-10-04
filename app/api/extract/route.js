import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const MODELS = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-flash-latest",
];
const OPENING_CATEGORIES = ["TARTS"]; // add "MINIS" if wanted

// sends photo + instructions to Gemini; tries the next model if one is busy
async function ask(prompt, mimeType, base64) {
  let lastError;
  for (const model of MODELS) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: [
          { inlineData: { mimeType, data: base64 } },
          { text: prompt },
        ],
        config: { responseMimeType: "application/json" },
      });
      return JSON.parse(response.text);
    } catch (err) {
      console.log(model + " failed: " + err.message);
      lastError = err;
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

    // 2. read the photo
    const form = await request.formData();
    const file = form.get("image");
    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");

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

    const data = await ask(prompt, file.type, base64);
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