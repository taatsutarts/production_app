"use client";
// Hands the logged-in user's role (read once on the server in app/layout.js) to
// client pages: const { role, outletId, outletName } = useProfile();
// UI only — the real lock is the database rules + proxy.js.
import { createContext, useContext } from "react";

const ProfileContext = createContext({ role: null, outletId: null, outletName: null });

export function ProfileProvider({ profile, children }) {
  return <ProfileContext.Provider value={profile}>{children}</ProfileContext.Provider>;
}

export const useProfile = () => useContext(ProfileContext);
