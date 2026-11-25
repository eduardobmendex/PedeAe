"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Badge, Button, Card, EmptyState, Input, Select } from "@/components/ui";
import { CATALOG_BUCKET, IMAGE_TYPES, MAX_IMAGE_BYTES, imageUrl } from "@/lib/storage";
import { createClient } from "@/lib/supabase/client";
import { setCatalogImage } from "./actions";

export type CatalogRow = {
  key: string;
  category: string;
  name: string;
  description: string;
  types: string[];
  imagePath: string | null;
  defaultImagePath: string | null;
  customImagePath: string | null;
  /** Estabelecimentos que importaram o item. */
  organizations: number;
  /** Desses, quantos ainda usam a foto do catálogo (sem foto própria). */
  usingCatalogPhoto: number;
};

type PhotoFilter = "all" | "missing" | "custom" | "default";

const photoFilters: Record<PhotoFilter, string> = {
  all: "Todos",
  missing: "Sem foto",
  custom: "Foto enviada",
  default: "Foto original",
};

function photoKind(r: CatalogRow): Exclude<PhotoFilter, "all"> {
  if (r.customImagePath) return "custom";
  return r.imagePath ? "default" : "missing";
}

export function CatalogBoard({ types, rows }: { types: { id: string; name: string }[]; rows: CatalogRow[] }) {
  const [type, setType] = useState("");
  const [filter, setFilter] = useState<PhotoFilter>("all");
  const [query, setQuery] = useState("");
  const [propagate, setPropagate] = useState(true);

  const ofType = useMemo(() => (type ? rows.filter((r) => r.types.includes(type)) : rows), [rows, type]);
  const counts = useMemo(() => {
    const c: Record<PhotoFilter, number> = { all: ofType.length, missing: 0, custom: 0, default: 0 };
    for (const r of ofType) c[photoKind(r)]++;
    return c;
  }, [ofType]);
  const byCategory = useMemo(() => {
    const q = query.trim().toLowerCase();
    const map = new Map<string, CatalogRow[]>();
    for (const r of ofType) {
      if (filter !== "all" && photoKind(r) !== filter) continue;
      if (q && !`${r.name} ${r.category} ${r.key}`.toLowerCase().includes(q)) continue;
      map.set(r.category, [...(map.get(r.category) ?? []), r]);
    }
    return [...map.entries()];
  }, [ofType, filter, query]);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Select value={type} onChange={(e) => setType(e.target.value)} aria-label="Tipo de estabelecimento">
          <option value="">Todos os tipos</option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar produto"
          aria-label="Buscar produto"
          className="w-full sm:w-64"
        />
      </div>

      <div role="tablist" aria-label="Filtrar por foto" className="mb-4 flex flex-wrap gap-1">
        {(Object.keys(photoFilters) as PhotoFilter[]).map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              filter === f ? "bg-active text-active-text" : "text-muted hover:bg-hover"
            }`}
          >
            {photoFilters[f]}
            <span className="ml-1 tabular-nums opacity-70">{counts[f]}</span>
          </button>
        ))}
      </div>

      <label className="mb-6 flex items-start gap-3 rounded-xl border border-border bg-surface-2 p-4 text-sm">
        <input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={propagate} onChange={(e) => setPropagate(e.target.checked)} />
        <span>
          <span className="font-medium">Trocar também nos cardápios que já importaram</span>
          <span className="block text-muted">
            Só nos produtos que ainda usam a foto do catálogo. Foto enviada pelo próprio estabelecimento nunca é trocada. Desmarcado, a nova foto vale
            só para as próximas importações.
          </span>
        </span>
      </label>

      {byCategory.length === 0 ? (
        <EmptyState title="Nada neste filtro">Troque o tipo, o filtro ou a busca.</EmptyState>
      ) : (
        <div className="flex flex-col gap-8">
          {byCategory.map(([category, list]) => (
            <section key={category} aria-labelledby={`cat-${list[0].key}`}>
              <h2 id={`cat-${list[0].key}`} className="mb-3 font-semibold">
                {category} <span className="text-sm font-normal text-muted">({list.length})</span>
              </h2>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {list.map((r) => (
                  <ItemCard key={r.key} row={r} propagate={propagate} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

function ItemCard({ row: r, propagate }: { row: CatalogRow; propagate: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"upload" | "reset" | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();
  const url = imageUrl(r.imagePath);
  const kind = photoKind(r);

  async function apply(objectName: string | null) {
    const result = await setCatalogImage(r.key, objectName, propagate);
    if (!result.ok) return setMessage({ tone: "error", text: result.error });
    setMessage({
      tone: "ok",
      text: result.products
        ? `Atualizada em ${result.products} produto(s) de ${result.organizations} cardápio(s).`
        : objectName
          ? "Foto salva."
          : "Foto original restaurada.",
    });
    router.refresh();
  }

  async function upload(file: File) {
    setMessage(undefined);
    if (!IMAGE_TYPES.includes(file.type)) return setMessage({ tone: "error", text: "Use JPG, PNG ou WebP." });
    if (file.size > MAX_IMAGE_BYTES) return setMessage({ tone: "error", text: "A imagem precisa ter até 5 MB." });
    setBusy("upload");
    try {
      const ext = file.type.split("/")[1].replace("jpeg", "jpg");
      const objectName = `${r.key}/${crypto.randomUUID()}.${ext}`;
      const { error } = await createClient()
        .storage.from(CATALOG_BUCKET)
        .upload(objectName, file, { contentType: file.type, cacheControl: "31536000", upsert: false });
      if (error) return setMessage({ tone: "error", text: "Falha no envio da imagem. Tente novamente." });
      await apply(objectName);
    } catch {
      setMessage({ tone: "error", text: "Sem conexão com o servidor." });
    } finally {
      setBusy(null);
    }
  }

  async function reset() {
    setMessage(undefined);
    setBusy("reset");
    try {
      await apply(null);
    } catch {
      setMessage({ tone: "error", text: "Sem conexão com o servidor." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <li>
      <Card className="flex h-full flex-col gap-2 p-3">
        <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-surface-2">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={r.name} loading="lazy" className="size-full object-cover" />
          ) : (
            <div className="flex size-full items-center justify-center text-sm text-muted">Sem foto</div>
          )}
          {busy && (
            <div className="absolute inset-0 flex items-center justify-center bg-surface/70" aria-hidden>
              <span className="size-5 animate-spin rounded-full border-2 border-muted border-t-transparent" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-snug">{r.name}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {kind === "custom" && <Badge tone="info">Foto enviada</Badge>}
            {kind === "missing" && <Badge tone="warning">Sem foto</Badge>}
            {r.organizations > 0 && (
              <span className="text-xs text-muted" title={`${r.usingCatalogPhoto} usa(m) a foto do catálogo`}>
                Em {r.organizations} cardápio(s)
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          <label
            className={`flex-1 cursor-pointer rounded-lg border border-border-strong px-2 py-1.5 text-center text-sm hover:bg-hover has-focus-visible:outline-2 has-focus-visible:outline-ring ${
              busy ? "pointer-events-none opacity-50" : ""
            }`}
          >
            {busy === "upload" ? "Enviando…" : url ? "Trocar foto" : "Enviar foto"}
            <input
              type="file"
              accept={IMAGE_TYPES.join(",")}
              className="sr-only"
              disabled={!!busy}
              aria-label={`Foto de ${r.name}`}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) upload(file);
                e.target.value = "";
              }}
            />
          </label>
          {r.customImagePath && (
            <Button type="button" variant="ghost" className="h-auto px-2 py-1.5" disabled={!!busy} onClick={reset}>
              {r.defaultImagePath ? "Voltar à original" : "Remover"}
            </Button>
          )}
        </div>
        {message && (
          <p role={message.tone === "error" ? "alert" : "status"} className={`text-xs ${message.tone === "error" ? "text-danger" : "text-success"}`}>
            {message.text}
          </p>
        )}
      </Card>
    </li>
  );
}
