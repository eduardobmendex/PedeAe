"use client";

import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui";
import type { KycLink } from "@/lib/payments/recipients";
import { createKycLink } from "./actions";

type Link = KycLink & { qr: string };

/**
 * "Compartilhar KYC": gera o link de prova de vida do Pagar.me (vale ~20 min) e abre as
 * opções de envio: QR para mostrar, copiar, WhatsApp ou o compartilhamento do aparelho.
 */
export function ShareKycButton({
  slug,
  orgName,
  label = "Compartilhar KYC",
  variant = "secondary",
  className = "",
}: {
  slug: string;
  orgName: string;
  label?: string;
  variant?: "primary" | "secondary" | "ghost";
  className?: string;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [link, setLink] = useState<Link | null>(null);
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  function generate() {
    setError(undefined);
    if (!dialog.current?.open) dialog.current?.showModal();
    start(async () => {
      const r = await createKycLink(slug).catch(() => ({ error: "Sem conexão com o servidor.", link: undefined }));
      if (!r.link) {
        setLink(null);
        setError(r.error);
        return;
      }
      const qr = r.link.qrBase64 ?? (await QRCode.toDataURL(r.link.url, { margin: 1, width: 240 }));
      setLink({ ...r.link, qr });
      router.refresh();
    });
  }

  const message = link
    ? `Olá! Para liberar os pagamentos online do ${orgName} na PedeAe, o Pagar.me precisa confirmar seus dados (KYC). Abra este link no celular e siga os passos (documento com foto e selfie): ${link.url}${
        link.expiresAt ? ` — o link vale até ${new Date(link.expiresAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.` : ""
      }`
    : "";

  return (
    <>
      <Button type="button" variant={variant} className={className} onClick={generate} disabled={pending}>
        {label}
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby={`kyc-title-${slug}`}
        className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-2xl border border-border bg-surface p-0 text-text shadow-card backdrop:bg-black/50"
        onClose={() => setCopied(false)}
      >
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id={`kyc-title-${slug}`} className="font-semibold">
                Link de KYC · {orgName}
              </h2>
              <p className="text-sm text-muted">Envie ao responsável do estabelecimento. Ele abre no celular e faz a prova de vida no Pagar.me.</p>
            </div>
            <button type="button" onClick={() => dialog.current?.close()} className="rounded-lg px-2 py-1 text-sm text-muted hover:bg-hover" aria-label="Fechar">
              ✕
            </button>
          </div>

          {pending && <p className="py-8 text-center text-sm text-muted">Pedindo o link ao Pagar.me…</p>}
          {!pending && error && (
            <div className="flex flex-col gap-3">
              <p role="alert" className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
                {error}
              </p>
              <Button type="button" variant="secondary" onClick={generate}>
                Tentar de novo
              </Button>
            </div>
          )}
          {!pending && link && (
            <div className="flex flex-col items-center gap-3 text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={link.qr} alt="QR Code do link de KYC" className="size-48 rounded-lg bg-white p-2" />
              <Expiry expiresAt={link.expiresAt} />
              <input readOnly value={link.url} aria-label="Link de KYC" onFocus={(e) => e.currentTarget.select()} className="h-10 w-full rounded-lg border border-input-border bg-input px-3 text-sm" />
              <div className="grid w-full grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={async () => {
                    await navigator.clipboard.writeText(link.url).catch(() => {});
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                >
                  {copied ? "Copiado!" : "Copiar link"}
                </Button>
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(message)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-10 items-center justify-center rounded-lg bg-success px-3 text-sm font-medium text-white hover:opacity-90"
                >
                  WhatsApp
                </a>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={async () => {
                    if (navigator.share) await navigator.share({ title: "KYC Pagar.me", text: message }).catch(() => {});
                    else {
                      await navigator.clipboard.writeText(message).catch(() => {});
                      setCopied(true);
                    }
                  }}
                >
                  Compartilhar…
                </Button>
                <Button type="button" variant="ghost" onClick={generate}>
                  Gerar novo link
                </Button>
              </div>
            </div>
          )}
        </div>
      </dialog>
    </>
  );
}

/** Contagem regressiva do link (o Pagar.me invalida em ~20 min). */
function Expiry({ expiresAt }: { expiresAt: string | null }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);
  if (!expiresAt) return <p className="text-xs text-muted">O link expira em cerca de 20 minutos.</p>;
  const end = new Date(expiresAt).getTime();
  if (now === null) return <p className="text-xs text-muted">Calculando validade…</p>;
  const left = Math.max(0, Math.floor((end - now) / 1000));
  if (left === 0) return <p className="text-sm font-medium text-danger">Link expirado. Gere um novo.</p>;
  return (
    <p className="text-sm text-muted">
      Vale por mais{" "}
      <span className="font-medium tabular-nums text-text">
        {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
      </span>{" "}
      (até {new Date(end).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })})
    </p>
  );
}
