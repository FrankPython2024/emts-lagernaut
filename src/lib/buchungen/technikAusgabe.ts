import { Prisma } from "@prisma/client";
import { NICHT_UMLAGERUNG, nichtUmlagerungSql } from "./umlagerung";

// ── Was zählt als „an die Technik ausgegeben"? ───────────────────────────────
//
// NUR Ausgabe-Buchungen (AUSGANG/DIREKT), die zu einer Anfrage gehören.
// Grundlage für „Wert ausgegeben", „Gesamt ausgegeben" und die Impact-Seite
// (wiederverwendete Teile, CO₂, Elektroschrott).
//
// ⚠️ Vorher zählte JEDE AUSGANG/DIREKT-Buchung außer Umlagerungen und Abgaben —
// also auch von Hand angelegte Korrekturen. Gemessen 17.09.2026 über 90 Tage:
// 363 Teile / 1.441 € ohne Anfrage-Bezug, das waren 29 % der „wiederverwendeten
// Teile" bei Impact (größte Posten: eine Korrektur über 129 Füße und eine Buchung
// „190" über 190 Füße). Entscheidung Frank 17.09.2026: nur Anfrage-Buchungen.
//
// Erkannt über `anfrageId` ODER die Notiz „Anfrage #…": Wird eine Anfrage später
// gelöscht, bleibt ihre Buchung bewusst stehen („Bestand-Historie"), der Verweis
// wird aber per `onDelete: SetNull` leer — die Notiz trägt die Herkunft weiter.
// Betraf am 17.09.2026 zwei echte Ausgaben (#26009, #26917).
// Stresstest-Buchungen fallen damit ebenfalls heraus (Notiz „STRESSTEST_…",
// keine Anfrage).

export const ANFRAGE_NOTIZ_PREFIX = "Anfrage #";

export const AUSGABE_AN_TECHNIK: Prisma.BuchungWhereInput = {
  typ:             { in: ["AUSGANG", "DIREKT"] },
  // Abgaben an andere Niederlassungen haben ein eigenes Panel.
  niederlassungId: null,
  // ⚠️ AND statt zwei OR-Schlüssel im selben Objekt — das zweite würde das erste
  // stillschweigend überschreiben.
  AND: [
    NICHT_UMLAGERUNG,
    { OR: [{ anfrageId: { not: null } }, { notiz: { startsWith: ANFRAGE_NOTIZ_PREFIX } }] },
  ],
};

/** Dasselbe als SQL-Fragment für `$queryRaw` (beginnt mit `AND`). */
export function ausgabeAnTechnikSql(alias: string): Prisma.Sql {
  const b = (spalte: string) => Prisma.raw(`${alias}.${spalte}`);
  return Prisma.sql`AND ${b("typ")} IN ('AUSGANG', 'DIREKT') AND ${b("niederlassungId")} IS NULL
    ${nichtUmlagerungSql(alias)}
    AND (${b("anfrageId")} IS NOT NULL OR ${b("notiz")} LIKE ${ANFRAGE_NOTIZ_PREFIX + "%"})`;
}
