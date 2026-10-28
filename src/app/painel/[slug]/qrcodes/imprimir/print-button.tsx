"use client";

import { Button } from "@/components/ui";

export function PrintButton({ disabled }: { disabled?: boolean }) {
  return (
    <Button type="button" disabled={disabled} onClick={() => window.print()}>
      Imprimir / salvar PDF
    </Button>
  );
}
