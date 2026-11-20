"use client";
// /store/closing-stock — the logged-in store enters its own end-of-day stock.
import { useProfile } from "@/components/ProfileProvider";
import StoreClosingForm from "@/app/shipment-planning/closing-stock/StoreClosingForm";

export default function StoreClosingStockPage() {
  const { outletId, outletName } = useProfile();
  if (!outletId) return null;
  return <StoreClosingForm store={{ id: outletId, name: outletName }} />;
}
