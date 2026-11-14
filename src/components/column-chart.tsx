"use client";

import { useId, useState } from "react";
import { formatBRL } from "@/lib/money";

export type Column = {
  /** Rótulo curto do eixo (ex.: "14/11", "18h"). */
  label: string;
  /** Rótulo completo da dica e da tabela (ex.: "sexta, 14/11"). */
  title: string;
  /** Valor em centavos. */
  value: number;
  /** Linha extra da dica (ex.: "12 pedidos"). */
  detail?: string;
};

// Uma série só: sem legenda (o título do card diz o que é). Colunas com no máximo 24 px,
// ponta arredondada de 4 px, base reta, grade fina e discreta. A cor é --brand-text, que
// o tema garante legível sobre a superfície nos três temas (inclusive com cores próprias).
const MAX_BAR = 24;
const PLOT_H = 160;

/** Topo "redondo" do eixo e marcas (0, 1/2, topo). */
function niceMax(max: number) {
  if (max <= 0) return 100_00;
  const exp = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * exp >= max) return m * exp;
  return 10 * exp;
}

const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
const axisLabel = (cents: number) => (cents >= 1_000_000 ? `R$ ${compact.format(cents / 100)}` : formatBRL(cents).replace(",00", ""));

export function ColumnChart({ data, caption, labelEvery = 1 }: { data: Column[]; caption: string; labelEvery?: number }) {
  const [active, setActive] = useState<number | null>(null);
  const tableId = useId();
  const top = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const ticks = [top, top / 2, 0];
  const current = active === null ? null : data[active];

  return (
    <figure className="flex flex-col gap-2">
      <div className="relative flex gap-2">
        {/* Eixo Y */}
        <div className="flex flex-col justify-between text-right text-[11px] text-muted tabular-nums" style={{ height: PLOT_H }} aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="-translate-y-1/2 first:translate-y-0 last:translate-y-0">
              {axisLabel(t)}
            </span>
          ))}
        </div>

        <div className="relative min-w-0 flex-1">
          {/* Grade */}
          <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col justify-between" style={{ height: PLOT_H }} aria-hidden>
            {ticks.map((t) => (
              <span key={t} className="h-px w-full bg-border" />
            ))}
          </div>

          {/* Colunas: a faixa inteira é a área de toque/hover, maior que a coluna. */}
          <div className="relative flex items-end" style={{ height: PLOT_H }} role="list" aria-label={caption}>
            {data.map((d, i) => (
              <div
                key={d.label + i}
                role="listitem"
                tabIndex={0}
                aria-label={`${d.title}: ${formatBRL(d.value)}${d.detail ? `, ${d.detail}` : ""}`}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                className="flex h-full min-w-0 flex-1 cursor-default items-end justify-center rounded-sm outline-none hover:bg-hover focus-visible:bg-hover"
              >
                <span
                  className="block w-[60%] rounded-t-[4px] transition-opacity"
                  style={{
                    maxWidth: MAX_BAR,
                    height: d.value > 0 ? `max(2px, ${(d.value / top) * 100}%)` : 0,
                    background: "var(--brand-text)",
                    opacity: active === null || active === i ? 1 : 0.45,
                  }}
                />
              </div>
            ))}
          </div>

          {/* Eixo X */}
          <div className="mt-1 flex text-[11px] text-muted" aria-hidden>
            {data.map((d, i) => (
              <span key={d.label + i} className="min-w-0 flex-1 truncate text-center">
                {i % labelEvery === 0 ? d.label : ""}
              </span>
            ))}
          </div>

          {current && active !== null && (
            <div
              role="status"
              className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-border bg-surface px-3 py-2 text-xs whitespace-nowrap shadow-card"
              style={{ left: `${((active + 0.5) / data.length) * 100}%` }}
            >
              <p className="font-medium text-muted">{current.title}</p>
              <p className="text-sm font-semibold text-text">{formatBRL(current.value)}</p>
              {current.detail && <p className="text-muted">{current.detail}</p>}
            </div>
          )}
        </div>
      </div>

      <details className="text-xs text-muted">
        <summary className="cursor-pointer select-none hover:text-text">Ver tabela</summary>
        <table id={tableId} className="mt-2 w-full text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <tbody>
            {data.map((d, i) => (
              <tr key={d.label + i} className="border-t border-border">
                <th scope="row" className="py-1 font-normal text-muted">
                  {d.title}
                </th>
                <td className="py-1 text-right text-text tabular-nums">{formatBRL(d.value)}</td>
                <td className="py-1 pl-3 text-right tabular-nums">{d.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
