import type { ReactNode } from "react";

// Impressão em impressora térmica de 80 mm (também funciona em A4: fica centralizado e estreito).
// Fora do layout do painel: sem menu lateral, sem cores do tema, só preto no branco.
export default function PrintLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <style>{`
        @page { size: 80mm auto; margin: 3mm; }
        html, body { background: #fff !important; color: #000 !important; }
        .ticket { width: 74mm; margin: 0 auto; font: 12px/1.35 ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace; color: #000; }
        .ticket h1 { font-size: 15px; font-weight: 700; text-align: center; margin: 0 0 2px; }
        .ticket .big { font-size: 22px; font-weight: 800; }
        .ticket .center { text-align: center; }
        .ticket hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
        .ticket .row { display: flex; justify-content: space-between; gap: 8px; }
        .ticket .muted { color: #333; }
        .ticket ul { list-style: none; padding: 0; margin: 0; }
        @media screen { body { padding: 16px 0; background: #f2f2f2 !important; } .ticket { background: #fff; padding: 10px; box-shadow: 0 1px 6px rgb(0 0 0 / 0.15); } }
        @media print { .no-print { display: none !important; } }
      `}</style>
      {children}
    </>
  );
}
