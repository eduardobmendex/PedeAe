"use server";

import { redirect } from "next/navigation";
import { friendlyDbError, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createOrganizationSchema } from "@/lib/validation";
import type { FormState } from "@/lib/form-state";

export async function createOrganization(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireUser();
  const parsed = createOrganizationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_organization", { p_name: parsed.data.name, p_slug: parsed.data.slug });
  if (error) return { error: friendlyDbError(error.message) };

  redirect(`/painel/${parsed.data.slug}`);
}
