"use client";

import { useActionState, useState, type ReactNode } from "react";
import { ImageUpload } from "@/components/image-upload";
import { Button, Card, Field, FormMessage, Input } from "@/components/ui";
import { imageUrl } from "@/lib/storage";
import {
  brandContrastOnTheme,
  brandStyle,
  corners,
  fonts,
  themeLabels,
  themes,
  type Branding,
  type CornerKey,
  type FontKey,
} from "@/lib/theme";
import { saveBranding } from "./actions";

type Images = { logo_path: string | null; cover_path: string | null };

export function BrandingForm({
  slug,
  organizationId,
  name: initialName,
  initial,
  initialImages,
}: {
  slug: string;
  organizationId: string;
  name: string;
  initial: Branding;
  initialImages: Images;
}) {
  const [state, action, pending] = useActionState(saveBranding.bind(null, slug), undefined);
  const [name, setName] = useState(initialName);
  const [b, setB] = useState<Branding>(initial);
  const [images, setImages] = useState<Images>(initialImages);
  const set = <K extends keyof Branding>(key: K, value: Branding[K]) => setB((prev) => ({ ...prev, [key]: value }));

  const dirty =
    name !== initialName ||
    JSON.stringify(b) !== JSON.stringify(initial) ||
    images.logo_path !== initialImages.logo_path ||
    images.cover_path !== initialImages.cover_path;
  const lowContrast = brandContrastOnTheme(b.brand_color, b.theme) < 3;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[1fr_22rem]">
      <form action={action} className="flex flex-col gap-6">
        <Card className="flex flex-col gap-5">
          <h2 className="font-semibold">Estabelecimento</h2>
          <Field label="Nome exibido" htmlFor="name">
            <Input id="name" name="name" value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
        </Card>

        <Card className="flex flex-col gap-5">
          <h2 className="font-semibold">Aparência do cardápio</h2>

          <Choice legend="Tema">
            {themes.map((t) => (
              <Option key={t} name="theme" value={t} checked={b.theme === t} onChange={() => set("theme", t)}>
                <span
                  data-theme={t}
                  className="size-5 rounded-full border border-border-strong bg-surface"
                  aria-hidden
                />
                {themeLabels[t]}
              </Option>
            ))}
          </Choice>

          <div className="grid gap-5 sm:grid-cols-2">
            <ColorField
              id="brand_color"
              label="Cor principal"
              hint="Botões e destaques"
              value={b.brand_color}
              onChange={(v) => set("brand_color", v)}
            />
            <ColorField
              id="accent_color"
              label="Cor de destaque"
              hint="Selos e promoções"
              value={b.accent_color}
              onChange={(v) => set("accent_color", v)}
            />
          </div>
          {lowContrast && (
            <p role="alert" className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
              A cor principal tem pouco contraste com o fundo do tema {themeLabels[b.theme]}. Textos e ícones nessa cor
              podem ficar difíceis de ler.
            </p>
          )}

          <Choice legend="Tipografia">
            {(Object.keys(fonts) as FontKey[]).map((f) => (
              <Option key={f} name="font" value={f} checked={b.font === f} onChange={() => set("font", f)}>
                <span style={{ fontFamily: fonts[f].css }}>{fonts[f].label}</span>
              </Option>
            ))}
          </Choice>

          <Choice legend="Botões e cartões">
            {(Object.keys(corners) as CornerKey[]).map((c) => (
              <Option key={c} name="corners" value={c} checked={b.corners === c} onChange={() => set("corners", c)}>
                <span
                  className="size-5 border-2 border-text"
                  style={{ borderRadius: corners[c].radius === "1.25rem" ? "9999px" : corners[c].radius }}
                  aria-hidden
                />
                {corners[c].label}
              </Option>
            ))}
          </Choice>

          <div className="grid gap-5 sm:grid-cols-[10rem_1fr]">
            <ImageUpload
              label="Logotipo"
              organizationId={organizationId}
              folder="brand"
              path={images.logo_path}
              onChange={(p) => setImages((i) => ({ ...i, logo_path: p }))}
              aspect="aspect-square"
            />
            <ImageUpload
              label="Imagem de capa"
              organizationId={organizationId}
              folder="brand"
              path={images.cover_path}
              onChange={(p) => setImages((i) => ({ ...i, cover_path: p }))}
              aspect="aspect-[16/9]"
            />
          </div>
          <input type="hidden" name="logo_path" value={images.logo_path ?? ""} />
          <input type="hidden" name="cover_path" value={images.cover_path ?? ""} />
        </Card>

        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" disabled={pending || !dirty}>
            {pending ? "Publicando…" : "Publicar alterações"}
          </Button>
          {dirty && !pending ? (
            <span className="text-sm text-muted">Alterações não publicadas</span>
          ) : (
            <FormMessage state={state} />
          )}
        </div>
      </form>

      <div className="lg:sticky lg:top-8">
        <p className="mb-2 text-sm font-medium text-muted">Prévia do cardápio</p>
        <MenuPreview name={name} branding={b} images={images} />
      </div>
    </div>
  );
}

function Choice({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-2">{children}</div>
    </fieldset>
  );
}

function Option({
  name,
  value,
  checked,
  onChange,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  children: ReactNode;
}) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition has-focus-visible:outline-2 has-focus-visible:outline-ring ${
        checked ? "border-text bg-surface-2 font-medium" : "border-border-strong hover:bg-surface-2"
      }`}
    >
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} className="sr-only" />
      {children}
    </label>
  );
}

function ColorField({
  id,
  label,
  hint,
  value,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [text, setText] = useState(value);
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} (seletor)`}
          value={value}
          onChange={(e) => {
            onChange(e.target.value.toUpperCase());
            setText(e.target.value.toUpperCase());
          }}
          className="h-10 w-12 cursor-pointer rounded-lg border border-border-strong bg-surface p-1"
        />
        <Input
          id={id}
          name={id}
          value={text}
          maxLength={7}
          pattern="#[0-9A-Fa-f]{6}"
          onChange={(e) => {
            setText(e.target.value);
            if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) onChange(e.target.value.toUpperCase());
          }}
          className="font-mono uppercase"
        />
      </div>
    </Field>
  );
}

/** Miniatura do cardápio público usando os tokens do estabelecimento. */
function MenuPreview({ name, branding, images }: { name: string; branding: Branding; images: Images }) {
  const cover = imageUrl(images.cover_path);
  const logo = imageUrl(images.logo_path);
  const radius = "var(--radius)";
  const items = [
    { name: "Pastel de carne", desc: "Massa crocante, carne temperada", price: "R$ 12,00", tag: "Mais pedido" },
    { name: "Caldo de cana", desc: "Copo de 500 ml", price: "R$ 8,00" },
  ];

  return (
    <div
      data-theme={branding.theme}
      style={brandStyle(branding)}
      className="overflow-hidden rounded-2xl border border-border bg-bg text-text shadow-card"
    >
      <div
        className="relative bg-brand bg-cover bg-center px-4 pt-10 pb-4 text-brand-contrast"
        style={cover ? { backgroundImage: `linear-gradient(to top, rgb(0 0 0 / 0.65), transparent), url(${cover})`, color: "#fff" } : undefined}
      >
        <div className="flex items-center gap-3">
          {logo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="" className="size-12 rounded-full border-2 border-white/80 bg-surface object-cover" />
          )}
          <div>
            <p className="text-xs opacity-80">Mesa 04</p>
            <p className="text-lg font-semibold">{name || "Seu estabelecimento"}</p>
          </div>
        </div>
      </div>
      <div className="flex gap-2 overflow-hidden px-4 py-3 text-xs">
        {["Pastéis", "Bebidas", "Doces"].map((c, i) => (
          <span
            key={c}
            style={{ borderRadius: radius }}
            className={`px-3 py-1.5 font-medium ${i === 0 ? "bg-text text-bg" : "bg-surface-2 text-muted"}`}
          >
            {c}
          </span>
        ))}
      </div>
      <div className="flex flex-col gap-2 px-4 pb-4">
        {items.map((item) => (
          <div
            key={item.name}
            style={{ borderRadius: radius }}
            className="flex items-start justify-between gap-3 border border-border bg-surface p-3"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">{item.name}</p>
              <p className="text-xs text-muted">{item.desc}</p>
              <p className="mt-1 text-sm font-semibold">{item.price}</p>
            </div>
            {item.tag && (
              <span
                style={{ borderRadius: radius }}
                className="shrink-0 bg-accent px-2 py-0.5 text-[10px] font-semibold text-accent-contrast"
              >
                {item.tag}
              </span>
            )}
          </div>
        ))}
        <button
          type="button"
          tabIndex={-1}
          style={{ borderRadius: radius }}
          className="mt-1 h-10 bg-brand text-sm font-semibold text-brand-contrast"
        >
          Ver carrinho · R$ 20,00
        </button>
      </div>
    </div>
  );
}
