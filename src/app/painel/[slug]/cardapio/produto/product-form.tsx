"use client";

import { useActionState, useState } from "react";
import { Button, Card, Field, FormMessage, Input, Select, Textarea } from "@/components/ui";
import { centsToInput, parseBRL } from "@/lib/money";
import { ImageUpload } from "@/components/image-upload";
import { deleteProduct, saveProduct } from "../actions";

export type OptionGroupInput = {
  name: string;
  min_select: number;
  max_select: number;
  items: { name: string; price_delta_cents: number; available: boolean }[];
};

export type ProductInput = {
  id: string | null;
  name: string;
  description: string;
  category_id: string;
  price_cents: number | null;
  available: boolean;
  featured: boolean;
  image_path: string | null;
  options: OptionGroupInput[];
};

export function ProductForm({
  slug,
  organizationId,
  categories,
  product,
}: {
  slug: string;
  organizationId: string;
  categories: { id: string; name: string }[];
  product: ProductInput;
}) {
  const [state, action, pending] = useActionState(saveProduct.bind(null, slug, product.id), undefined);
  const [imagePath, setImagePath] = useState(product.image_path);
  const [options, setOptions] = useState<OptionGroupInput[]>(product.options);

  return (
    <form action={action} className="grid items-start gap-6 lg:grid-cols-[1fr_18rem]">
      <div className="flex flex-col gap-6">
        <Card className="flex flex-col gap-4">
          <Field label="Nome" htmlFor="name">
            <Input id="name" name="name" defaultValue={product.name} required maxLength={120} />
          </Field>
          <Field label="Descrição" htmlFor="description" hint="Ingredientes, tamanho, informações úteis.">
            <Textarea id="description" name="description" defaultValue={product.description} maxLength={600} rows={3} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Categoria" htmlFor="category_id">
              <Select id="category_id" name="category_id" defaultValue={product.category_id} required className="w-full">
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Preço (R$)" htmlFor="price">
              <Input
                id="price"
                name="price"
                inputMode="decimal"
                placeholder="0,00"
                defaultValue={product.price_cents === null ? "" : centsToInput(product.price_cents)}
                required
              />
            </Field>
          </div>
        </Card>

        <OptionsEditor options={options} onChange={setOptions} />
        <input type="hidden" name="options" value={JSON.stringify(options)} />
      </div>

      <div className="flex flex-col gap-4 lg:sticky lg:top-8">
        <Card className="flex flex-col gap-4">
          <ImageUpload label="Foto" organizationId={organizationId} folder="products" path={imagePath} onChange={setImagePath} />
          <input type="hidden" name="image_path" value={imagePath ?? ""} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="available" defaultChecked={product.available} className="size-4" />
            Disponível para pedidos
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="featured" defaultChecked={product.featured} className="size-4" />
            Mostrar em destaque
          </label>
        </Card>
        <FormMessage state={state} />
        <Button type="submit" disabled={pending}>
          {pending ? "Salvando…" : "Salvar produto"}
        </Button>
        {product.id && (
          <Button
            type="submit"
            variant="danger"
            formAction={deleteProduct.bind(null, slug, product.id)}
            formNoValidate
            onClick={(e) => {
              if (!window.confirm("Excluir este produto? Pedidos antigos continuam com o histórico.")) e.preventDefault();
            }}
          >
            Excluir produto
          </Button>
        )}
      </div>
    </form>
  );
}

function OptionsEditor({ options, onChange }: { options: OptionGroupInput[]; onChange: (o: OptionGroupInput[]) => void }) {
  const update = (i: number, patch: Partial<OptionGroupInput>) =>
    onChange(options.map((g, gi) => (gi === i ? { ...g, ...patch } : g)));

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="font-semibold">Adicionais e variações</h2>
        <p className="text-sm text-muted">Ex.: Tamanho (escolha 1), Extras (até 3), Ponto da carne.</p>
      </div>

      {options.map((group, gi) => (
        <fieldset key={gi} className="flex flex-col gap-3 rounded-lg border border-border p-4">
          <legend className="sr-only">Grupo {gi + 1}</legend>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Nome do grupo" htmlFor={`g-${gi}-name`}>
              <Input
                id={`g-${gi}-name`}
                value={group.name}
                onChange={(e) => update(gi, { name: e.target.value })}
                placeholder="Ex.: Tamanho"
                required
              />
            </Field>
            <Field label="Mínimo" htmlFor={`g-${gi}-min`}>
              <Input
                id={`g-${gi}-min`}
                type="number"
                min={0}
                value={group.min_select}
                onChange={(e) => update(gi, { min_select: Math.max(0, Number(e.target.value)) })}
                className="w-20"
              />
            </Field>
            <Field label="Máximo" htmlFor={`g-${gi}-max`}>
              <Input
                id={`g-${gi}-max`}
                type="number"
                min={1}
                value={group.max_select}
                onChange={(e) => update(gi, { max_select: Math.max(1, Number(e.target.value)) })}
                className="w-20"
              />
            </Field>
            <Button type="button" variant="ghost" onClick={() => onChange(options.filter((_, i) => i !== gi))}>
              Remover grupo
            </Button>
          </div>
          <p className="text-xs text-muted">
            {group.min_select === 0 ? "Opcional" : `Obrigatório escolher ${group.min_select}`} · até {group.max_select}
          </p>

          <ul className="flex flex-col gap-2">
            {group.items.map((item, ii) => (
              <li key={ii} className="flex flex-wrap items-center gap-2">
                <Input
                  value={item.name}
                  aria-label="Nome do item"
                  placeholder="Ex.: Grande"
                  className="min-w-40 flex-1"
                  required
                  onChange={(e) =>
                    update(gi, { items: group.items.map((it, j) => (j === ii ? { ...it, name: e.target.value } : it)) })
                  }
                />
                <PriceDeltaInput
                  cents={item.price_delta_cents}
                  onChange={(cents) =>
                    update(gi, { items: group.items.map((it, j) => (j === ii ? { ...it, price_delta_cents: cents } : it)) })
                  }
                />
                <label className="flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={item.available}
                    onChange={(e) =>
                      update(gi, {
                        items: group.items.map((it, j) => (j === ii ? { ...it, available: e.target.checked } : it)),
                      })
                    }
                  />
                  Disponível
                </label>
                <button
                  type="button"
                  aria-label="Remover item"
                  className="rounded px-2 text-muted hover:text-danger"
                  onClick={() => update(gi, { items: group.items.filter((_, j) => j !== ii) })}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <Button
            type="button"
            variant="secondary"
            className="self-start"
            onClick={() => update(gi, { items: [...group.items, { name: "", price_delta_cents: 0, available: true }] })}
          >
            + Item
          </Button>
        </fieldset>
      ))}

      <Button
        type="button"
        variant="secondary"
        className="self-start"
        onClick={() =>
          onChange([
            ...options,
            { name: "", min_select: 0, max_select: 1, items: [{ name: "", price_delta_cents: 0, available: true }] },
          ])
        }
      >
        + Grupo de adicionais
      </Button>
    </Card>
  );
}

function PriceDeltaInput({ cents, onChange }: { cents: number; onChange: (cents: number) => void }) {
  const [text, setText] = useState(cents ? centsToInput(cents) : "");
  return (
    <div className="flex items-center gap-1 text-sm">
      <span className="text-muted">+ R$</span>
      <Input
        value={text}
        inputMode="decimal"
        placeholder="0,00"
        aria-label="Acréscimo no preço"
        className="w-24"
        onChange={(e) => {
          setText(e.target.value);
          const parsed = e.target.value.trim() === "" ? 0 : parseBRL(e.target.value);
          if (parsed !== null) onChange(parsed);
        }}
      />
    </div>
  );
}
