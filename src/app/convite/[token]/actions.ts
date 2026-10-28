"use server";

import { redirect } from "next/navigation";
import { friendlyDbError, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "@/lib/form-state";

export async function acceptInvitation(token: string): Promise<FormState> {
  await requireUser(`/convite/${token}`);
  if (!/^[0-9a-f]{48}$/.test(token)) return { error: friendlyDbError("invitation_invalid") };

  const supabase = await createClient();
  const { data: orgId, error } = await supabase.rpc("accept_invitation", { p_token: token });
  if (error) return { error: friendlyDbError(error.message) };

  const { data: org } = await supabase.from("organizations").select("slug").eq("id", orgId).single();
  redirect(org ? `/painel/${org.slug}` : "/painel");
}
