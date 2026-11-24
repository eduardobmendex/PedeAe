import type { Metadata } from "next";
import { Suspense } from "react";
import { Header } from "@/components/header";
import { ButtonLink, Skeleton } from "@/components/ui";
import { requirePlatformAdmin } from "@/lib/auth";
import { pagarmeEnvironment } from "@/lib/payments/recipients";
import { paymentsConfigured } from "@/lib/payments/service";
import { createClient } from "@/lib/supabase/server";
import { EnvironmentNotice } from "./environment-notice";
import { RecipientsBoard, type RecipientRow } from "./recipients-board";

export const metadata: Metadata = { title: "Recebedores e KYC" };

export default function RecipientsPage() {
  return (
    <Suspense
      fallback={
        <main aria-busy="true" className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-8">
          <Skeleton className="h-8 w-64" />
          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
          <Skeleton className="h-96" />
        </main>
      }
    >
      <RecipientsContent />
    </Suspense>
  );
}

async function RecipientsContent() {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const [{ data: orgs }, { data: settings }] = await Promise.all([
    supabase.from("organizations").select("id, name, slug, status").order("name"),
    supabase
      .from("organization_payment_settings")
      .select(
        "organization_id, enabled, pagarme_recipient_id, platform_fee_percent, recipient_status, kyc_status, kyc_status_reason, recipient_type, recipient_name, recipient_synced_at, kyc_link_sent_at",
      ),
  ]);
  const byOrg = new Map((settings ?? []).map((s) => [s.organization_id, s]));
  const rows: RecipientRow[] = (orgs ?? []).map((o) => {
    const s = byOrg.get(o.id);
    return {
      organizationId: o.id,
      name: o.name,
      slug: o.slug,
      orgStatus: o.status,
      recipientId: s?.pagarme_recipient_id ?? null,
      recipientName: s?.recipient_name ?? null,
      recipientType: s?.recipient_type ?? null,
      status: s?.recipient_status ?? null,
      kycStatus: s?.kyc_status ?? null,
      kycReason: s?.kyc_status_reason ?? null,
      enabled: s?.enabled ?? false,
      feePercent: s?.platform_fee_percent ?? 0,
      syncedAt: s?.recipient_synced_at ?? null,
      kycLinkSentAt: s?.kyc_link_sent_at ?? null,
    };
  });

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-6xl px-4 py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Recebedores e KYC</h1>
            <p className="mt-1 text-sm text-muted">
              Credenciamento de cada estabelecimento no Pagar.me. O pagamento online só funciona depois do KYC aprovado.
            </p>
          </div>
          <ButtonLink href="/painel" variant="ghost">
            ← Administração
          </ButtonLink>
        </div>
        <EnvironmentNotice environment={pagarmeEnvironment()} configured={paymentsConfigured()} />
        <RecipientsBoard rows={rows} />
      </main>
    </>
  );
}
