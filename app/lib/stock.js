import { supabase } from "./supabase";

const SHEET_ID = "1f5ZdIWCQKNe4QH0FJTQkOOvE3mqPUmaP8uOsarhOWQM";
const TAB = "Kytchens Current Stock";

const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();

// "#_# Nutella Cheesecake Tart - Taatsu" -> "Nutella Cheesecake Tart"
const cleanTitle = (t) =>
  t.replace(/^#_#\s*/, "").replace(/\s*-\s*Taatsu\s*$/i, "").trim();

// turns CSV text into rows of cells
function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// decides if a row is Tarts, Packaging or Garnishing
function getSection(match, sub) {
  if (match && match.category === "TARTS") return "Tarts";
  if (sub.includes("packaging")) return "Packaging";
  if (sub.includes("garnish")) return "Garnishing";
  if (sub.includes("tart")) return "Tarts";
  return "Other";
}

export async function getStockData() {
  const url =
    "https://docs.google.com/spreadsheets/d/" +
    SHEET_ID +
    "/gviz/tq?tqx=out:csv&sheet=" +
    encodeURIComponent(TAB) +
    "&range=A:I";

  let rows = [];

  try {
    const res = await fetch(url, { cache: "no-store" });
    const text = await res.text();
    if (!res.ok || text.trim().startsWith("<")) {
      return {
        error:
          "Could not read the sheet. Check that sharing is set to 'Anyone with the link' and the tab name is correct.",
      };
    }
    rows = parseCSV(text).filter((r) => r.some((c) => c.trim() !== ""));
  } catch (e) {
    return { error: "Could not reach Google Sheets." };
  }

  // find the header row (the row that starts with "Outlet")
  const headerIdx = rows.findIndex((r) => norm(r[0]) === "outlet");
  if (headerIdx === -1) {
    return {
      error: "Could not find the header row (the row that starts with 'Outlet').",
    };
  }

  const h = rows[headerIdx].map(norm);
  const iTitle = h.indexOf("title");
  const iSub = h.indexOf("subcategory");
  const iUom = h.indexOf("uom");
  if (iTitle === -1 || iSub === -1 || iUom === -1) {
    return { error: "Could not find the TITLE, SubCategory and UOM columns." };
  }

  const iQty = iUom + 1; // stock quantity is the column right after UOM

  const dateCell =
    rows
      .slice(0, headerIdx)
      .flat()
      .find((c) => /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(c)) || "";

  const rawHeader = rows[headerIdx]
    .slice(0, iQty + 1)
    .map((x, i) => x || (i === iQty ? "Stock" : ""));
  const rawBody = rows.slice(headerIdx + 1).map((r) => r.slice(0, iQty + 1));

  // names from the database
  const [o, oa, it, ia] = await Promise.all([
    supabase.from("outlets").select("name"),
    supabase.from("outlet_aliases").select("alias, outlets(name)"),
    supabase.from("items").select("item_name, category"),
    supabase.from("item_aliases").select("alias, items(item_name, category)"),
  ]);

  const outletMap = {};
  (o.data || []).forEach((x) => (outletMap[norm(x.name)] = x.name));
  (oa.data || []).forEach((x) => {
    if (x.outlets) outletMap[norm(x.alias)] = x.outlets.name;
  });

  const itemMap = {};
  (it.data || []).forEach((x) => {
    itemMap[norm(x.item_name)] = { name: x.item_name, category: x.category };
  });
  (ia.data || []).forEach((x) => {
    if (x.items) {
      itemMap[norm(x.alias)] = {
        name: x.items.item_name,
        category: x.items.category,
      };
    }
  });

  // one record per outlet + item
  const agg = {};
  const badOutlets = new Set();
  const badItems = new Set();

  rows.slice(headerIdx + 1).forEach((r) => {
    const outletRaw = (r[0] || "").trim();
    const titleRaw = (r[iTitle] || "").trim();
    if (!outletRaw || !titleRaw) return;

    const outletFound = outletMap[norm(outletRaw)];
    if (!outletFound) badOutlets.add(outletRaw);
    const outletName = outletFound || outletRaw;

    const match = itemMap[norm(titleRaw)];
    const section = getSection(match, norm(r[iSub]));
    const itemName = match ? match.name : cleanTitle(titleRaw);
    if (!match && (section === "Tarts" || section === "Other")) {
      badItems.add(cleanTitle(titleRaw));
    }

    const qty = Number((r[iQty] || "0").replace(/,/g, "")) || 0;
    const key = outletName + "|" + itemName;
    if (!agg[key]) {
      agg[key] = {
        outlet: outletName,
        item: itemName,
        section,
        uom: (r[iUom] || "").trim(),
        qty: 0,
      };
    }
    agg[key].qty += qty;
  });

  return {
    error: "",
    dateCell,
    rawHeader,
    rawBody,
    stock: Object.values(agg),
    warnings: { outlets: [...badOutlets], items: [...badItems] },
  };
}