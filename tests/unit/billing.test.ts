import { describe, expect, it } from "vitest";
import { billingStatus, monthlyRecurringRevenue, previousMonth, type Billing } from "@/lib/billing";

const paid: Billing = { plan: "profissional", monthly_price_cents: 19900, due_day: 10, trial_ends_at: null };
const created = "2026-01-15T12:00:00Z";

describe("situação da assinatura", () => {
  it("teste: em teste até a data, depois encerrado", () => {
    const trial: Billing = { ...paid, plan: "trial", trial_ends_at: "2026-03-20" };
    expect(billingStatus(trial, [], "2026-03-20", created)).toMatchObject({ key: "teste", label: "Em teste até 20/03" });
    expect(billingStatus(trial, [], "2026-03-21", created).key).toBe("teste_encerrado");
  });

  it("antes do vencimento, a cobrança em aberto é a do mês anterior", () => {
    expect(billingStatus(paid, ["2026-02-01"], "2026-03-09", created)).toMatchObject({ key: "em_dia", dueMonth: "2026-02-01" });
    expect(billingStatus(paid, ["2026-02-01"], "2026-03-10", created)).toMatchObject({ key: "em_atraso", label: "Em atraso (03/2026)" });
    expect(billingStatus(paid, ["2026-02-01", "2026-03-01"], "2026-03-10", created).key).toBe("em_dia");
  });

  it("meses antes da criação do estabelecimento não contam", () => {
    expect(billingStatus(paid, [], "2026-01-20", created).key).toBe("em_atraso");
    expect(billingStatus(paid, [], "2026-01-05", created).key).toBe("em_dia");
  });

  it("isento nunca atrasa; virada de ano no mês anterior", () => {
    expect(billingStatus({ ...paid, plan: "isento" }, [], "2026-05-30", created).key).toBe("isento");
    expect(previousMonth("2026-01-01")).toBe("2025-12-01");
  });

  it("receita recorrente soma só planos pagos de estabelecimentos ativos", () => {
    expect(
      monthlyRecurringRevenue([
        { status: "active", billing: paid },
        { status: "active", billing: { ...paid, plan: "basico", monthly_price_cents: 9900 } },
        { status: "suspended", billing: paid },
        { status: "active", billing: { ...paid, plan: "trial" } },
        { status: "active", billing: null },
      ]),
    ).toBe(29800);
  });
});
