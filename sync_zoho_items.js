// sync_zoho_items.js
// Pulls the item master from Zoho Books into purchase_items. Run with: node sync_zoho_items.js
//
// What it does (idempotent — safe to re-run any time new items are created in Zoho):
//   For every ACTIVE Zoho item (grouped by normalized name — one master row per product):
//     a) local row already carries this zoho_item_id -> skip
//     b) local row with the same name (exact, or after stripping the "#_# " prefix and
//        " - Taatsu" suffix used for display) and no zoho_item_id yet -> links it
//        (PATCH zoho_item_id only — the local name is never changed)
//     c) otherwise -> inserts a new master row: exact Zoho name, zoho_item_id,
//        purchase rate (when Zoho has one), unit, status 'Active', added_by 'zoho-import'
//   brand_type: Zoho names ending in "- Taatsu" are set to 'Taatsu'; everything else
//   stays null until someone sets it (the bill review asks the brand per line then).
//
// Reads credentials from .env.local (SUPABASE_URL, SUPABASE_SERVICE_KEY, ZOHO_*).
const fs = require("fs");
const dns = require("dns");
dns.setDefaultResultOrder("ipv4first"); // this machine's IPv6 routing is broken

const env = {};
fs.readFileSync(__dirname + "/.env.local", "utf8")
  .split(/\r?\n/).forEach((l) => { const m = l.match(/^([A-Za-z_]+)=(.*)$/); if (m) env[m[1]] = m[2]; });
const SH = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY };

const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
const stripLocal = (s) => norm(String(s || "").replace(/^#_#\s*/, "").replace(/\s*-\s*Taatsu$/i, ""));
const stripZoho = (s) => norm(String(s || "").replace(/\s*-\s*Taatsu$/i, ""));

(async () => {
  // ---- 1. all active Zoho items ----
  const tr = await fetch((env.ZOHO_ACCOUNTS_BASE || "https://accounts.zoho.in") + "/oauth/v2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: env.ZOHO_BOOKS_REFRESH_TOKEN,
      client_id: env.ZOHO_BOOKS_CLIENT_ID,
      client_secret: env.ZOHO_BOOKS_CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });
  const td = await tr.json().catch(() => ({}));
  if (!td.access_token) { console.log("TOKEN FAILED:", JSON.stringify(td).slice(0, 160)); return; }
  const ZH = { Authorization: "Zoho-oauthtoken " + td.access_token };
  const base = env.ZOHO_BOOKS_API_BASE || "https://www.zohoapis.in/books/v3";

  let zoho = [];
  for (let p = 1; p <= 10; p++) {
    const r = await fetch(base + "/items?per_page=200&page=" + p + "&organization_id=" + env.ZOHO_BOOKS_ORG_ID, { headers: ZH });
    const d = await r.json().catch(() => ({}));
    zoho = zoho.concat(d.items || []);
    if (!d.page_context || !d.page_context.has_more_page) break;
  }
  const active = zoho.filter((i) => i.status !== "inactive");
  console.log("zoho items total/active:", zoho.length + "/" + active.length);

  // ---- 2. local rows ----
  const local = await (await fetch(env.SUPABASE_URL + "/rest/v1/purchase_items?select=id,item_name,status,brand_type,zoho_item_id", { headers: SH })).json();
  console.log("local rows before:", local.length);
  const byZohoId = new Map(local.filter((r) => r.zoho_item_id).map((r) => [r.zoho_item_id, r]));
  const byExact = new Map(local.map((r) => [norm(r.item_name), r]));
  const byStripped = new Map(local.map((r) => [stripLocal(r.item_name), r]));

  // ---- 3. dedupe Zoho actives by normalized name (one master row per product) ----
  const groups = new Map();
  for (const it of active) {
    const k = norm(it.name);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }
  let skippedDups = 0;
  const picked = [];
  for (const [, arr] of groups) {
    arr.sort((a, b) => (Number(b.purchase_rate) || 0) - (Number(a.purchase_rate) || 0) || a.item_id - b.item_id);
    picked.push(arr[0]);
    skippedDups += arr.length - 1;
  }
  console.log("unique names:", picked.length, "| duplicate-name zoho items skipped:", skippedDups);

  // ---- 4. link or insert ----
  const toInsert = [];
  let linkedExact = 0, linkedStripped = 0, alreadyLinked = 0;

  for (const it of picked) {
    const zid = String(it.item_id);
    if (byZohoId.has(zid)) { alreadyLinked++; continue; }

    let target = byExact.get(norm(it.name));
    let how = "exact";
    if (!target) {
      target = byStripped.get(stripZoho(it.name));
      how = "stripped";
    }
    if (target && !target.zoho_item_id) {
      const patch = { zoho_item_id: zid };
      if (!target.brand_type && /-\s*Taatsu$/i.test(it.name || "")) patch.brand_type = "Taatsu";
      const r = await fetch(env.SUPABASE_URL + "/rest/v1/purchase_items?id=eq." + target.id, {
        method: "PATCH", headers: { ...SH, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify(patch),
      });
      if (r.ok) {
        target.zoho_item_id = zid;
        if (how === "exact") linkedExact++; else linkedStripped++;
        byZohoId.set(zid, target);
        continue;
      }
      console.log("PATCH failed", r.status, await r.text());
    }
    toInsert.push({
      item_name: it.name,
      status: "Active",
      zoho_item_id: zid,
      purchase_rate: Number(it.purchase_rate) > 0 ? Number(it.purchase_rate) : null,
      uom: it.unit || null,
      used_in_recipe: false,          // required column
      brand_type: /-\s*Taatsu$/i.test(it.name || "") ? "Taatsu" : null,
      added_by: "zoho-import",
      added_at: new Date().toISOString(),
    });
  }
  console.log("already linked:", alreadyLinked, "| linked exact:", linkedExact, "| linked stripped:", linkedStripped, "| to insert:", toInsert.length);

  // ---- 5. insert (id is GENERATED ALWAYS -> let Postgres assign it) ----
  let inserted = 0;
  for (let c = 0; c < toInsert.length; c += 200) {
    const chunk = toInsert.slice(c, c + 200);
    const r = await fetch(env.SUPABASE_URL + "/rest/v1/purchase_items", {
      method: "POST",
      headers: { ...SH, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(chunk),
    });
    if (r.ok) inserted += chunk.length;
    else console.log("INSERT chunk failed:", r.status, (await r.text()).slice(0, 300));
  }
  console.log("inserted:", inserted);

  // ---- 6. final state ----
  const after = await (await fetch(env.SUPABASE_URL + "/rest/v1/purchase_items?select=id,item_name,brand_type,zoho_item_id", { headers: SH })).json();
  const withZoho = after.filter((r) => r.zoho_item_id).length;
  const withBrand = after.filter((r) => r.brand_type).length;
  const nameCounts = new Map();
  for (const r of after) nameCounts.set(norm(r.item_name), (nameCounts.get(norm(r.item_name)) || 0) + 1);
  const dupeNames = [...nameCounts.values()].filter((n) => n > 1).length;
  console.log("\nFINAL: rows:", after.length, "| with zoho_item_id:", withZoho, "| with brand_type:", withBrand, "| duplicated names:", dupeNames);
})();
