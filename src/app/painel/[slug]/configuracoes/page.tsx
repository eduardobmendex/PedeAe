import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_BRANDING_ROW, brandingFrom } from "@/lib/theme";
import { BrandingForm } from "./branding-form";
import { IdentitySelector } from "./identity-selector";
import { ServiceSettingsForm } from "./service-form";

export const metadata: Metadata = { title: "Configurações" };

export default async function SettingsPage({ params }: PageProps<"/painel/[slug]/configuracoes">) {
  const { slug } = await params;
  const { organization, membership } = await requirePermission(slug, "manage_theme");
  const canEditBrand = can(membership, "manage_brand");
  const supabase = await createClient();

  const { data: settings } = await supabase
    .from("organization_settings")
    .select("theme, brand_color, accent_color, settings, logo_path, cover_path")
    .eq("organization_id", organization.id)
    .single();

  const branding = brandingFrom(settings ?? DEFAULT_BRANDING_ROW);

  return (
    <>
      <PageHeader
        title="Configurações"
        description={canEditBrand ? "Identidade visual, marca e regras de atendimento do estabelecimento." : "Identidade visual do estabelecimento."}
      />
      <IdentitySelector slug={slug} current={branding.theme} />
      {canEditBrand && (
        <>
          {/* A chave recomeça o formulário quando a identidade muda (ela desliga as cores próprias). */}
          <BrandingForm
            key={branding.theme}
            slug={slug}
            organizationId={organization.id}
            name={organization.name}
            initialImages={{ logo_path: settings?.logo_path ?? null, cover_path: settings?.cover_path ?? null }}
            initial={branding}
          />
          <div className="mt-6 max-w-3xl">
            <ServiceSettingsForm
              slug={slug}
              requireConfirmation={Boolean((settings?.settings as Record<string, unknown> | null)?.require_order_confirmation)}
            />
          </div>
        </>
      )}
    </>
  );
}
