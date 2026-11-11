import { getStockData } from "../../lib/stock";

export const dynamic = "force-dynamic";

export async function GET() {
  const d = await getStockData();
  if (d.error) return Response.json({ error: d.error });
  return Response.json({
    error: "",
    dateCell: d.dateCell,
    stock: d.stock.filter((r) => r.section === "Tarts"),
  });
}