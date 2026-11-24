"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Badge, ButtonLink, Card, EmptyState, Input } from "@/components/ui";
import { dateTimeBR, isRecipientStatus, kycInfo, nextStep, recipientStatuses } from "@/lib/payments/recipient-status";
import { syncAllRecipients, type SyncResult } from "./actions";
import { ShareKycButton } from "./kyc-share";

export type RecipientRow = {
  organizationId: string;
  name: string;
  slug: string;
  orgStatus: string;
  recipientId: string | null;
  recipientName: string | null;
  recipientType: string | null;
  status: string | null;
  kycStatus: string | null;
  kycReason: string | null;
  enabled: boolean;
  feePercent: number;
  syncedAt: string | null;
  kycLinkSentAt: string | null;
};

type Group = "none" | "docs" | "analysis" | "approved" | "problem";

const groups: Record<Group | "all", string> = {
  all: "Todos",
  none: "Sem recebedor",
  docs: "Aguardando documentos",
  analysis: "Em análise",
  approved: "Aprovados",
  problem: "Com problema",
};

function groupOf(r: RecipientRow): Group {
  if (!r.recipientId) return "none";
  if (r.status === "active") return "approved";
  if (["refused", "suspended", "blocked", "inactive"].includes(r.status ?? "") || r.kycStatus === "denied") return "problem";
  if (r.kycStatus === "partially_denied") return "docs";
  return "analysis";
}


/** Lista de todos os estabelecimentos com o status no Pagar.me (consultado ao abrir a tela). */
export function RecipientsBoard({ rows }: { rows: RecipientRow[] }) {
  const router = useRouter();
  const [sync, setSync] = useState<{ state: "running" | "done" | "error"; results: Map<string, SyncResult>; error?: string; at?: string }>({
    state: "running",
    results: new Map(),
  });
  const [filter, setFilter] = useState<Group | "all">("all");
  const [query, setQuery] = useState("");

  function runSync() {
    setSync((s) => ({ ...s, state: "running" }));
    return syncAllRecipients()
      .then((r) => {
        setSync({
          state: r.error ? "error" : "done",
          error: r.error,
          results: new Map(r.results.map((x) => [x.organizationId, x])),
          at: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        });
        router.refresh();
      })
      .catch(() => setSync((s) => ({ ...s, state: "error", error: "Sem conexão com o servidor." })));
  }

  // Sempre que a tela abre: consulta todos os recebedores no Pagar.me.
  useEffect(() => {
    let alive = true;
    syncAllRecipients()
      .then((r) => {
        if (!alive) return;
        setSync({
          state: r.error ? "error" : "done",
          error: r.error,
          results: new Map(r.results.map((x) => [x.organizationId, x])),
          at: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        });
        router.refresh();
      })
      .catch(() => alive && setSync((s) => ({ ...s, state: "error", error: "Sem conexão com o servidor." })));
    return () => {
      alive = false;
    };
  }, [router]);

  const counts = useMemo(() => {
    const c: Record<Group, number> = { none: 0, docs: 0, analysis: 0, approved: 0, problem: 0 };
    for (const r of rows) c[groupOf(r)]++;
    return c;
  }, [rows]);
  const live = rows.filter((r) => r.enabled && r.status === "active").length;

  const visible = rows.filter((r) => {
    if (filter !== "all" && groupOf(r) !== filter) return false;
    const q = query.trim().toLowerCase();
    return !q || r.name.toLowerCase().includes(q) || r.slug.includes(q) || (r.recipientId ?? "").toLowerCase().includes(q);
  });
  const failures = [...sync.results.values()].filter((r) => !r.ok).length;

  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Estabelecimentos" value={rows.length} />
        <Kpi label="Aprovados" value={counts.approved} tone="text-success" />
        <Kpi label="Aguardando documentos" value={counts.docs} tone={counts.docs ? "text-warning" : undefined} />
        <Kpi label="Em análise" value={counts.analysis} tone={counts.analysis ? "text-info" : undefined} />
        <Kpi label="Com problema" value={counts.problem} tone={counts.problem ? "text-danger" : undefined} />
        <Kpi label="Recebendo online" value={live} note={`${counts.none} sem recebedor`} />
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Filtrar por situação" className="flex flex-wrap gap-1">
          {(Object.keys(groups) as (Group | "all")[]).map((g) => (
            <button
              key={g}
              type="button"
              role="tab"
              aria-selected={filter === g}
              onClick={() => setFilter(g)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                filter === g ? "bg-active text-active-text" : "text-muted hover:bg-hover"
              }`}
            >
              {groups[g]}
              <span className="ml-1 tabular-nums opacity-70">{g === "all" ? rows.length : counts[g]}</span>
            </button>
          ))}
        </div>
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar estabelecimento ou re_..."
          aria-label="Buscar"
          className="w-full sm:w-64"
        />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm" aria-live="polite">
        {sync.state === "running" && (
          <span className="inline-flex items-center gap-2 text-muted">
            <span className="size-3 animate-spin rounded-full border-2 border-muted border-t-transparent" aria-hidden />
            Consultando o Pagar.me…
          </span>
        )}
        {sync.state === "done" && (
          <span className="text-muted">
            Status consultado no Pagar.me às {sync.at}
            {failures > 0 && <span className="text-danger"> · {failures} consulta(s) com erro</span>}
          </span>
        )}
        {sync.state === "error" && <span className="text-danger">{sync.error}</span>}
        {sync.state !== "running" && (
          <button type="button" onClick={runSync} className="rounded-lg px-2 py-1 font-medium text-brand-text hover:bg-hover">
            Consultar de novo
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <EmptyState title={rows.length ? "Nada neste filtro" : "Nenhum estabelecimento ainda"}>
          {rows.length ? "Troque o filtro ou a busca." : "Cadastre estabelecimentos na Administração."}
        </EmptyState>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.3fr)_auto] gap-4 border-b border-border bg-surface-2 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted lg:grid">
            <span>Estabelecimento</span>
            <span>Recebedor no Pagar.me</span>
            <span>Pagamento online</span>
            <span>Próximo passo</span>
            <span className="w-56 text-right">Ações</span>
          </div>
          <ul className="divide-y divide-border">
            {visible.map((r) => (
              <Row key={r.organizationId} row={r} result={sync.results.get(r.organizationId)} checking={sync.state === "running" && !!r.recipientId} />
            ))}
          </ul>
        </Card>
      )}
      <p className="mt-3 text-xs text-muted">
        O status é consultado no Pagar.me sempre que esta tela abre e também chega sozinho pelo webhook (evento recipient.updated). O link de KYC vale
        cerca de 20 minutos; gere outro se expirar.
      </p>
    </>
  );
}

function Row({ row: r, result, checking }: { row: RecipientRow; result?: SyncResult; checking: boolean }) {
  const st = isRecipientStatus(r.status) ? recipientStatuses[r.status] : null;
  const kyc = kycInfo(r.kycStatus, r.kycReason);
  const online = !r.enabled
    ? { label: "Desligado", tone: "neutral" as const }
    : r.status === "active"
      ? { label: "Funcionando", tone: "success" as const }
      : { label: "Ligado · aguarda KYC", tone: "warning" as const };

  return (
    <li className="grid gap-3 px-4 py-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.3fr)_auto] lg:items-center lg:gap-4">
      <div className="min-w-0">
        <Link href={`/painel/recebedores/${r.slug}`} className="font-medium hover:underline">
          {r.name}
        </Link>
        <p className="truncate text-sm text-muted">
          /m/{r.slug}
          {r.orgStatus !== "active" && <span className="text-warning"> · {r.orgStatus === "suspended" ? "suspenso" : "cancelado"}</span>}
        </p>
      </div>

      <div className="min-w-0">
        {r.recipientId ? (
          <>
            <p className="flex flex-wrap items-center gap-1.5">
              {st ? <Badge tone={st.tone}>{st.label}</Badge> : <Badge>Status desconhecido</Badge>}
              {kyc && <Badge tone={kyc.tone}>{kyc.label}</Badge>}
              {checking && <span className="size-3 animate-spin rounded-full border-2 border-muted border-t-transparent" aria-label="consultando" />}
            </p>
            <p className="mt-1 truncate font-mono text-xs text-muted" title={r.recipientId}>
              {r.recipientId}
              {r.recipientType && ` · ${r.recipientType === "individual" ? "PF" : "PJ"}`}
            </p>
            {result && !result.ok && <p className="mt-1 text-xs text-danger">Erro na consulta: {result.error}</p>}
            {r.syncedAt && <p className="text-xs text-muted">Consultado em {dateTimeBR(r.syncedAt)}</p>}
          </>
        ) : (
          <Badge>Sem recebedor</Badge>
        )}
      </div>

      <div>
        <Badge tone={online.tone}>{online.label}</Badge>
        {r.enabled && r.feePercent > 0 && <p className="mt-1 text-xs text-muted">Comissão {r.feePercent}%</p>}
      </div>

      <p className="text-sm">
        {nextStep(r.recipientId, r.status, r.kycStatus)}
        {r.kycLinkSentAt && r.status !== "active" && <span className="block text-xs text-muted">Último link de KYC: {dateTimeBR(r.kycLinkSentAt)}</span>}
      </p>

      <div className="flex flex-wrap gap-2 lg:w-56 lg:justify-end">
        {!r.recipientId ? (
          <ButtonLink href={`/painel/recebedores/${r.slug}#iniciar-kyc`} className="h-9 px-3">
            Iniciar KYC
          </ButtonLink>
        ) : (
          r.status !== "active" && <ShareKycButton slug={r.slug} orgName={r.name} variant={r.kycStatus === "partially_denied" ? "primary" : "secondary"} className="h-9 px-3" />
        )}
        <ButtonLink href={`/painel/recebedores/${r.slug}`} variant="ghost" className="h-9 px-3">
          Detalhes
        </ButtonLink>
      </div>
    </li>
  );
}

function Kpi({ label, value, note, tone }: { label: string; value: number; note?: string; tone?: string }) {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className={`text-2xl font-semibold tabular-nums ${tone ?? ""}`}>{value}</p>
      {note && <p className="text-xs text-muted">{note}</p>}
    </Card>
  );
}
