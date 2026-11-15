// app/lib/drive.js
// Google Drive uploader for Purchase Bills originals (invoice images / PDFs).
//
// STATUS: WRITTEN BUT UNTESTED — there are no Drive credentials in .env.local yet.
// Finish the setup below, then test by saving a bill with the file attached.
//
// SETUP (one time, ~10 minutes):
//   1. console.cloud.google.com -> new project -> enable the "Google Drive API"
//   2. OAuth consent screen -> External -> add your own Google account as a test user
//   3. Credentials -> Create credentials -> OAuth client ID -> "Desktop app"
//      -> copy the Client ID and Client secret
//   4. Get a refresh token once at https://developers.google.com/oauthplayground :
//      - click the gear icon -> tick "Use your own OAuth credentials" -> paste ID/secret
//      - in the scope box enter: https://www.googleapis.com/auth/drive
//      - Authorize APIs -> Exchange authorization code for tokens -> copy the refresh token
//   5. In Google Drive, create a folder named "Purchase Bills" and copy its ID from
//      the browser URL (the part after /folders/)
//   6. Add to .env.local and restart the dev server:
//        GOOGLE_DRIVE_CLIENT_ID=...
//        GOOGLE_DRIVE_CLIENT_SECRET=...
//        GOOGLE_DRIVE_REFRESH_TOKEN=...
//        GOOGLE_DRIVE_ROOT_FOLDER_ID=...
//
// Files land in:  Purchase Bills/<year>/<Cost Center>/<Vendor>/<Invoice Number>.<ext>
//   e.g. Purchase Bills/2026/Tarts/Bakers Hub/INV-2026-0042.jpg
// Missing folders are created automatically. Files stay private (no sharing set) —
// only Google accounts on this Drive can open them. The refresh token never leaves
// the server.

import dns from "dns";

// IPv6-first DNS hangs on this machine (broken IPv6 routing) — force IPv4-first.
dns.setDefaultResultOrder("ipv4first");

// module state ---------------------------------------------------------------
let cachedToken = null;        // { token, expiresAt } — access tokens last ~1 h
const folderCache = new Map(); // "parentId/name" -> folderId (folder lookups repeat)

export function driveConfigured() {
  return !!(
    process.env.GOOGLE_DRIVE_CLIENT_ID &&
    process.env.GOOGLE_DRIVE_CLIENT_SECRET &&
    process.env.GOOGLE_DRIVE_REFRESH_TOKEN &&
    process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID
  );
}

// Exchange the refresh token for an access token (cached until ~2 min before expiry).
// Exported because zoho.js uses it to download the Drive original for attaching.
export async function driveAccessToken() {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_DRIVE_CLIENT_ID,
      client_secret: process.env.GOOGLE_DRIVE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_DRIVE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error("Drive token refresh failed (" + res.status + "): " + text.slice(0, 200));
  }
  const data = await res.json();
  if (!data.access_token) throw new Error("Drive token refresh returned no access_token");
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + ((data.expires_in || 3600) - 120) * 1000,
  };
  return cachedToken.token;
}

// Find a folder named `name` under `parentId`, or create it. Returns the folder ID.
async function ensureFolder(token, name, parentId) {
  const key = parentId + "/" + name;
  if (folderCache.has(key)) return folderCache.get(key);

  // 1. look for an existing folder with this name under parentId
  const esc = name.replace(/'/g, "\\'");
  const search = await fetch(
    "https://www.googleapis.com/drive/v3/files" +
      "?q=" +
      encodeURIComponent(
        "mimeType='application/vnd.google-apps.folder' and name='" + esc +
          "' and '" + parentId + "' in parents and trashed=false"
      ) +
      "&fields=files(id)&pageSize=1",
    { headers: { Authorization: "Bearer " + token } }
  );
  if (search.ok) {
    const found = await search.json();
    if (found.files && found.files.length > 0) {
      folderCache.set(key, found.files[0].id);
      return found.files[0].id;
    }
  }

  // 2. not found (or the search failed) -> create it
  const create = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    }),
  });
  if (!create.ok) {
    const text = await create.text();
    throw new Error("Drive folder create failed (" + create.status + "): " + text.slice(0, 200));
  }
  const made = await create.json();
  folderCache.set(key, made.id);
  return made.id;
}

// Upload one original invoice file. Returns:
//   { ok: true,  fileId, link, path }
//   { ok: false, reason: "not_configured" }          env vars missing
//   { ok: false, reason: "failed", error }           network / API problem
export async function uploadOriginal({
  filename,
  mimeType,
  base64,
  costCenter,
  vendorName,
  invoiceNumber,
}) {
  if (!driveConfigured()) return { ok: false, reason: "not_configured" };
  try {
    const token = await driveAccessToken();
    const year = String(new Date().getFullYear());
    const section = costCenter || "Unsorted";
    const vendor = vendorName || "Unknown Vendor";
    // Drive name = <Invoice Number><original extension>, sanitized for filesystems
    const safeInvoice =
      String(invoiceNumber || "invoice").replace(/[\\/:*?"<>|]/g, "-").trim() || "invoice";
    const ext = (filename || "").match(/\.[a-z0-9]+$/i);
    const safeName = safeInvoice + (ext ? ext[0] : "");

    // create the folder chain year -> section -> vendor (missing ones are created)
    let folder = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
    for (const name of [year, section, vendor]) {
      folder = await ensureFolder(token, name, folder);
    }

    // multipart upload: metadata part + media part (base64)
    const boundary = "pbd" + Math.random().toString(36).slice(2);
    const body =
      "--" + boundary + "\r\n" +
      "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
      JSON.stringify({ name: safeName, parents: [folder] }) + "\r\n" +
      "--" + boundary + "\r\n" +
      "Content-Type: " + (mimeType || "application/octet-stream") + "\r\n" +
      "Content-Transfer-Encoding: base64\r\n\r\n" +
      base64 + "\r\n" +
      "--" + boundary + "--";

    const up = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "multipart/related; boundary=" + boundary,
        },
        body,
      }
    );
    if (!up.ok) {
      const text = await up.text();
      throw new Error("Drive upload failed (" + up.status + "): " + text.slice(0, 200));
    }
    const made = await up.json();
    return {
      ok: true,
      fileId: made.id,
      link: "https://drive.google.com/file/d/" + made.id + "/view",
      path: "Purchase Bills/" + year + "/" + section + "/" + vendor + "/" + safeName,
    };
  } catch (e) {
    return { ok: false, reason: "failed", error: String(e.message || e).slice(0, 400) };
  }
}
