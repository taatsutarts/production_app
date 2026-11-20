// Shared normalizer + cautious similarity scorers for purchase-bill matching.
// Pure functions (no DB) so every route applies the exact same rules.

// "  Amul   Butter  500g " -> "AMUL BUTTER 500G" (trim, uppercase, single-space).
// Deliberately KEEPS product details (size, grade, flavour, pack): those are what
// distinguish two real products. Never merge "salted" and "unsalted" butter here.
export function norm(s) {
  return String(s || "")
    .toUpperCase()
    .replace(/[^A-Z0-9&.\-/% ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s) {
  return norm(s).split(" ").filter((t) => t.length >= 2);
}

// 0..1 similarity: token overlap (Jaccard) + a bonus when one name contains the other.
export function nameScore(a, b) {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.length || !B.length) return 0;
  const setB = new Set(B);
  let inter = 0;
  for (const t of A) if (setB.has(t)) inter++;
  const union = new Set([...A, ...B]).size;
  let score = inter / union;
  const na = norm(a);
  const nb = norm(b);
  if (na && nb && (na.includes(nb) || nb.includes(na))) score = Math.min(1, score + 0.25);
  return score;
}

// Suggestions are ADVICE ONLY — the user must pick one; the app never auto-applies
// a fuzzy match. (score 1 = exact normalized name, handled separately.)
export const SUGGEST_MIN = 0.34;

export function suggestItems(desc, items, limit = 5) {
  if (!norm(desc)) return [];
  const scored = [];
  for (const it of items) {
    const s = nameScore(desc, it.item_name);
    if (s >= SUGGEST_MIN) {
      scored.push({ id: it.id, item_name: it.item_name, score: Math.round(s * 100) / 100 });
    }
  }
  scored.sort((x, y) => y.score - x.score || String(x.item_name).localeCompare(y.item_name));
  return scored.slice(0, limit);
}

export function suggestVendors(name, vendors, limit = 3) {
  const scored = [];
  for (const v of vendors) {
    const s = nameScore(name, v.vendor_name);
    if (s >= 0.4) {
      scored.push({
        id: v.id,
        vendor_name: v.vendor_name,
        gstin: v.gstin || "",
        score: Math.round(s * 100) / 100,
      });
    }
  }
  scored.sort((x, y) => y.score - x.score);
  return scored.slice(0, limit);
}

// ---------------------------------------------------------------------------------
// Zoho bill-line fields (Account, ITC eligibility, Location, Brand) for a line whose
// item is known. Resolution, field by field:
//   this vendor's own override for that wording  ->  the item's default  ->  blank
// (the account id + name always travel together, so one is never mixed with the other
// one's partner). Pure: shared by the match route, the save route and the review page.
export function lineDefaults(item, override) {
  const o = override || {};
  const i = item || {};
  const has = (v) => v != null && v !== "";
  const acct = has(o.account_id) ? o : i;
  return {
    account_id: has(acct.account_id) ? String(acct.account_id) : "",
    account_name: has(acct.account_name) ? acct.account_name : "",
    itc_eligibility: has(o.itc_eligibility) ? o.itc_eligibility : has(i.itc_eligibility) ? i.itc_eligibility : "",
    location: has(o.location) ? o.location : has(i.location) ? i.location : "",
    brand_type: has(o.brand_type) ? o.brand_type : has(i.brand_type) ? i.brand_type : "",
  };
}

// The columns added by supabase_migration_zoho_bill_fields.sql. Until that SQL is run the
// app keeps working without them (queries retry on the base columns).
export const ZOHO_FIELD_COLS = "account_id,account_name,itc_eligibility,location";
export const isMissingColumn = (error) =>
  !!error && (error.code === "42703" || error.code === "PGRST204" || error.code === "PGRST205" || /column|schema cache/i.test(error.message || ""));
