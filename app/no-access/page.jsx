// Shown to a login that has no role in user_profiles yet (proxy.js sends it here).
export default function NoAccessPage() {
  return (
    <div className="mx-auto mt-10 max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
      <h1 className="text-lg font-semibold">No access yet</h1>
      <p className="mt-2 text-sm text-slate-500">
        This login is not linked to the admin team or a store. Ask the admin to set it up, then
        log in again. Use “Log out” in the menu to switch accounts.
      </p>
    </div>
  );
}
