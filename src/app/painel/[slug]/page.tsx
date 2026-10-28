import Link from "next/link";
import { ButtonLink, Card, PageHeader } from "@/components/ui";
import { getOrgContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

export default async function OrgDashboardPage({ params }: PageProps<"/painel/[slug]">) {
  const { slug } = await params;
  const { organization, membership } = await getOrgContext(slug);
  const supabase = await createClient();

  const [{ data: settings }, { count: memberCount }, { count: productCount }, { count: tableCount }] = await Promise.all([
    supabase
      .from("organization_settings")
      .select("theme, brand_color, accent_color, logo_path")
      .eq("organization_id", organization.id)
      .single(),
    supabase.from("memberships").select("id", { count: "exact", head: true }).eq("organization_id", organization.id),
    supabase.from("products").select("id", { count: "exact", head: true }).eq("organization_id", organization.id),
    supabase.from("tables").select("id", { count: "exact", head: true }).eq("organization_id", organization.id),
  ]);

  // Personalizada = algo diferente dos padrões da migration.
  const brandCustomized =
    !!settings &&
    (settings.theme !== "light" ||
      settings.brand_color.toUpperCase() !== "#E11D48" ||
      settings.accent_color.toUpperCase() !== "#F59E0B" ||
      !!settings.logo_path);
  const steps = [
    {
      done: brandCustomized,
      label: "Personalize a marca e o tema",
      href: can(membership, "manage_brand") ? `/painel/${slug}/configuracoes` : undefined,
    },
    {
      done: (productCount ?? 0) > 0,
      label: "Cadastre categorias e produtos do cardápio",
      href: can(membership, "manage_menu") ? `/painel/${slug}/cardapio` : undefined,
    },
    {
      done: (tableCount ?? 0) > 0,
      label: "Crie as mesas e imprima os QR Codes",
      href: can(membership, "manage_tables") ? `/painel/${slug}/mesas` : undefined,
    },
    {
      done: (memberCount ?? 0) > 1,
      label: "Convide sua equipe",
      href: can(membership, "manage_team") ? `/painel/${slug}/equipe` : undefined,
    },
  ];

  return (
    <>
      <PageHeader
        title={organization.name}
        description="Visão geral do estabelecimento"
        actions={
          <ButtonLink href={`/m/${slug}`} target="_blank" variant="secondary">
            Ver cardápio público
          </ButtonLink>
        }
      />

      <section>
        <h2 className="mb-3 font-semibold">Primeiros passos</h2>
        <Card className="p-0">
          <ol className="divide-y divide-border">
            {steps.map((step, i) => (
              <li key={step.label} className="flex items-center justify-between gap-3 px-5 py-4">
                <div className="flex items-center gap-3">
                  <span
                    className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                      step.done ? "bg-success-soft text-success" : "bg-surface-2 text-muted"
                    }`}
                  >
                    {step.done ? "✓" : i + 1}
                  </span>
                  <span className={step.done ? "text-muted line-through" : ""}>{step.label}</span>
                </div>
                {step.href && !step.done && (
                  <Link href={step.href} className="text-sm font-medium text-brand hover:underline">
                    Abrir
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </Card>
      </section>
    </>
  );
}
