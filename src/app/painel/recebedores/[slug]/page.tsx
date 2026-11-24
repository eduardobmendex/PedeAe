import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Header } from "@/components/header";
import { Badge, ButtonLink, Card, Skeleton } from "@/components/ui";
import { describeAudit, type AuditEntry } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth";
import { dateTimeBR, isRecipientStatus, kycInfo, nextStep, recipientStatuses } from "@/lib/payments/recipient-status";
import { pagarmeEnvironment } from "@/lib/payments/recipients";
import { paymentsConfigured } from "@/lib/payments/service";
import { createClient } from "@/lib/supabase/server";
import { EnvironmentNotice } from "../environment-notice";
import { ShareKycButton } from "../kyc-share";
import { LinkRecipientForm, OnlineSettingsForm, RecipientStatusActions, StartKycForm } from "./forms";

export const metadata: Metadata = { title: "Recebedor e KYC" };

export default function RecipientDetailPage({ params }: PageProps<"/painel/recebedores/[slug]">) {
  return (
    <Suspense
      fallback={
        <main aria-busy="true" className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-8">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-48" />
          <Skeleton className="h-96" />
        </main>
      }
    >
      <RecipientDetail params={params} />
    </Suspense>
  );
}

async function RecipientDetail({ params }: Pick<PageProps<"/painel/recebedores/[slug]">, "params">) {
  const { slug } = await params;
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { data: org } = await supabase.from("organizations").select("id, name, slug, status").eq("slug", slug).maybeSingle();
  if (!org) notFound();

  const [{ data: s }, { data: logs }] = await Promise.all([
    supabase
      .from("organization_payment_settings")
      .select("enabled, pagarme_recipient_id, platform_fee_percent, recipient_status, kyc_status, kyc_status_reason, recipient_type, recipient_name, recipient_synced_at, kyc_link_sent_at")
      .eq("organization_id", org.id)
      .maybeSingle(),
    supabase
      .from("audit_logs")
      .select("id, action, entity_type, entity_id, metadata, created_at, actor_user_id")
      .eq("organization_id", org.id)
      .like("action", "payments.%")
      .order("id", { ascending: false })
      .limit(20),
  ]);

  const recipientId = s?.pagarme_recipient_id ?? null;
  const status = s?.recipient_status ?? null;
  const st = isRecipientStatus(status) ? recipientStatuses[status] : null;
  const kyc = kycInfo(s?.kyc_status, s?.kyc_status_reason);
  const environment = pagarmeEnvironment();

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-5xl px-4 py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-muted">Recebedores e KYC</p>
            <h1 className="text-2xl font-semibold tracking-tight">{org.name}</h1>
            <p className="mt-1 text-sm text-muted">/m/{org.slug}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ButtonLink href="/painel/recebedores" variant="ghost">
              ← Todos os recebedores
            </ButtonLink>
            <ButtonLink href={`/painel/${org.slug}/assinatura`} variant="secondary">
              Assinatura
            </ButtonLink>
          </div>
        </div>
        <EnvironmentNotice environment={environment} configured={paymentsConfigured()} />

        {/* Situação no Pagar.me */}
        <Card className="mb-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="font-semibold">Situação no Pagar.me</h2>
              {recipientId ? (
                <dl className="mt-3 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-muted">Recebedor</dt>
                    <dd className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      {st ? <Badge tone={st.tone}>{st.label}</Badge> : <Badge>Status desconhecido</Badge>}
                    </dd>
                    {st && <dd className="mt-1 text-xs text-muted">{st.help}</dd>}
                  </div>
                  <div>
                    <dt className="text-muted">KYC (prova de vida)</dt>
                    <dd className="mt-0.5">{kyc ? <Badge tone={kyc.tone}>{kyc.label}</Badge> : <span className="text-muted">Sem informação do Pagar.me</span>}</dd>
                    {kyc?.help && <dd className="mt-1 text-xs text-muted">{kyc.help}</dd>}
                  </div>
                  <div>
                    <dt className="text-muted">ID</dt>
                    <dd className="mt-0.5 break-all font-mono text-xs">{recipientId}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Cadastro</dt>
                    <dd className="mt-0.5">
                      {s?.recipient_name ?? "—"}
                      {s?.recipient_type && ` · ${s.recipient_type === "individual" ? "Pessoa física" : "Pessoa jurídica"}`}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted">Última consulta</dt>
                    <dd className="mt-0.5">{s?.recipient_synced_at ? dateTimeBR(s.recipient_synced_at) : "nunca"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Último link de KYC</dt>
                    <dd className="mt-0.5">{s?.kyc_link_sent_at ? dateTimeBR(s.kyc_link_sent_at) : "nenhum"}</dd>
                  </div>
                </dl>
              ) : (
                <p className="mt-1 text-sm text-muted">Este estabelecimento ainda não é recebedor no Pagar.me. Inicie o KYC abaixo.</p>
              )}
              <p className="mt-4 rounded-lg bg-surface-2 px-3 py-2 text-sm">
                <span className="font-medium">Próximo passo:</span> {nextStep(recipientId, status, s?.kyc_status ?? null)}
              </p>
            </div>
            {recipientId && (
              <div className="flex flex-col gap-2">
                {status !== "active" && (
                  <ShareKycButton slug={org.slug} orgName={org.name} variant={s?.kyc_status === "partially_denied" ? "primary" : "secondary"} />
                )}
                <RecipientStatusActions slug={org.slug} />
              </div>
            )}
          </div>
        </Card>

        {!recipientId && (
          <div className="mb-6 grid items-start gap-6 lg:grid-cols-[1fr_20rem]">
            <Card id="iniciar-kyc">
              <h2 className="font-semibold">Iniciar KYC</h2>
              <p className="mb-4 text-sm text-muted">
                Cadastra o estabelecimento como recebedor no Pagar.me (split). Depois o Pagar.me analisa e pede os documentos e a prova de vida pelo link de KYC.
              </p>
              <StartKycForm slug={org.slug} disabled={!environment} />
            </Card>
            <Card>
              <h2 className="font-semibold">Já tem recebedor?</h2>
              <p className="mb-4 text-sm text-muted">Se o cadastro foi feito no painel do Pagar.me, informe o ID para vincular.</p>
              <LinkRecipientForm slug={org.slug} disabled={!environment} />
            </Card>
          </div>
        )}

        <div className="grid items-start gap-6 lg:grid-cols-2">
          <Card>
            <h2 className="font-semibold">Pagamento online no cardápio</h2>
            <p className="mb-4 text-sm text-muted">Pix e cartão na mesa, antes do pedido ou por link. Só funciona com o KYC aprovado.</p>
            <p className="mb-4">
              {!s?.enabled ? (
                <Badge>Desligado</Badge>
              ) : status === "active" ? (
                <Badge tone="success">Funcionando</Badge>
              ) : (
                <Badge tone="warning">Ligado · começa quando o KYC for aprovado</Badge>
              )}
            </p>
            <OnlineSettingsForm slug={org.slug} enabled={s?.enabled ?? false} feePercent={s?.platform_fee_percent ?? 0} hasRecipient={!!recipientId} />
          </Card>

          <Card>
            <h2 className="mb-3 font-semibold">Histórico</h2>
            {(logs ?? []).length === 0 ? (
              <p className="text-sm text-muted">Nada registrado ainda.</p>
            ) : (
              <ol className="flex flex-col gap-3">
                {(logs as AuditEntry[]).map((l) => {
                  const d = describeAudit(l);
                  return (
                    <li key={l.id} className="border-l-2 border-border pl-3 text-sm">
                      <p className="font-medium">{d.title}</p>
                      {d.details.length > 0 && <p className="text-xs text-muted">{d.details.join(" · ")}</p>}
                      <p className="text-xs text-muted">{dateTimeBR(l.created_at)}</p>
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>
        </div>
      </main>
    </>
  );
}
