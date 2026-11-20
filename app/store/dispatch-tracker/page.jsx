// /store/dispatch-tracker — dispatch history; it only reads, and RLS limits it to this store's rows.
import DispatchTracker from "@/app/dispatch_tracker/page";

export default function StoreDispatchTrackerPage() {
  return <DispatchTracker />;
}
