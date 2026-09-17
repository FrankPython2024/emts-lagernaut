import { Prisma } from "@prisma/client";
import { NICHT_UMLAGERUNG, nichtUmlagerungSql } from "./umlagerung";

// ── Was zählt als „an die Technik ausgegeben"? ───────────────────────────────
//
// JEDE Ausgabe-Buchung (AUSGANG/DIREKT) außer Umlagerungen und Abgaben an
// Niederlassungen — auch solche OHNE Anfrage. Grundlage für „Wert ausgegeben",
// „Gesamt ausgegeben" und die Impact-Seite (wiederverwendete Teile, CO₂,
// Elektroschrott).
//
// ⚠️ NICHT auf „nur Buchungen mit Anfrage" einschränken. Das wurde am 17.09.2026
// kurz so gebaut und am selben Tag zurückgenommen (Frank): Füße werden auch in
// großen Mengen von Hand an die Technik ausgegeben, ohne Anfrage je Gerät —
// 27.07.2026 190× + 20× + 14× E14, 18.08.2026 129× EliteBook 850 G5. Mit der
// Einschränkung fielen die Füße vorne von 509 auf 156 Stück (2.036 € → 624 €).

export const AUSGABE_AN_TECHNIK: Prisma.BuchungWhereInput = {
  typ:             { in: ["AUSGANG", "DIREKT"] },
  // Abgaben an andere Niederlassungen haben ein eigenes Panel.
  niederlassungId: null,
  // AND statt Spread: NICHT_UMLAGERUNG ist ein OR und darf kein anderes OR überschreiben.
  AND: [NICHT_UMLAGERUNG],
};

/** Dasselbe als SQL-Fragment für `$queryRaw` (beginnt mit `AND`). */
export function ausgabeAnTechnikSql(alias: string): Prisma.Sql {
  const b = (spalte: string) => Prisma.raw(`${alias}.${spalte}`);
  return Prisma.sql`AND ${b("typ")} IN ('AUSGANG', 'DIREKT') AND ${b("niederlassungId")} IS NULL
    ${nichtUmlagerungSql(alias)}`;
}
