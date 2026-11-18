// Esgotado "só hoje": vale até sold_out_until (dia no fuso do estabelecimento); null = até reativar.
import { businessToday } from "./report-period";

export function isSoldOut(soldOut: boolean, until: string | null, today = businessToday()) {
  return soldOut && (until === null || until >= today);
}
