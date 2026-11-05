import type { Metadata } from "next";
import Link from "next/link";
import { Button, Card, EmptyState, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { menuUrl, qrSvg } from "@/lib/qr";
import { getSiteUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "QR Codes" };

export default async function QrCodesPage({ params }: PageProps<"/painel/[slug]/qrcodes">) {
  const { slug } = await params;
  const { organization } = await requirePermission(slug, "manage_tables");
  const supabase = await createClient();
  const siteUrl = await getSiteUrl();

  const { data: tables } = await supabase
    .from("tables")
    .select("id, name, active")
    .eq("organization_id", organization.id)
    .order("sort_order")
    .order("name");

  const generalUrl = menuUrl(siteUrl, slug);
  const generalSvg = await qrSvg(generalUrl);
  const isLocalhost = /\/\/(localhost|127\.0\.0\.1)/.test(siteUrl);

  return (
    <>
      <PageHeader
        title="QR Codes"
        description="Selecione as mesas e gere a folha de impressão. Use “Salvar como PDF” na janela de impressão para gerar o arquivo."
      />

      {isLocalhost && (
        <p className="mb-6 rounded-lg bg-warning-soft px-4 py-3 text-sm text-warning">
          Os códigos apontam para {siteUrl}, que o celular não consegue abrir. Em testes, acesse o painel pelo IP da sua
          rede (ex.: http://192.168.0.10:3000); em produção defina NEXT_PUBLIC_SITE_URL.
        </p>
      )}

      <form action={`/painel/${slug}/qrcodes/imprimir`} method="get" className="grid items-start gap-6 lg:grid-cols-[1fr_18rem]">
        <div className="flex flex-col gap-6">
          <Card className="flex flex-wrap items-center gap-5">
            <div
              className="size-28 shrink-0 overflow-hidden rounded-lg border border-border bg-white p-1"
              dangerouslySetInnerHTML={{ __html: generalSvg }}
            />
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold">Cardápio geral</h2>
              <p className="text-sm text-muted">Sem vínculo com mesa — ideal para balcão, vitrine e redes sociais.</p>
              <Link href={generalUrl} target="_blank" className="mt-1 block truncate text-sm text-brand-text hover:underline">
                {generalUrl}
              </Link>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="geral" value="1" defaultChecked className="size-4" />
              Imprimir
            </label>
          </Card>

          {(tables ?? []).length === 0 ? (
            <EmptyState
              title="Nenhuma mesa"
              action={
                <Link href={`/painel/${slug}/mesas`} className="text-sm font-medium text-brand-text hover:underline">
                  Cadastrar mesas
                </Link>
              }
            />
          ) : (
            <Card>
              <h2 className="mb-3 font-semibold">Mesas</h2>
              <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
                {(tables ?? []).map((t) => (
                  <label
                    key={t.id}
                    className={`flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm ${t.active ? "" : "text-muted"}`}
                  >
                    <input type="checkbox" name="mesa" value={t.id} defaultChecked={t.active} disabled={!t.active} className="size-4" />
                    {t.name}
                    {!t.active && <span className="text-xs">(desativada)</span>}
                  </label>
                ))}
              </div>
            </Card>
          )}
        </div>

        <Card className="flex flex-col gap-3 lg:sticky lg:top-8">
          <p className="text-sm text-muted">
            A folha traz o QR Code, o nome do estabelecimento e a identificação da mesa, 4 por página A4.
          </p>
          <Button type="submit">Gerar folha de impressão</Button>
        </Card>
      </form>
    </>
  );
}
