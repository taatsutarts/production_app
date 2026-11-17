/* Name matching helpers shared by the planner files: DB/sheet item names and outlet
   names -> normal forms that ignore case, punctuation and filler words. No data here,
   just the matching rules. */

// lowercase, strip tags/punctuation, drop filler words ("the", "tart", "cheese(cake)")
const norm = (s) =>
  (s || "")
    .toLowerCase()
    .replace(/^#_#\s*/, "")
    .replace(/\s*-\s*taatsu$/i, "")
    .replace(/^tts\s+/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the|tart|cheesecake|cheese)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

// DB names that don't normalise to the planner's short names
const ALIASES = {
  "coconut chocolate": "choc coconut", // "Coconut Chocolate Tart" -> Choc Coconut
  "peanut butter jelly": "pb j",       // "Peanut butter jelly tart" -> PB&J
};

// normal form of an item name (shared with the stock sheet matching)
export const normItem = (name) => {
  const n = norm(name);
  return ALIASES[n] || n;
};

// lowercase, punctuation -> space (for matching outlet names)
export const normOutlet = (s) =>
  (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

// do two normal forms refer to the same product? (word-prefix tolerant:
// "mushroom" matches "mushroom cheddar", but never the other way round)
const matchKey = (a, b) => a === b || a.startsWith(b + " ") || b.startsWith(a + " ");
export const itemKeysMatch = matchKey;

// utility used by the planner data loaders: normalise the outlet label to match the DB
// outlet names coming back from the sheet / Supabase routes.
export const sameOutlet = (plannerName, dbName, aliases = {}) => {
  const a = aliases[normOutlet(plannerName)] || normOutlet(plannerName);
  const b = (dbName || "").replace(/\b(kytchens|kytchen|store|cloud)\b/g, "").replace(/\s+/g, " ").trim();
  return a === normOutlet(b);
};
