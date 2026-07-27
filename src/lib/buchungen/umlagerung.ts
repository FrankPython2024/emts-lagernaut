import { Prisma } from "@prisma/client";

// ── Umlagerungen aus den Wert-/Impact-Auswertungen heraushalten ────────────────
//
// Ein Artikel-/Modell-Umzug (anderes Fach, anderer Standort) erzeugt aus
// Nachweis-Gründen Buchungen:
//   • verschiebeArtikel/verschiebeAlle → EINGANG + AUSGANG (Paar, netto 0)
//   • Modell-Umlagerung                → DIREKT
// Fachlich ist das KEINE Ausgabe an die Technik — es hat das Lager nie verlassen.
// Die Auswertungen „Wert ausgegeben" und „Impact" summieren aber über
// `typ IN (AUSGANG, DIREKT)` und zählten diese Bewegungen bisher mit: der
// ausgegebene Materialwert, die wiederverwendeten Teile und damit CO₂/E-Schrott
// waren dadurch systematisch ZU HOCH.
//
// Erkennung über das Notiz-Präfix — bewusst so gewählt, weil das rückwirkend auch
// alle bereits gebuchten Altdaten korrekt ausklammert (kein Schema-Umbau, keine
// Migration nötig). Wer die Erzeuger anpasst, muss die Präfixe hier mitpflegen.
export const UMLAGERUNG_NOTIZ_PREFIXE = ["Umlagerung:", "Verschiebung von"] as const;

/**
 * Prisma-`where`-Fragment: schließt Umlagerungs-Buchungen aus.
 * NULL-sicher — Buchungen ganz ohne Notiz bleiben ausdrücklich enthalten
 * (ein reines `NOT startsWith` würde sie in SQL mit verschlucken).
 */
export const NICHT_UMLAGERUNG: Prisma.BuchungWhereInput = {
  OR: [
    { notiz: null },
    { AND: UMLAGERUNG_NOTIZ_PREFIXE.map((p) => ({ NOT: { notiz: { startsWith: p } } })) },
  ],
};

/**
 * Dasselbe als SQL-Fragment für $queryRaw (Tabellen-Alias angeben, z. B. "b").
 * Ebenfalls NULL-sicher.
 */
export function nichtUmlagerungSql(alias: string): Prisma.Sql {
  const spalte = Prisma.raw(`${alias}.notiz`);
  return Prisma.sql`AND (${spalte} IS NULL OR (${Prisma.join(
    UMLAGERUNG_NOTIZ_PREFIXE.map((p) => Prisma.sql`${spalte} NOT LIKE ${p + "%"}`),
    " AND ",
  )}))`;
}
