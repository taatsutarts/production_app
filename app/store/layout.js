// Guard for everything under /store: store logins only. proxy.js already redirects
// everyone else; this is the second lock (a missing/incorrect proxy rule can't open it).
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/profile";

export default async function StoreLayout({ children }) {
  const profile = await getProfile();
  if (profile.role !== "store" || !profile.outletId) redirect("/");
  return children;
}
