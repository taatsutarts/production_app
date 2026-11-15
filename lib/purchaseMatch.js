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
