import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// tried in order: if one is busy, the next one runs
const MODELS = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-flash-latest",
];

const prompt = `This is a production board photo.
Read the date at the top-left (format YYYY-MM-DD).
Read ONLY the Production column.
Item names are in the first column.
Skip items with no quantity written.
Return JSON only: {"date": "YYYY-MM-DD", "items": [{"item_name": "...", "qty": 0}]}`;

export async function POST(request) {
  try {
    const form = await request.formData();
    const file = form.get("image");
    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");

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
        data.model = model; // shows which model worked
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