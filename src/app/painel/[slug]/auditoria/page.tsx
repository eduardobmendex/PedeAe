import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { getOrgContext } from "@/lib/auth";
import { auditCategories, categoryOf, categoryPrefixes, describeAudit, type AuditCategory, type AuditEntry } from "@/lib/audit";
import { addDays, businessToday } from "@/lib/report-period";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Auditoria" };

const PAGE_SIZE = 50;
const PERIODS = { "7d": "7 dias", "30d": "30 dias", "90d": "90 dias", tudo: "Tudo" } as const;
type PeriodKey = keyof typeof PERIODS;

const when = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Bahia",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const ENTITY_TABLES: Record<string, "products" | "categories" | "tables"> = {
  products: "products",
  categories: "categories",
  tables: "tables",
  table_qr: "tables",
  product_options: "products",
};

export default async function AuditPage({ params, searchParams }: PageProps<"/painel/[slug]/auditoria">) {
  const { slug } = await params;
  const sp = await searchParams;
  const { organization, membership, isPlatformAdmin } = await getOrgContext(slug);
  if (membership.role !== "admin") notFound();

  const visibleCategories = (Object.keys(auditCategories) as AuditCategory[]).filter((c) => c !== "assinatura" || isPlatformAdmin);
  const category = visibleCategories.find((c) => c === sp.categoria) ?? null;
  const period: PeriodKey = typeof sp.periodo === "string" && sp.periodo in PERIODS ? (sp.periodo as PeriodKey) : "30d";
  const actor = typeof sp.pessoa === "string" && /^[0-9a-f-]{36}$/.test(sp.pessoa) ? sp.pessoa : null;
  const before = typeof sp.antes === "string" && /^\d+$/.test(sp.antes) ? Number(sp.antes) : null;

  const supabase = await createClient();
  let query = supabase
    .from("audit_logs")
    .select("id, action, entity_type, entity_id, metadata, created_at, actor_user_id")
    .eq("organization_id", organization.id)
    .order("id", { ascending: false })
    .limit(PAGE_SIZE + 1);
  if (category) query = query.or(categoryPrefixes[category].map((p) => `action.like.${p}*`).join(","));
  // Cobrança do SaaS é assunto interno da plataforma.
  if (!isPlatformAdmin) query = query.not("action", "like", "billing.*");
  if (actor) query = query.eq("actor_user_id", actor);
  if (period !== "tudo") {
    const days = Number.parseInt(period, 10);
    query = query.gte("created_at", new Date(`${addDays(businessToday(), -(days - 1))}T00:00:00-03:00`).toISOString());
  }
  if (before) query = query.lt("id", before);

  const [{ data }, { data: members }] = await Promise.all([
    query,
    supabase.from("memberships").select("user_id, profiles (name, email)").eq("organization_id", organization.id),
  ]);
  const rows = (data ?? []) as AuditEntry[];
  const page = rows.slice(0, PAGE_SIZE);
  const hasMore = rows.length > PAGE_SIZE;

  // Nomes atuais das entidades citadas (produtos, categorias, mesas) e de quem fez.
  const names = new Map<string, string>();
  const idsByTable = new Map<string, Set<string>>();
  for (const r of page) {
    const table = ENTITY_TABLES[r.action.split(".")[0]];
    if (table && r.entity_id) idsByTable.set(table, (idsByTable.get(table) ?? new Set()).add(r.entity_id));
  }
  await Promise.all(
    [...idsByTable].map(async ([table, ids]) => {
      const { data: found } = await supabase.from(table).select("id, name").in("id", [...ids]);
      for (const f of found ?? []) names.set(f.id, f.name);
    }),
  );
  const people = new Map<string, string>();
  for (const m of members ?? []) {
    const p = m.profiles as unknown as { name: string | null; email: string | null } | null;
    people.set(m.user_id, p?.name || p?.email || "Membro da equipe");
  }
  const actorName = (id: string | null) => (id === null ? "Sistema" : (people.get(id) ?? "Equipe PedeAe"));

  const link = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams();
    const current = { categoria: category, periodo: period, pessoa: actor, ...patch };
    for (const [k, v] of Object.entries(current)) if (v) next.set(k, v);
    return `/painel/${slug}/auditoria?${next}`;
  };

  return (
    <>
      <PageHeader
        title="Auditoria"
        description="Quem mudou o quê e quando: cardápio, preços, mesas, equipe e visual. Os registros são gravados automaticamente e não podem ser editados."
      />

      <div className="mb-5 flex flex-col gap-3">
        <FilterRow label="Assunto">
          <Chip href={link({ categoria: null })} on={!category}>
            Tudo
          </Chip>
          {visibleCategories.map((c) => (
            <Chip key={c} href={link({ categoria: c })} on={category === c}>
              {auditCategories[c]}
            </Chip>
          ))}
        </FilterRow>
        <FilterRow label="Período">
          {(Object.keys(PERIODS) as PeriodKey[]).map((p) => (
            <Chip key={p} href={link({ periodo: p })} on={period === p}>
              {PERIODS[p]}
            </Chip>
          ))}
        </FilterRow>
        {people.size > 1 && (
          <FilterRow label="Pessoa">
            <Chip href={link({ pessoa: null })} on={!actor}>
              Todas
            </Chip>
            {[...people].map(([id, name]) => (
              <Chip key={id} href={link({ pessoa: id })} on={actor === id}>
                {name}
              </Chip>
            ))}
          </FilterRow>
        )}
      </div>

      {page.length === 0 ? (
        <EmptyState title="Nenhum registro">Nada foi alterado com esses filtros.</EmptyState>
      ) : (
        <Card className="p-0">
          <ol className="divide-y divide-border">
            {page.map((r) => {
              const { title, details } = describeAudit(r, r.entity_id ? names.get(r.entity_id) : undefined);
              const cat = categoryOf(r.action);
              return (
                <li key={r.id} className="flex flex-col gap-1 p-4 sm:flex-row sm:items-start sm:gap-4">
                  <time dateTime={r.created_at} className="shrink-0 text-sm text-muted tabular-nums sm:w-36">
                    {when.format(new Date(r.created_at))}
                  </time>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{title}</p>
                    {details.length > 0 && (
                      <ul className="mt-0.5 text-sm text-muted">
                        {details.slice(0, 6).map((d) => (
                          <li key={d} className="break-words">
                            {d}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-sm text-muted sm:flex-col sm:items-end">
                    <span>{actorName(r.actor_user_id)}</span>
                    {cat && <Badge>{auditCategories[cat]}</Badge>}
                  </div>
                </li>
              );
            })}
          </ol>
        </Card>
      )}

      <div className="mt-4 flex gap-3 text-sm">
        {before && (
          <Link href={link({})} className="font-medium text-brand-text hover:underline">
            ← Mais recentes
          </Link>
        )}
        {hasMore && (
          <Link href={`${link({})}&antes=${page[page.length - 1].id}`} className="font-medium text-brand-text hover:underline">
            Registros mais antigos →
          </Link>
        )}
      </div>
    </>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-16 text-xs font-medium text-muted">{label}</span>
      {children}
    </div>
  );
}

function Chip({ href, on, children }: { href: string; on: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={`rounded-full px-3 py-1 text-sm font-medium ${on ? "bg-brand text-brand-contrast" : "bg-surface-2 text-muted hover:text-text"}`}
    >
      {children}
    </Link>
  );
}
