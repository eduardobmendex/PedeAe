import { describe, expect, it } from "vitest";
import { presetRange, resolvePeriod } from "@/lib/report-period";

const today = "2026-03-15";

describe("períodos dos relatórios", () => {
  it("atalhos calculam o intervalo certo", () => {
    expect(presetRange("hoje", today)).toEqual({ from: today, to: today });
    expect(presetRange("ontem", today)).toEqual({ from: "2026-03-14", to: "2026-03-14" });
    expect(presetRange("7d", today)).toEqual({ from: "2026-03-09", to: today });
    expect(presetRange("30d", today)).toEqual({ from: "2026-02-14", to: today });
    expect(presetRange("mes", today)).toEqual({ from: "2026-03-01", to: today });
    expect(presetRange("mes-anterior", today)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(presetRange("mes-anterior", "2026-01-10")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });

  it("sem parâmetro ou com valor desconhecido usa os últimos 7 dias", () => {
    expect(resolvePeriod({}, today).key).toBe("7d");
    expect(resolvePeriod({ periodo: "xpto" }, today).key).toBe("7d");
  });

  it("personalizado: inverte datas trocadas, não passa de hoje e limita a 366 dias", () => {
    expect(resolvePeriod({ periodo: "personalizado", de: "2026-03-10", ate: "2026-03-01" }, today)).toMatchObject({
      from: "2026-03-01",
      to: "2026-03-10",
      label: "01/03/2026 a 10/03/2026",
    });
    expect(resolvePeriod({ periodo: "personalizado", de: "2026-03-01", ate: "2026-12-31" }, today).to).toBe(today);
    expect(resolvePeriod({ periodo: "personalizado", de: "2020-01-01", ate: today }, today).from).toBe("2025-03-14");
    // Data inválida cai no padrão.
    expect(resolvePeriod({ periodo: "personalizado", de: "2026-13-01", ate: today }, today).key).toBe("7d");
  });
});
