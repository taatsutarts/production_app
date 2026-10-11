export const STORE_NAMES = ["Matunga", "Bandra", "Kandivali"];

export const SUB_CATEGORY = "Consumable";

export function monthStartISO(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
}

export function monthLabel(d = new Date()) {
  return d.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

export function todayInputValue(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// "2026-10-10" -> "10/10/2026"
export function formatDMY(inputDate) {
  const [y, m, d] = inputDate.split("-");
  return `${d}/${m}/${y}`;
}

export function key(outletId, supplyId) {
  return `${outletId}:${supplyId}`;
}

export function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
