// Geräte-Reise — gemeinsame Formatierungs-Helfer (Client).

const EURO = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

// Einkaufswert als EUR im deutschen Format (z. B. "1.234,56 €").
// null/undefined/kein Wert → "0,00 €".
export function formatEuro(v: number | null | undefined): string {
  return EURO.format(v ?? 0);
}
