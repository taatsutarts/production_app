// lib/storage.js
// Supabase Storage keeper for Purchase Bills originals (the invoice image/PDF the
// user uploads). The file used to be discarded after Gemini extraction — now the
// save route stores it in a private bucket at draft-save time and the Zoho sync
// (lib/zoho.js -> attachStoredOriginal) downloads it again to attach to the Zoho
// bill. Service-role only: the bucket is private and RLS-locked, so NEVER import
// this from client code — same rule as lib/supabaseService.js.
// Folder layout inside the bucket: <year>/<Month>/<Vendor>/<Invoice number>.<ext>
// (see billFilePath). Node fetch needs ipv4first on this machine (CHANGELOG gotcha).
import dns from "dns";
import { supabaseService } from "./supabaseService";
dns.setDefaultResultOrder("ipv4first");

export const BILL_FILES_BUCKET = "purchase-bills";

// object keys must be safe: keep letters/digits/dot/dash/space, collapse the rest
function safeName(s) {
  const clean = String(s || "")
    .replace(/[^\w.\- ]+/g, " ")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "");
  return clean || "invoice";
}

// the extensions Zoho (and common sense) accept for bill attachments; a filename
// extension that is not in this set is ignored (e.g. "bill.12345" -> mime decides)
const EXT_MIME = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  heic: "image/heic",
  heif: "image/heif",
  pdf: "application/pdf",
};

// extension from the filename when it is a known image/pdf type, else from the
// mime type (extract accepts jpg/png/webp/pdf)
export function fileExt(filename, mimeType) {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(String(filename || ""));
  if (m && EXT_MIME[m[1].toLowerCase()]) return m[1].toLowerCase();
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

export function mimeOfExt(ext) {
  return EXT_MIME[String(ext || "").toLowerCase()] || "application/octet-stream";
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// one readable folder/file name: keeps letters, digits, spaces and . - _ & ( ) , '
// (all valid in Supabase Storage keys); "/" and anything else become "-"
function folderName(s, fallback) {
  const clean = String(s || "")
    .replace(/[^\p{L}\p{N} .\-_&(),']+/gu, "-")
    .replace(/\s+/g, " ")
    .replace(/-{2,}/g, "-")
    .replace(/^[\s.\-]+|[\s.\-]+$/g, "");
  return clean || fallback;
}

/* Where a bill's original lives in the bucket (the bucket is the "Purchase Bills"
 * root):  <year>/<Month>/<Vendor>/<Invoice number>.<ext>
 * e.g. "2026/November/SHREE MAHAVIR TRADERS/MH-26-27-08733.jpeg".
 * Year/month come from the INVOICE date (today when the bill has none); the file
 * is named after the invoice number (the uploaded filename otherwise). */
export function billFilePath(bill, ext, fallbackName) {
  const m = /^(\d{4})-(\d{2})/.exec(String(bill?.invoice_date || ""));
  const now = new Date();
  const year = m ? m[1] : String(now.getFullYear());
  const month = MONTHS[(m ? Number(m[2]) : now.getMonth() + 1) - 1] || MONTHS[now.getMonth()];
  const vendor = folderName(bill?.vendor_name, "Unknown vendor");
  let base = folderName(bill?.invoice_number, "");
  if (!base) {
    base = safeName(fallbackName);
    if (base.toLowerCase().endsWith("." + ext)) base = base.slice(0, -(ext.length + 1));
  }
  return `${year}/${month}/${vendor}/${base}.${ext}`;
}

/* Save one bill's original. file = { name, mimeType, base64 } (same shape the
 * page already sends); bill = the saved row (vendor_name, invoice_number,
 * invoice_date). upsert:true so re-saving replaces the stored copy; an older copy
 * at a different path (oldPath) is removed afterwards.
 * Returns { ok, path } or { ok:false, error }. */
export async function saveBillOriginal({ file, bill, oldPath }) {
  if (!file || !file.base64) return { ok: false, error: "no file" };
  const ext = fileExt(file.name, file.mimeType);
  const path = billFilePath(bill, ext, file.name);
  const bytes = Buffer.from(String(file.base64), "base64");
  if (!bytes.length) return { ok: false, error: "the file is empty" };
  const bucket = supabaseService.storage.from(BILL_FILES_BUCKET);
  const { error } = await bucket.upload(path, bytes, {
    contentType: file.mimeType || "application/octet-stream",
    upsert: true,
    // no CDN caching: a replaced file at the same path must be what the Zoho
    // sync downloads next (default max-age=3600 served the old copy for an hour)
    cacheControl: "0",
  });
  if (error) return { ok: false, error: error.message };
  if (oldPath && oldPath !== path) await bucket.remove([oldPath]); // best effort
  return { ok: true, path };
}

/* Keep an already-stored original in the right folder after the bill's vendor,
 * invoice number or date was edited (no new file). Returns { ok, path, moved }. */
export async function relocateBillOriginal(oldPath, bill) {
  if (!oldPath) return { ok: true, path: null, moved: false };
  const name = String(oldPath).split("/").pop();
  const ext = (name.match(/\.([A-Za-z0-9]{1,5})$/) || [])[1]?.toLowerCase() || "jpg";
  const path = billFilePath(bill, ext, name);
  if (path === oldPath) return { ok: true, path, moved: false };
  const bucket = supabaseService.storage.from(BILL_FILES_BUCKET);
  const { error } = await bucket.move(oldPath, path);
  if (error) return { ok: false, error: error.message, path: oldPath };
  return { ok: true, path, moved: true };
}

/* Read one stored original back (for the Zoho attachment multipart).
 * Returns { ok, bytes:ArrayBuffer, filename, contentType } or { ok:false, error }. */
export async function readBillOriginal(storagePath) {
  const filename = String(storagePath || "").split("/").pop() || "invoice-original";
  const ext = (filename.match(/\.([A-Za-z0-9]{1,5})$/) || [])[1];
  // via a fresh signed URL, not .download(): the storage CDN keeps serving the OLD
  // bytes for a path that was just replaced; a signed URL is unique per call
  const { data, error } = await supabaseService.storage
    .from(BILL_FILES_BUCKET)
    .createSignedUrl(storagePath, 60);
  if (error || !data?.signedUrl) return { ok: false, error: (error && error.message) || "not found" };
  const res = await fetch(data.signedUrl, { cache: "no-store" });
  if (!res.ok) return { ok: false, error: "download failed (HTTP " + res.status + ")" };
  return { ok: true, bytes: await res.arrayBuffer(), filename, contentType: mimeOfExt(ext) };
}
