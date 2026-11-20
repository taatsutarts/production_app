// /store/dispatches — what the kitchen sent to this store (read-only; RLS shows only its rows).
import DispatchesView from "@/app/dispatches/DispatchesView";

export default function StoreDispatchesPage() {
  return <DispatchesView readOnly />;
}
