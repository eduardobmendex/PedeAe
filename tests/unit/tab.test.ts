import { describe, expect, it } from "vitest";
import { cashPayment, computeTab, splitEvenly } from "@/lib/tab";

describe("conta da mesa", () => {
  it("soma pedidos, aplica taxa de serviço e calcula restante e troco", () => {
    expect(computeTab([3000, 2000], [3000], 10)).toEqual({
      subtotalCents: 5000,
      serviceFeeCents: 500,
      totalCents: 5500,
      paidCents: 3000,
      remainingCents: 2500,
      overpaidCents: 0,
    });
    expect(computeTab([5000], [6000], 10)).toMatchObject({ remainingCents: 0, overpaidCents: 500 });
    expect(computeTab([3333], [], 10).serviceFeeCents).toBe(333);
    expect(computeTab([], [], 10).totalCents).toBe(0);
  });

  it("divide por pessoa sem perder centavos", () => {
    expect(splitEvenly(10000, 3)).toEqual([3334, 3333, 3333]);
    expect(splitEvenly(10000, 3).reduce((a, b) => a + b, 0)).toBe(10000);
    expect(splitEvenly(5500, 1)).toEqual([5500]);
    expect(splitEvenly(100, 0)).toEqual([100]); // mínimo 1 pessoa
  });

  it("dinheiro: registra só o que falta e devolve o troco", () => {
    expect(cashPayment(10000, 8550)).toEqual({ appliedCents: 8550, changeCents: 1450 });
    expect(cashPayment(5000, 8550)).toEqual({ appliedCents: 5000, changeCents: 0 });
  });
});
