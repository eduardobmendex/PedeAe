import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { menuUrl, qrSvg, tableUrl } from "@/lib/qr";
import { getSiteUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Imprimir QR Codes" };

export default async function PrintQrPage({ params, searchParams }: PageProps<"/painel/[slug]/qrcodes/imprimir">) {
  const { slug } = await params;
  const query = await searchParams;
  const { organization } = await requirePermission(slug, "manage_tables");
  const supabase = await createClient();
  const siteUrl = await getSiteUrl();

  const ids = ([] as string[]).concat(query.mesa ?? []).filter((id) => /^[0-9a-f-]{36}$/.test(id));
  const { data: tables } = ids.length
    ? await supabase
        .from("tables")
        .select("id, name, table_qr_codes (token, revoked_at)")
        .eq("organization_id", organization.id)
        .eq("active", true)
        .in("id", ids)
        .order("sort_order")
        .order("name")
    : { data: [] };

  const cards: { key: string; title: string; subtitle: string; svg: string }[] = [];
  if (query.geral === "1") {
    cards.push({ key: "geral", title: "Cardápio", subtitle: "Aponte a câmera para ver o cardápio", svg: await qrSvg(menuUrl(siteUrl, slug)) });
  }
  for (const t of tables ?? []) {
    const token = t.table_qr_codes?.find((q) => !q.revoked_at)?.token;
    if (!token) continue;
    cards.push({ key: t.id, title: t.name, subtitle: "Aponte a câmera para pedir", svg: await qrSvg(tableUrl(siteUrl, token)) });
  }

  return (
    <>
      <style>{`@page { size: A4; margin: 12mm; }`}</style>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold">Folha de QR Codes</h1>
          <p className="text-sm text-muted">{cards.length} código(s). Recorte nas linhas tracejadas.</p>
        </div>
        <div className="flex gap-2">
          <ButtonLink href={`/painel/${slug}/qrcodes`} variant="secondary">
            Voltar
          </ButtonLink>
          <PrintButton disabled={cards.length === 0} />
        </div>
      </div>

      {cards.length === 0 ? (
        <p className="text-sm text-muted">Nenhum código selecionado.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 print:grid-cols-2 print:gap-0">
          {cards.map((card) => (
            <div
              key={card.key}
              className="flex break-inside-avoid flex-col items-center gap-3 rounded-xl border-2 border-dashed border-border-strong bg-white p-6 text-center text-black print:h-[133mm] print:justify-center print:rounded-none print:border-gray-400"
            >
              <p className="text-sm font-medium tracking-wide text-gray-600 uppercase">{organization.name}</p>
              <div className="w-48 max-w-full print:w-[70mm]" dangerouslySetInnerHTML={{ __html: card.svg }} />
              <p className="text-3xl font-bold">{card.title}</p>
              <p className="text-sm text-gray-600">{card.subtitle}</p>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
