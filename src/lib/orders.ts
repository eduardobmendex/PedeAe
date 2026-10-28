import { z } from "zod";

export const orderStatuses = [
  "pending_confirmation",
  "received",
  "preparing",
  "ready",
  "delivered",
  "rejected",
  "cancelled",
] as const;
export type OrderStatus = (typeof orderStatuses)[number];

export const orderStatusLabels: Record<OrderStatus, string> = {
  pending_confirmation: "Aguardando confirmação",
  received: "Recebido",
  preparing: "Em preparo",
  ready: "Pronto",
  delivered: "Entregue",
  rejected: "Recusado",
  cancelled: "Cancelado",
};

export const orderStatusTone: Record<OrderStatus, "neutral" | "info" | "warning" | "success" | "danger" | "brand"> = {
  pending_confirmation: "warning",
  received: "info",
  preparing: "warning",
  ready: "success",
  delivered: "neutral",
  rejected: "danger",
  cancelled: "danger",
};

/** Espelho de private.order_transition_allowed (o banco é quem valida). */
export const nextStatuses: Record<OrderStatus, OrderStatus[]> = {
  pending_confirmation: ["received", "rejected"],
  received: ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["delivered", "cancelled"],
  delivered: [],
  rejected: [],
  cancelled: [],
};

export const actionLabels: Partial<Record<OrderStatus, string>> = {
  received: "Aceitar",
  preparing: "Iniciar preparo",
  ready: "Marcar pronto",
  delivered: "Entregue",
  rejected: "Recusar",
  cancelled: "Cancelar",
};

export const activeStatuses: OrderStatus[] = ["pending_confirmation", "received", "preparing", "ready"];
export const isFinal = (s: OrderStatus) => nextStatuses[s].length === 0;

// Payload enviado ao servidor: só ids, quantidades e observações. Nunca preços.
export const orderItemsSchema = z
  .array(
    z.object({
      product_id: z.string().uuid(),
      quantity: z.number().int().min(1).max(50),
      notes: z.string().max(140).optional(),
      options: z.array(z.object({ option_id: z.string().uuid(), item_ids: z.array(z.string().uuid()).max(50) })).max(20),
    }),
  )
  .min(1, "Seu carrinho está vazio")
  .max(50, "Pedido com itens demais");

export const orderPayloadSchema = z.object({
  items: orderItemsSchema,
  customerName: z.string().trim().max(60),
  notes: z.string().trim().max(280),
  idempotencyKey: z.string().uuid(),
});
export type OrderPayload = z.infer<typeof orderPayloadSchema>;

export type PlaceOrderResult =
  | { ok: true; publicToken: string; orderNumber: number }
  | { ok: false; error: string; retryable?: boolean };

/** Mensagens para os erros de negócio do banco. */
export function orderErrorMessage(message: string): { error: string; retryable?: boolean } {
  if (message.includes("product_unavailable"))
    return { error: "Um dos produtos acabou de ficar indisponível. Revise o carrinho." };
  if (message.includes("option_unavailable") || message.includes("invalid_options"))
    return { error: "Algum adicional mudou ou ficou indisponível. Remova o item e adicione de novo." };
  if (message.includes("table_invalid")) return { error: "Este QR Code não está mais ativo. Chame um atendente." };
  if (message.includes("rate_limited")) return { error: "Muitos pedidos em pouco tempo. Aguarde alguns minutos." };
  if (message.includes("forbidden")) return { error: "Você não tem permissão para esta ação." };
  if (message.includes("invalid_transition")) return { error: "Este pedido já mudou de status. Atualize a tela." };
  return { error: "Não foi possível enviar o pedido. Tente novamente.", retryable: true };
}
