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

export async function POST(request) {
  try {
    // 1. get the master item names from the database
    const { data: master, error } = await supabase
      .from("items")
      .select("item_name")
      .order("id");
    if (error) throw error;
    const names = master.map((i) => i.item_name);

    // 2. build the instructions, including the master list
    const prompt = `This is a production board photo.
Read the date at the top-left (format YYYY-MM-DD).
Read ONLY the Production column.
Skip items with no quantity written.
For each item, choose the matching name from this MASTER LIST and return it EXACTLY as written there:
${names.join("\n")}
If an item matches nothing in the list, return the board text as is.
Return JSON only: {"date": "YYYY-MM-DD", "items": [{"item_name": "...", "qty": 0}]}`;

    // 3. read the photo
    const form = await request.formData();
    const file = form.get("image");
    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");

    // 4. ask Gemini (tries the next model if one is busy)
    let lastError;
    for (const model of MODELS) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: [
            { inlineData: { mimeType: file.type, data: base64 } },
            { text: prompt },
          ],
          config: { responseMimeType: "application/json" },
        });
        const data = JSON.parse(response.text);

        // 5. snap each name to the exact master name (ignores capitals)
        const lower = {};
        names.forEach((n) => (lower[n.toLowerCase()] = n));
        data.items = data.items.map((i) => {
          const exact = lower[String(i.item_name).trim().toLowerCase()];
          return exact
            ? { ...i, item_name: exact }
            : { ...i, item_name: "??? " + i.item_name };
        });
        return NextResponse.json(data);
      } catch (err) {
        console.log(model + " failed: " + err.message);
        lastError = err;
      }
    }
    throw lastError;
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}