"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { IMAGE_TYPES, MAX_IMAGE_BYTES, MENU_BUCKET, imageUrl } from "@/lib/storage";
import { createClient } from "@/lib/supabase/client";

/**
 * Envia a imagem direto para o Storage (RLS valida a permissão pela pasta
 * <organization_id>/) e devolve o caminho para o formulário salvar.
 */
export function ImageUpload({
  label,
  organizationId,
  folder,
  path,
  onChange,
  aspect = "aspect-[4/3]",
}: {
  label: string;
  organizationId: string;
  folder: string;
  path: string | null;
  onChange: (path: string | null) => void;
  aspect?: string;
}) {
  const [error, setError] = useState<string>();
  const [uploading, setUploading] = useState(false);
  const url = imageUrl(path);

  async function upload(file: File) {
    setError(undefined);
    if (!IMAGE_TYPES.includes(file.type)) return setError("Use JPG, PNG ou WebP.");
    if (file.size > MAX_IMAGE_BYTES) return setError("A imagem precisa ter até 5 MB.");

    setUploading(true);
    const ext = file.type.split("/")[1].replace("jpeg", "jpg");
    const newPath = `${organizationId}/${folder}/${crypto.randomUUID()}.${ext}`;
    const { error: uploadError } = await createClient()
      .storage.from(MENU_BUCKET)
      .upload(newPath, file, { contentType: file.type, cacheControl: "31536000", upsert: false });
    setUploading(false);
    if (uploadError) return setError("Falha no envio da imagem. Tente novamente.");
    onChange(newPath);
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">{label}</span>
      <div className={`${aspect} overflow-hidden rounded-lg border border-border bg-surface-2`}>
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={label} className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center text-sm text-muted">Sem imagem</div>
        )}
      </div>
      <div className="flex gap-2">
        <label className="flex-1 cursor-pointer rounded-lg border border-border-strong px-3 py-2 text-center text-sm hover:bg-hover has-focus-visible:outline-2 has-focus-visible:outline-ring">
          {uploading ? "Enviando…" : url ? "Trocar" : "Enviar imagem"}
          <input
            type="file"
            accept={IMAGE_TYPES.join(",")}
            className="sr-only"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload(file);
              e.target.value = "";
            }}
          />
        </label>
        {url && (
          <Button type="button" variant="ghost" onClick={() => onChange(null)}>
            Remover
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
