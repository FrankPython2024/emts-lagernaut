// Geräte-Reise — gemeinsame Formatierungs-Helfer (Client).

const EURO = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

// Einkaufswert als EUR im deutschen Format (z. B. "1.234,56 €").
// null/undefined/kein Wert → "0,00 €".
export function formatEuro(v: number | null | undefined): string {
  return EURO.format(v ?? 0);
}

const EURO_KURZ = new Intl.NumberFormat("de-DE", {
  style: "currency", currency: "EUR", minimumFractionDigits: 0, maximumFractionDigits: 0,
});

// Wie formatEuro, aber OHNE Nachkommastellen (volle Euro, z. B. "3.793.914 €").
// Für große Summen, die mit Cent zu lang würden. null/kein Wert → "0 €".
export function formatEuroKurz(v: number | null | undefined): string {
  return EURO_KURZ.format(v ?? 0);
}
