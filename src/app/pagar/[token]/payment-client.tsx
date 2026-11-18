"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { useEffect, useState, useTransition } from "react";
import { formatBRL } from "@/lib/money";
import { onlyDigits, payerError, type BillingAddress, type Payer, type PublicIntent } from "@/lib/payments/types";
import { imageUrl } from "@/lib/storage";
import { checkPayment, simulatePaid, startCard, startPix } from "./actions";

const FIELD = "h-11 w-full border border-input-border bg-input px-3 text-base outline-none focus:border-brand";
const radius = { borderRadius: "var(--radius)" };
const PAYER_KEY = "pedeae:payer";

/** Página de pagamento online: Pix (QR / copia e cola) ou cartão de crédito. */
export function PaymentClient({
  token,
  initial,
  logoPath,
  configured,
  simulator,
  publicKey,
}: {
  token: string;
  initial: PublicIntent;
  logoPath: string | null;
  configured: boolean;
  simulator: boolean;
  publicKey: string;
}) {
  const router = useRouter();
  const [intent, setIntent] = useState(initial);
  const [tab, setTab] = useState<"pix" | "card">("pix");
  const [payer, setPayer] = useState<Payer>({ name: "", email: "", document: "", phone: "" });
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const logo = imageUrl(logoPath);

  // Dados do pagador lembrados neste aparelho (só para não digitar de novo).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(PAYER_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved) setPayer((p) => ({ ...p, ...JSON.parse(saved) }));
    } catch {}
  }, []);

  // Enquanto pendente com Pix gerado (ou cartão em análise): verifica a cada 4 s.
  const waiting = intent.status === "pending" && intent.method !== null;
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(async () => {
      const fresh = await checkPayment(token).catch(() => null);
      if (fresh) setIntent(fresh);
    }, 4000);
    return () => clearInterval(id);
  }, [waiting, token]);

  // Pedido antecipado pago: vai para o acompanhamento.
  useEffect(() => {
    if (intent.status === "paid" && intent.order) {
      const id = setTimeout(() => router.push(`/pedido/${intent.order!.public_token}`), 2500);
      return () => clearTimeout(id);
    }
  }, [intent.status, intent.order, router]);

  const what = intent.kind === "order" ? `Pedido #${intent.order?.number ?? ""}` : `Conta · ${intent.table_name ?? "Mesa"}`;

  function remember() {
    try {
      localStorage.setItem(PAYER_KEY, JSON.stringify(payer));
    } catch {}
  }

  function refresh() {
    start(async () => {
      const fresh = await checkPayment(token).catch(() => null);
      if (fresh) setIntent(fresh);
    });
  }

  function payPix() {
    const invalid = payerError(payer);
    if (invalid) return setError(invalid);
    setError(undefined);
    remember();
    start(async () => {
      const r = await startPix(token, payer).catch(() => ({ ok: false as const, error: "Sem conexão." }));
      if (!r.ok) return setError(r.error);
      const fresh = await checkPayment(token);
      if (fresh) setIntent(fresh);
    });
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-5 bg-bg px-4 py-8 text-text">
      <header className="flex items-center gap-3">
        {logo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="" className="size-12 rounded-full border border-border object-cover" />
        )}
        <div className="min-w-0">
          <p className="truncate font-semibold">{intent.organization.name}</p>
          <p className="text-sm text-muted">{what}</p>
        </div>
      </header>

      <section style={{ borderRadius: "calc(var(--radius) * 1.5)" }} className="border border-brand/40 bg-surface p-5 text-center shadow-card">
        <p className="text-sm text-muted">Valor a pagar</p>
        <p className="text-4xl font-bold tabular-nums">{formatBRL(intent.amount_cents)}</p>
      </section>

      {intent.status === "paid" ? (
        <Done intent={intent} />
      ) : intent.status === "expired" || intent.status === "cancelled" ? (
        <Notice tone="warning" title={intent.status === "expired" ? "Este pagamento expirou" : "Pagamento cancelado"}>
          Peça um novo link ao atendente ou gere outro pelo cardápio da mesa.
        </Notice>
      ) : !configured ? (
        <Notice tone="warning" title="Pagamento online indisponível">
          O estabelecimento ainda não está recebendo pagamentos online. Pague com o atendente.
        </Notice>
      ) : intent.method === "pix" && intent.pix_qr_code ? (
        <PixWaiting intent={intent} simulator={simulator} token={token} onPaid={setIntent} onRefresh={refresh} pending={pending} />
      ) : (
        <>
          {intent.status === "failed" && (
            <Notice tone="danger" title="Pagamento não concluído">
              {intent.failure_reason ?? "Tente de novo ou use outra forma de pagamento."}
            </Notice>
          )}
          <PayerFields payer={payer} onChange={setPayer} />

          <div role="tablist" aria-label="Forma de pagamento" className="grid grid-cols-2 gap-2">
            {(["pix", "card"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                style={radius}
                className={`h-11 border font-semibold ${tab === t ? "border-brand bg-brand text-brand-contrast" : "border-border-strong bg-surface"}`}
              >
                {t === "pix" ? "Pix" : "Cartão de crédito"}
              </button>
            ))}
          </div>

          {error && (
            <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}

          {tab === "pix" ? (
            <button type="button" onClick={payPix} disabled={pending} style={radius} className="h-12 bg-brand font-semibold text-brand-contrast disabled:opacity-60">
              {pending ? "Gerando Pix…" : "Gerar Pix"}
            </button>
          ) : (
            <CardForm
              token={token}
              payer={payer}
              publicKey={publicKey}
              simulator={simulator}
              onError={setError}
              onDone={(fresh) => {
                remember();
                setIntent(fresh);
              }}
            />
          )}
          <p className="text-center text-xs text-muted">Pagamento processado com segurança pelo Pagar.me. O PedeAe não armazena dados do cartão.</p>
        </>
      )}
    </main>
  );
}

function PayerFields({ payer, onChange }: { payer: Payer; onChange: (p: Payer) => void }) {
  const set = (k: keyof Payer) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...payer, [k]: e.target.value });
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-sm font-semibold">Seus dados</legend>
      <input aria-label="Nome completo" placeholder="Nome completo" autoComplete="name" value={payer.name} onChange={set("name")} style={radius} className={FIELD} />
      <input aria-label="E-mail" placeholder="E-mail" type="email" autoComplete="email" value={payer.email} onChange={set("email")} style={radius} className={FIELD} />
      <div className="grid grid-cols-2 gap-3">
        <input aria-label="CPF" placeholder="CPF" inputMode="numeric" value={payer.document} onChange={set("document")} style={radius} className={FIELD} />
        <input aria-label="Celular com DDD" placeholder="Celular com DDD" inputMode="tel" autoComplete="tel" value={payer.phone} onChange={set("phone")} style={radius} className={FIELD} />
      </div>
    </fieldset>
  );
}

function PixWaiting({
  intent,
  simulator,
  token,
  onPaid,
  onRefresh,
  pending,
}: {
  intent: PublicIntent;
  simulator: boolean;
  token: string;
  onPaid: (i: PublicIntent) => void;
  onRefresh: () => void;
  pending: boolean;
}) {
  const [qr, setQr] = useState<string | null>(intent.pix_qr_code_url);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (intent.pix_qr_code_url || !intent.pix_qr_code) return;
    QRCode.toDataURL(intent.pix_qr_code, { margin: 1, width: 240 }).then(setQr, () => {});
  }, [intent.pix_qr_code, intent.pix_qr_code_url]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const left = intent.pix_expires_at ? Math.max(0, Math.floor((new Date(intent.pix_expires_at).getTime() - now) / 1000)) : null;

  return (
    <section className="flex flex-col items-center gap-4 text-center">
      <p className="font-semibold">Pague com Pix no app do seu banco</p>
      {qr && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={qr} alt="QR Code do Pix" className="size-60 rounded-lg bg-white p-2" />
      )}
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(intent.pix_qr_code ?? "").catch(() => {});
          setCopied(true);
          setTimeout(() => setCopied(false), 2500);
        }}
        style={radius}
        className="h-12 w-full bg-brand font-semibold text-brand-contrast"
      >
        {copied ? "Código copiado!" : "Copiar código Pix (copia e cola)"}
      </button>
      <p className="text-sm text-muted" aria-live="polite">
        Aguardando o pagamento… {left !== null && left > 0 && `O código vale por mais ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}.`}
      </p>
      <button type="button" onClick={onRefresh} disabled={pending} className="text-sm font-medium text-brand-text underline">
        Já paguei
      </button>
      {simulator && (
        <button
          type="button"
          onClick={async () => {
            if (await simulatePaid(token)) {
              const fresh = await checkPayment(token);
              if (fresh) onPaid(fresh);
            }
          }}
          className="rounded-lg border border-dashed border-warning px-3 py-2 text-sm font-semibold text-warning"
        >
          Simular pagamento (modo de teste)
        </button>
      )}
    </section>
  );
}

function CardForm({
  token,
  payer,
  publicKey,
  simulator,
  onError,
  onDone,
}: {
  token: string;
  payer: Payer;
  publicKey: string;
  simulator: boolean;
  onError: (e?: string) => void;
  onDone: (i: PublicIntent) => void;
}) {
  const [card, setCard] = useState({ number: "", holder: "", exp: "", cvv: "" });
  const [billing, setBilling] = useState<BillingAddress>({ zipCode: "", street: "", number: "", neighborhood: "", city: "", state: "" });
  const [pending, start] = useTransition();
  const c = (k: keyof typeof card) => (e: React.ChangeEvent<HTMLInputElement>) => setCard({ ...card, [k]: e.target.value });
  const b = (k: keyof BillingAddress) => (e: React.ChangeEvent<HTMLInputElement>) => setBilling({ ...billing, [k]: e.target.value });

  // CEP → endereço (ViaCEP), para digitar menos.
  async function lookupZip(zip: string) {
    const d = onlyDigits(zip);
    if (d.length !== 8) return;
    try {
      const r = await fetch(`https://viacep.com.br/ws/${d}/json/`).then((x) => x.json());
      if (!r.erro) setBilling((v) => ({ ...v, street: r.logradouro || v.street, neighborhood: r.bairro || v.neighborhood, city: r.localidade || v.city, state: r.uf || v.state }));
    } catch {}
  }

  function pay() {
    const invalid = payerError(payer);
    if (invalid) return onError(invalid);
    const [mm, yy] = card.exp.split("/").map((s) => s.trim());
    if (onlyDigits(card.number).length < 13 || !mm || !yy || onlyDigits(card.cvv).length < 3 || card.holder.trim().length < 3)
      return onError("Confira os dados do cartão.");
    onError(undefined);
    start(async () => {
      let cardToken: string;
      try {
        cardToken = await tokenize(publicKey, simulator, { number: onlyDigits(card.number), holder_name: card.holder.trim(), exp_month: Number(mm), exp_year: Number(yy), cvv: onlyDigits(card.cvv) });
      } catch (e) {
        return onError(e instanceof Error ? e.message : "Cartão recusado.");
      }
      const r = await startCard(token, payer, cardToken, billing).catch(() => ({ ok: false as const, error: "Sem conexão." }));
      const fresh = await checkPayment(token);
      if (fresh) onDone(fresh);
      if (!r.ok) onError(r.error);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <input aria-label="Número do cartão" placeholder="Número do cartão" inputMode="numeric" autoComplete="cc-number" value={card.number} onChange={c("number")} style={radius} className={FIELD} />
      <input aria-label="Nome impresso no cartão" placeholder="Nome impresso no cartão" autoComplete="cc-name" value={card.holder} onChange={c("holder")} style={radius} className={FIELD} />
      <div className="grid grid-cols-2 gap-3">
        <input aria-label="Validade (MM/AA)" placeholder="Validade MM/AA" autoComplete="cc-exp" value={card.exp} onChange={c("exp")} style={radius} className={FIELD} />
        <input aria-label="CVV" placeholder="CVV" inputMode="numeric" autoComplete="cc-csc" value={card.cvv} onChange={c("cvv")} style={radius} className={FIELD} />
      </div>
      <p className="mt-1 text-sm font-semibold">Endereço de cobrança do cartão</p>
      <input
        aria-label="CEP"
        placeholder="CEP"
        inputMode="numeric"
        autoComplete="postal-code"
        value={billing.zipCode}
        onChange={b("zipCode")}
        onBlur={(e) => lookupZip(e.target.value)}
        style={radius}
        className={FIELD}
      />
      <div className="grid grid-cols-[1fr_6rem] gap-3">
        <input aria-label="Rua" placeholder="Rua" autoComplete="address-line1" value={billing.street} onChange={b("street")} style={radius} className={FIELD} />
        <input aria-label="Número" placeholder="Nº" value={billing.number} onChange={b("number")} style={radius} className={FIELD} />
      </div>
      <input aria-label="Bairro" placeholder="Bairro" value={billing.neighborhood} onChange={b("neighborhood")} style={radius} className={FIELD} />
      <div className="grid grid-cols-[1fr_5rem] gap-3">
        <input aria-label="Cidade" placeholder="Cidade" autoComplete="address-level2" value={billing.city} onChange={b("city")} style={radius} className={FIELD} />
        <input aria-label="UF" placeholder="UF" maxLength={2} value={billing.state} onChange={b("state")} style={radius} className={`${FIELD} uppercase`} />
      </div>
      <button type="button" onClick={pay} disabled={pending} style={radius} className="h-12 bg-brand font-semibold text-brand-contrast disabled:opacity-60">
        {pending ? "Processando…" : "Pagar com cartão"}
      </button>
    </div>
  );
}

/**
 * Tokeniza o cartão direto no Pagar.me (chave pública): os dados do cartão vão do navegador para
 * o Pagar.me e o PedeAe só recebe um token de uso único. No simulador, o final 0002 recusa.
 */
async function tokenize(publicKey: string, simulator: boolean, card: { number: string; holder_name: string; exp_month: number; exp_year: number; cvv: string }) {
  if (!publicKey) {
    if (simulator) return card.number.endsWith("0002") ? "tok_recusar" : "tok_simulado";
    throw new Error("Pagamento com cartão indisponível.");
  }
  const res = await fetch(`https://api.pagar.me/core/v5/tokens?appId=${encodeURIComponent(publicKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "card", card }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.id) throw new Error("Cartão inválido. Confira os dados.");
  return data.id as string;
}

function Done({ intent }: { intent: PublicIntent }) {
  return (
    <section className="flex flex-col items-center gap-3 rounded-xl bg-success-soft p-6 text-center text-success">
      <span aria-hidden className="text-4xl">✓</span>
      <p className="text-lg font-bold">Pagamento confirmado!</p>
      {intent.order ? (
        <>
          <p className="text-sm">Seu pedido #{intent.order.number} foi enviado para o preparo.</p>
          <Link href={`/pedido/${intent.order.public_token}`} className="font-semibold underline">
            Acompanhar pedido
          </Link>
        </>
      ) : (
        <p className="text-sm">O valor já aparece na conta da {intent.table_name ?? "mesa"}. Obrigado!</p>
      )}
    </section>
  );
}

function Notice({ tone, title, children }: { tone: "warning" | "danger"; title: string; children: React.ReactNode }) {
  return (
    <section className={`rounded-xl p-4 text-sm ${tone === "danger" ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning"}`}>
      <p className="font-semibold">{title}</p>
      <p className="mt-1">{children}</p>
    </section>
  );
}
