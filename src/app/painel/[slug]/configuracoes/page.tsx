import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { brandingFrom } from "@/lib/theme";
import { BrandingForm } from "./branding-form";
import { ServiceSettingsForm } from "./service-form";

export const metadata: Metadata = { title: "Configurações" };

export default async function SettingsPage({ params }: PageProps<"/painel/[slug]/configuracoes">) {
  const { slug } = await params;
  const { organization } = await requirePermission(slug, "manage_brand");
  const supabase = await createClient();

  const { data: settings } = await supabase
    .from("organization_settings")
    .select("theme, brand_color, accent_color, settings, logo_path, cover_path")
    .eq("organization_id", organization.id)
    .single();

  return (
    <>
      <PageHeader
        title="Configurações"
        description="Identidade visual do cardápio. A prévia atualiza enquanto você edita; nada muda para os clientes até publicar."
      />
      <BrandingForm
        slug={slug}
        organizationId={organization.id}
        name={organization.name}
        initialImages={{ logo_path: settings?.logo_path ?? null, cover_path: settings?.cover_path ?? null }}
        initial={brandingFrom(settings ?? { theme: "light", brand_color: "#E11D48", accent_color: "#F59E0B", settings: {} })}
      />
      <div className="mt-6 max-w-3xl">
        <ServiceSettingsForm
          slug={slug}
          requireConfirmation={Boolean((settings?.settings as Record<string, unknown> | null)?.require_order_confirmation)}
        />
      </div>
    </>
  );
}
