import { BuchungsTyp } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { prisma } from "@/core/db/prisma";
import type { BuchungErstellenInput } from "./buchungen.schema";

/**
 * Berechnet den Netto-Bestand einer Artikel-ID aus der Buchungshistorie.
 *
 * EINGANG  → +menge
 * AUSGANG  → -menge
 * DIREKT   → Netto 0 (Eingang + Ausgang heben sich auf — NIEMALS Bestand ändern)
 */
export async function berechneBestandAusHistorie(artikelId: number): Promise<number> {
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
    return summe;
  }, 0);
}

/**
 * Schreibt den neu berechneten Bestand in den Artikel.
 * Wird nach jeder Buchung aufgerufen.
 */
export async function aktualisiereBestand(artikelId: number): Promise<number> {
  const neuerBestand = await berechneBestandAusHistorie(artikelId);
  await prisma.artikel.update({
    where: { id: artikelId },
    data:  { bestand: neuerBestand },
  });
  return neuerBestand;
}

/**
 * Vollständige Neuberechnung aller Bestände.
 * Wird nur manuell vom Admin angestoßen.
 */
export async function syncAlleBestaende(): Promise<{ aktualisiert: number }> {
  const artikel = await prisma.artikel.findMany({ select: { id: true } });

  await Promise.all(artikel.map((a) => aktualisiereBestand(a.id)));

  return { aktualisiert: artikel.length };
}

/**
 * Erstellt eine Buchung und aktualisiert den Bestand.
 *
 * DIREKT-Buchungen schreiben ZWEI Einträge (1× EINGANG + 1× AUSGANG),
 * der Netto-Bestand bleibt 0 — der Bestand ändert sich nicht.
 *
 * Für alle anderen Typen: eine Buchung, Bestand wird neu berechnet.
 */
export async function erstelleBuchung(input: BuchungErstellenInput) {
  const artikel = await prisma.artikel.findUnique({
    where: { id: input.artikelId },
    select: { id: true, bezeichnung: true, bestand: true },
  });

  if (!artikel) {
    throw new TRPCError({
      code:    "NOT_FOUND",
      message: `Artikel ${input.artikelId} nicht gefunden.`,
    });
  }

  if (input.typ === BuchungsTyp.AUSGANG && artikel.bestand <= 0) {
    throw new TRPCError({
      code:    "BAD_REQUEST",
      message: `Kein Bestand vorhanden. Ausgang nicht möglich (aktuell: ${artikel.bestand}).`,
    });
  }

  if (input.typ === BuchungsTyp.AUSGANG && input.menge > artikel.bestand) {
    throw new TRPCError({
      code:    "BAD_REQUEST",
      message: `Nicht genug Bestand. Verfügbar: ${artikel.bestand}, angefragt: ${input.menge}.`,
    });
  }

  if (input.typ === BuchungsTyp.DIREKT) {
    // DIREKT = Bedarf-Buchung: Eingang + Ausgang → Netto 0, Bestand unverändert
    await prisma.buchung.createMany({
      data: [
        {
          artikelId:   input.artikelId,
          bezeichnung: artikel.bezeichnung,
          typ:         BuchungsTyp.EINGANG,
          menge:       input.menge,
          mitarbeiter: input.mitarbeiter,
          notiz:       input.notiz ?? "DIREKT-Buchung (Bedarf)",
        },
        {
          artikelId:   input.artikelId,
          bezeichnung: artikel.bezeichnung,
          typ:         BuchungsTyp.AUSGANG,
          menge:       input.menge,
          mitarbeiter: input.mitarbeiter,
          notiz:       input.notiz ?? "DIREKT-Buchung (Bedarf)",
        },
      ],
    });
  } else {
    await prisma.buchung.create({
      data: {
        artikelId:   input.artikelId,
        bezeichnung: artikel.bezeichnung,
        typ:         input.typ,
        menge:       input.menge,
        mitarbeiter: input.mitarbeiter,
        notiz:       input.notiz,
      },
    });
  }

  const neuerBestand = await aktualisiereBestand(input.artikelId);

  return {
    artikelId:    input.artikelId,
    bezeichnung:  artikel.bezeichnung,
    typ:          input.typ,
    menge:        input.menge,
    neuerBestand,
  };
}

/**
 * Buchungshistorie für einen Artikel oder alle Artikel.
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
      ? {
          datum: {
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
