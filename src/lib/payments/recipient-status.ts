// Status do recebedor e do KYC no Pagar.me, em português, para o painel do Admin Geral.
// Fonte: docs.pagar.me (Recebedores; "Adição do fluxo de prova de vida").

type Tone = "neutral" | "success" | "warning" | "danger" | "info";

export const recipientStatuses = {
  registration: { label: "Em cadastro", tone: "info", help: "Recebedor criado. O Pagar.me ainda vai analisar o credenciamento." },
  affiliation: { label: "Em credenciamento", tone: "warning", help: "O Pagar.me está analisando (ou esperando os documentos do KYC)." },
  active: { label: "Aprovado", tone: "success", help: "KYC aprovado: pode receber pagamentos e sacar." },
  refused: { label: "Recusado", tone: "danger", help: "O Pagar.me recusou o credenciamento. Peça o motivo ao suporte do Pagar.me." },
  suspended: { label: "Suspenso", tone: "danger", help: "Não concluiu o KYC no prazo ou ficou com pendências." },
  blocked: { label: "Bloqueado", tone: "danger", help: "Bloqueado pelo Pagar.me por comportamento suspeito." },
  inactive: { label: "Inativo", tone: "danger", help: "Desativado pelo Pagar.me após monitoramento." },
} as const satisfies Record<string, { label: string; tone: Tone; help: string }>;
export type RecipientStatus = keyof typeof recipientStatuses;

export const isRecipientStatus = (v: unknown): v is RecipientStatus => typeof v === "string" && v in recipientStatuses;

/** kyc_details: status + status_reason. */
export function kycInfo(status?: string | null, reason?: string | null): { label: string; tone: Tone; help: string } | null {
  if (!status) return null;
  if (status === "approved") return { label: "KYC aprovado", tone: "success", help: "Credenciamento concluído e aprovado." };
  if (status === "denied") return { label: "KYC negado", tone: "danger", help: "Credenciamento negado. Não há nova tentativa: fale com o suporte do Pagar.me." };
  if (status === "partially_denied")
    return {
      label: "Aguardando documentos",
      tone: "warning",
      help: "O Pagar.me pediu os documentos e a prova de vida. Gere o link de KYC e envie ao responsável do estabelecimento.",
    };
  if (status === "pending") {
    if (reason === "answered_waiting_analysis") return { label: "Documentos enviados", tone: "info", help: "Pendências respondidas; em análise no Pagar.me." };
    if (reason === "waiting_manual_risk_analysis") return { label: "Análise manual", tone: "info", help: "Em análise manual de risco (resposta em até 24 h)." };
    return { label: "KYC em análise", tone: "info", help: "Pedido de credenciamento recebido e em análise." };
  }
  return { label: `KYC: ${status}`, tone: "neutral", help: reason ?? "" };
}

/** O que o Admin Geral precisa fazer agora. */
export function nextStep(recipientId: string | null, status: string | null, kycStatus: string | null): string {
  if (!recipientId) return "Iniciar o KYC: cadastrar o estabelecimento como recebedor no Pagar.me.";
  if (status === "active") return "Nada: pagamentos online liberados (se estiverem ligados).";
  if (kycStatus === "partially_denied") return "Compartilhar o link de KYC com o responsável do estabelecimento.";
  if (status === "refused" || status === "suspended" || status === "blocked" || status === "inactive" || kycStatus === "denied")
    return "Falar com o suporte do Pagar.me.";
  if (!status) return "Consultar o status no Pagar.me.";
  return "Aguardar a análise do Pagar.me.";
}

/** O link de KYC só existe quando o Pagar.me pediu documentos (kyc partially_denied). */
export const canShareKyc = (recipientId: string | null, kycStatus: string | null, status: string | null) =>
  !!recipientId && status !== "active" && kycStatus !== "approved" && kycStatus !== "denied";

/** "18/11 22:40" no fuso do negócio (igual no servidor e no navegador). */
export const dateTimeBR = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Bahia", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
