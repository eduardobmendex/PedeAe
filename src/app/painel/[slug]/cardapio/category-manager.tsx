"use client";

import { useActionState, useRef } from "react";
import { Button, Card, FormMessage, Input } from "@/components/ui";
import { createCategory, deleteCategory, moveCategory, updateCategory } from "./actions";

type Category = { id: string; name: string; active: boolean };

export function CategoryManager({ slug, categories }: { slug: string; categories: Category[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(async (prev: Awaited<ReturnType<typeof createCategory>>, fd: FormData) => {
    const result = await createCategory(slug, prev, fd);
    if (result?.success) formRef.current?.reset();
    return result;
  }, undefined);

  return (
    <Card className="flex flex-col gap-4 lg:sticky lg:top-8">
      <h2 className="font-semibold">Categorias</h2>

      {categories.length > 0 && (
        <ul className="flex flex-col gap-1">
          {categories.map((c, i) => (
            <CategoryRow key={c.id} slug={slug} category={c} first={i === 0} last={i === categories.length - 1} />
          ))}
        </ul>
      )}

      <form ref={formRef} action={action} className="flex flex-col gap-2 border-t border-border pt-4">
        <label htmlFor="new-category" className="text-sm font-medium">
          Nova categoria
        </label>
        <div className="flex gap-2">
          <Input id="new-category" name="name" placeholder="Ex.: Bebidas" required maxLength={80} />
          <Button type="submit" disabled={pending}>
            Criar
          </Button>
        </div>
        <FormMessage state={state?.error ? state : undefined} />
      </form>
    </Card>
  );
}

function CategoryRow({ slug, category, first, last }: { slug: string; category: Category; first: boolean; last: boolean }) {
  const [saveState, save, saving] = useActionState(updateCategory.bind(null, slug, category.id), undefined);
  const [deleteState, remove, deleting] = useActionState(deleteCategory.bind(null, slug, category.id), undefined);

  return (
    <li className="group rounded-lg">
      <details>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-hover">
          <span className={category.active ? "" : "text-muted line-through"}>{category.name}</span>
          <span className="flex items-center gap-0.5">
            <MoveButton slug={slug} id={category.id} direction="up" disabled={first} />
            <MoveButton slug={slug} id={category.id} direction="down" disabled={last} />
          </span>
        </summary>
        <div className="flex flex-col gap-2 px-2 pt-1 pb-3">
          <form action={save} className="flex flex-col gap-2">
            <Input name="name" defaultValue={category.name} required maxLength={80} aria-label="Nome da categoria" />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="active" defaultChecked={category.active} className="size-4" />
              Visível no cardápio
            </label>
            <div className="flex gap-2">
              <Button type="submit" variant="secondary" disabled={saving} className="h-8 flex-1">
                Salvar
              </Button>
              <Button type="submit" formAction={remove} variant="danger" disabled={deleting} className="h-8">
                Excluir
              </Button>
            </div>
          </form>
          <FormMessage state={deleteState?.error ? deleteState : saveState} />
        </div>
      </details>
    </li>
  );
}

function MoveButton({ slug, id, direction, disabled }: { slug: string; id: string; direction: "up" | "down"; disabled: boolean }) {
  return (
    <form action={moveCategory.bind(null, slug, id, direction)} onClick={(e) => e.stopPropagation()}>
      <button
        type="submit"
        disabled={disabled}
        aria-label={direction === "up" ? "Mover para cima" : "Mover para baixo"}
        className="rounded px-1.5 text-muted hover:bg-surface hover:text-text disabled:invisible"
      >
        {direction === "up" ? "↑" : "↓"}
      </button>
    </form>
  );
}
