"use client";
// /store/spoilage — this store's spoilage entries (outlet fixed to the logged-in store).
import { useProfile } from "@/components/ProfileProvider";
import SpoilageView from "@/app/spoilage/SpoilageView";

export default function StoreSpoilagePage() {
  const { outletId } = useProfile();
  if (!outletId) return null;
  return <SpoilageView lockedOutletId={outletId} />;
}
