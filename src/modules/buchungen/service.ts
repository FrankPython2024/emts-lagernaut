/**
 * BUCHUNGS-SERVICE — KRITISCHSTE DATEI IM GESAMTEN SYSTEM
 *
 * DIREKT-Buchung = NIEMALS Bestand ändern!
 * EINGANG + AUSGANG = Netto 0
 * Nur EINGANG und AUSGANG zählen für den Bestand.
 */

import { BuchungsTyp, type Buchung } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { prisma } from "@/core/db/prisma";

export type BucheLagerData = {
  artikelId:   number;
  menge:       number;
  typ:         BuchungsTyp;
  mitarbeiter: string;
  notiz?:      string;
};

/**
 * Berechnet den aktuellen Bestand einer Artikel-ID aus der Buchungshistorie.
 *
 * EINGANG  → +menge
 * AUSGANG  → -menge
 * DIREKT   → wird KOMPLETT IGNORIERT (Netto 0, kein Einfluss auf Bestand)
 */
export async function berechneBestand(artikelId: number): Promise<number> {
  const buchungen = await prisma.buchung.findMany({
    where: {
      artikelId,
      typ: { in: [BuchungsTyp.EINGANG, BuchungsTyp.AUSGANG] },
    },
    select: { typ: true, menge: true },
  });

  return buchungen.reduce((summe, b) => {
    if (b.typ === BuchungsTyp.EINGANG) return summe + b.menge;
    if (b.typ === BuchungsTyp.AUSGANG) return summe - b.menge;
    return summe; // DIREKT erreicht diese Zeile nie (where-Filter oben)
  }, 0);
}

/**
 * Schreibt eine Buchung in die DB und aktualisiert Artikel.bestand.
 *
 * EINGANG → bestand += menge
 * AUSGANG → bestand -= menge  (Bestandsprüfung vorher!)
 * DIREKT  → bestand NICHT ändern (kein increment, kein decrement)
 *
 * Gibt die erstellte Buchung zurück.
 */
export async function bucheLager(data: BucheLagerData): Promise<Buchung> {
  const artikel = await prisma.artikel.findUnique({
    where:  { id: data.artikelId },
    select: { id: true, bezeichnung: true, bestand: true },
  });

  if (!artikel) {
    throw new TRPCError({
      code:    "NOT_FOUND",
      message: `Artikel ${data.artikelId} nicht gefunden.`,
    });
  }

  if (data.typ === BuchungsTyp.AUSGANG) {
    if (artikel.bestand <= 0) {
      throw new TRPCError({
        code:    "BAD_REQUEST",
        message: `Kein Bestand vorhanden. Ausgang nicht möglich (aktuell: ${artikel.bestand}).`,
      });
    }
    if (data.menge > artikel.bestand) {
      throw new TRPCError({
        code:    "BAD_REQUEST",
        message: `Nicht genug Bestand. Verfügbar: ${artikel.bestand}, angefragt: ${data.menge}.`,
      });
    }
  }

  // Buchung schreiben + Bestand aktualisieren in einer Transaktion
  const [buchung] = await prisma.$transaction(async (tx) => {
    const neueBuchung = await tx.buchung.create({
      data: {
        artikelId:   data.artikelId,
        bezeichnung: artikel.bezeichnung,
        typ:         data.typ,
        menge:       data.menge,
        mitarbeiter: data.mitarbeiter,
        notiz:       data.notiz,
      },
    });

    // DIREKT: Bestand NICHT ändern
    if (data.typ !== BuchungsTyp.DIREKT) {
      const delta = data.typ === BuchungsTyp.EINGANG ? data.menge : -data.menge;
      await tx.artikel.update({
        where: { id: data.artikelId },
        data:  { bestand: { increment: delta } },
      });
    }

    return [neueBuchung];
  });

  return buchung;
}

/**
 * Vollständige Neuberechnung eines Bestandes aus der Historie.
 * Wird nach Stornierungen oder manuellen Korrekturen aufgerufen.
 */
export async function syncBestandAusHistorie(artikelId: number): Promise<number> {
  const neuerBestand = await berechneBestand(artikelId);
  await prisma.artikel.update({
    where: { id: artikelId },
    data:  { bestand: neuerBestand },
  });
  return neuerBestand;
}

/**
 * Alle Bestände aus der Historie neu berechnen (Admin-Funktion).
 */
export async function syncAlleBestaende(): Promise<{ aktualisiert: number }> {
  const artikel = await prisma.artikel.findMany({ select: { id: true } });
  await Promise.all(artikel.map((a) => syncBestandAusHistorie(a.id)));
  return { aktualisiert: artikel.length };
}

/**
 * Buchungshistorie mit Filter und Pagination.
 */
export async function getBuchungsListe(input: {
  artikelId?: number;
  typ?:       BuchungsTyp;
  von?:       Date;
  bis?:       Date;
  limit:      number;
  offset:     number;
}) {
  const where = {
    ...(input.artikelId && { artikelId: input.artikelId }),
    ...(input.typ       && { typ: input.typ }),
    ...(input.von || input.bis
      ? { datum: {
            ...(input.von && { gte: input.von }),
            ...(input.bis && { lte: input.bis }),
          },
        }
      : {}),
  };

  const [buchungen, total] = await Promise.all([
    prisma.buchung.findMany({
      where,
      orderBy: { datum: "desc" },
      take:    input.limit,
      skip:    input.offset,
      include: {
        artikel: { select: { id: true, bezeichnung: true, kategorie: true } },
      },
    }),
    prisma.buchung.count({ where }),
  ]);

  return { buchungen, total, hasMore: input.offset + input.limit < total };
}
