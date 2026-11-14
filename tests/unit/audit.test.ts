import { describe, expect, it } from "vitest";
import { categoryOf, describeAudit, type AuditEntry } from "@/lib/audit";
import { formatBRL } from "@/lib/money";

const entry = (action: string, metadata: Record<string, unknown>): AuditEntry => ({
  id: 1,
  action,
  entity_type: action.split(".")[0],
  entity_id: "x",
  metadata,
  created_at: "2026-11-14T12:00:00Z",
  actor_user_id: null,
});

describe("auditoria legível", () => {
  it("alteração de produto mostra o nome e o antes/depois formatado", () => {
    const d = describeAudit(entry("products.update", { price_cents: { from: 1800, to: 2000 }, available: { from: true, to: false } }), "X-Salada");
    expect(d.title).toBe("Alterou o produto X-Salada");
    expect(d.details).toEqual([`Preço: ${formatBRL(1800)} → ${formatBRL(2000)}`, "Disponível: sim → não"]);
  });

  it("campos internos de settings viram linhas próprias; técnicos somem", () => {
    const d = describeAudit(
      entry("settings.updated", {
        theme: { from: "white", to: "dark" },
        settings: { from: { wallpaper: "food", x: 1 }, to: { wallpaper: "bar", x: 1 } },
        updated_at: { from: "a", to: "b" },
      }),
    );
    expect(d.details).toEqual(["Identidade visual: WHITE → DARK", "Papel de parede: food → bar"]);
  });

  it("produto excluído usa o nome guardado no registro", () => {
    expect(describeAudit(entry("products.delete", { name: "Pastel" })).title).toBe("Excluiu o produto Pastel");
  });

  it("cancelamento de pedido traz número, situação anterior e motivo", () => {
    const d = describeAudit(entry("order.cancelled", { order_number: 42, from: "preparing", note: "cliente desistiu" }));
    expect(d.title).toBe("Cancelou o pedido #42");
    expect(d.details).toEqual(["Situação anterior: Em preparo", "Motivo: cliente desistiu"]);
  });

  it("mesa não repete a palavra", () => {
    expect(describeAudit(entry("tables.insert", {}), "Mesa 3").title).toBe("Criou a Mesa 3");
    expect(describeAudit(entry("tables.insert", {}), "Varanda").title).toBe("Criou a mesa Varanda");
  });

  it("categorias de filtro", () => {
    expect(categoryOf("products.update")).toBe("cardapio");
    expect(categoryOf("table_qr.rotated")).toBe("mesas");
    expect(categoryOf("billing.updated")).toBe("assinatura");
    expect(categoryOf("xyz")).toBeNull();
  });
});
