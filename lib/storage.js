// lib/storage.js
// Supabase Storage keeper for Purchase Bills originals (the invoice image/PDF the
// user uploads). The file used to be discarded after Gemini extraction — now the
// save route stores it in a private bucket at draft-save time and the Zoho sync
// (lib/zoho.js -> attachStoredOriginal) downloads it again to attach to the Zoho
// bill. Service-role only: the bucket is private and RLS-locked, so NEVER import
// this from client code — same rule as lib/supabaseService.js.
import { supabaseService } from "./supabaseService";

export const BILL_FILES_BUCKET = "purchase-bills";

// object keys must be safe: keep letters/digits/dot/dash/space, collapse the rest
function safeName(s) {
  const clean = String(s || "")
    .replace(/[^\w.\- ]+/g, " ")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "");
  return clean || "invoice";
}

// extension from the filename, else from the mime type (extract accepts jpg/png/webp/pdf)
export function fileExt(filename, mimeType) {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(String(filename || ""));
  if (m) return m[1].toLowerCase();
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

/* Save one bill's original. file = { name, mimeType, base64 } (same shape the
 * page already sends). upsert:true so re-saving a bill with a new file replaces
 * the stored copy. Returns { ok, path } or { ok:false, error }. */
export async function saveBillOriginal({ billId, file }) {
  if (!billId || !file || !file.base64) return { ok: false, error: "no file" };
  const path = `bills/${billId}/${safeName(file.name)}.${fileExt(file.name, file.mimeType)}`;
  const bytes = Buffer.from(String(file.base64), "base64");
  if (!bytes.length) return { ok: false, error: "the file is empty" };
  const { error } = await supabaseService.storage
    .from(BILL_FILES_BUCKET)
    .upload(path, bytes, {
      contentType: file.mimeType || "application/octet-stream",
      upsert: true,
    });
  if (error) return { ok: false, error: error.message };
  return { ok: true, path };
}

/* Read one stored original back (for the Zoho attachment multipart).
 * Returns { ok, bytes:ArrayBuffer, filename } or { ok:false, error }. */
export async function readBillOriginal(storagePath) {
  const filename = String(storagePath || "").split("/").pop() || "invoice-original";
  const { data, error } = await supabaseService.storage.from(BILL_FILES_BUCKET).download(storagePath);
  if (error || !data) return { ok: false, error: (error && error.message) || "not found" };
  return { ok: true, bytes: await data.arrayBuffer(), filename };
}
