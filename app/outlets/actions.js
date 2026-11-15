"use server";
import { supabaseService as supabase } from "@/lib/supabaseService";
import { revalidatePath } from "next/cache";

export async function updatePoc(id, pocName, pocContact) {
  const { error } = await supabase
    .from("outlets")
    .update({
      poc_name: pocName.trim() || null,
      poc_contact: pocContact.trim() || null,
    })
    .eq("id", id);

  if (error) return { ok: false, message: error.message };

  revalidatePath("/outlets");
  return { ok: true };
}