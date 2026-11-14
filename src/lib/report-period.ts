// Períodos dos relatórios. Datas são "YYYY-MM-DD" no fuso do estabelecimento (America/Bahia).

export const BUSINESS_TIME_ZONE = "America/Bahia";

export const periodPresets = {
  hoje: "Hoje",
  ontem: "Ontem",
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  mes: "Este mês",
  "mes-anterior": "Mês anterior",
} as const;
export type PeriodPreset = keyof typeof periodPresets;
export type Period = { key: PeriodPreset | "personalizado"; from: string; to: string; label: string };

/** Período máximo aceito (o banco também limita). */
export const MAX_PERIOD_DAYS = 366;

export function businessToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIME_ZONE }).format(now);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const toUtc = (d: string) => new Date(`${d}T00:00:00Z`);
const fromUtc = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(day: string, n: number) {
  const d = toUtc(day);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUtc(d);
}

export function daysBetween(from: string, to: string) {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000);
}

const isDate = (v: unknown): v is string => typeof v === "string" && DATE.test(v) && !Number.isNaN(toUtc(v).getTime());

export function presetRange(key: PeriodPreset, today: string): { from: string; to: string } {
  switch (key) {
    case "hoje":
      return { from: today, to: today };
    case "ontem":
      return { from: addDays(today, -1), to: addDays(today, -1) };
    case "7d":
      return { from: addDays(today, -6), to: today };
    case "30d":
      return { from: addDays(today, -29), to: today };
    case "mes":
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case "mes-anterior": {
      const firstThis = toUtc(`${today.slice(0, 7)}-01`);
      const lastPrev = new Date(firstThis);
      lastPrev.setUTCDate(0);
      return { from: `${fromUtc(lastPrev).slice(0, 7)}-01`, to: fromUtc(lastPrev) };
    }
  }
}

const short = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

/** Lê ?periodo=…&de=…&ate=… e devolve um período válido (padrão: últimos 7 dias). */
export function resolvePeriod(params: Record<string, string | string[] | undefined>, today = businessToday()): Period {
  const key = params.periodo;
  if (key === "personalizado" && isDate(params.de) && isDate(params.ate)) {
    let [from, to] = [params.de, params.ate];
    if (to < from) [from, to] = [to, from];
    if (to > today) to = today;
    if (daysBetween(from, to) > MAX_PERIOD_DAYS) from = addDays(to, -MAX_PERIOD_DAYS);
    return { key: "personalizado", from, to, label: from === to ? short(from) : `${short(from)} a ${short(to)}` };
  }
  const preset: PeriodPreset = typeof key === "string" && key in periodPresets ? (key as PeriodPreset) : "7d";
  return { key: preset, ...presetRange(preset, today), label: periodPresets[preset] };
}
