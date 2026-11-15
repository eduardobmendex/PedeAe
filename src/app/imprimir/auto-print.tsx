"use client";

import { useEffect } from "react";

/** Abre a janela de impressão assim que a página carrega, e oferece imprimir de novo. */
export function AutoPrint() {
  useEffect(() => {
    const id = setTimeout(() => window.print(), 300);
    return () => clearTimeout(id);
  }, []);

  return (
    <p className="no-print" style={{ textAlign: "center", margin: "12px 0", font: "14px system-ui, sans-serif" }}>
      <button type="button" onClick={() => window.print()} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #999", background: "#fff", cursor: "pointer" }}>
        Imprimir de novo
      </button>
    </p>
  );
}
