// ── Normalisierung von Teilenummern ──────────────────────────────────────────
//
// ⚠️ Diese Funktion steht AUSSCHLIESSLICH hier. Wird die Nummer an zwei
// Stellen unterschiedlich zurechtgeschnitten, entstehen zwei Einträge für
// dasselbe Teil — und der ganze Zweck der Teilenummer als Identität wäre
// dahin. `service.ts` reicht sie unverändert weiter, damit bestehende
// Aufrufe über `@/modules/teilenummern/service` gültig bleiben.
//
// Eigene Datei, weil `service.ts` Prisma zieht: So kann der Modell-Abgleich
// (und sein Test) die Normalisierung nutzen, ohne eine Datenbank zu brauchen.

/**
 * Nummer vereinheitlichen: Großschreibung, keine Leerzeichen, keine
 * Trennzeichen. „DA0X8JTB8D0", „da0x8jtb8d0" und „DA0-X8J-TB8D0" sind
 * dieselbe Nummer.
 *
 * Bewusst KEINE weitere Klugheit: Führende Nullen bleiben, denn bei Dell
 * gehören sie dazu („0GG3K9").
 */
export function normalisiere(roh: string): string {
  return roh.trim().toUpperCase().replace(/[\s\-_./]/g, "");
}
