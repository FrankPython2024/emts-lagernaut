import { AnfrageStatus } from "@prisma/client";
import { prisma } from "@/core/db/prisma";

export type LiveStats = {
  gesamtArtikel:    number;
  offeneAnfragen:   number;
  technikerOnline:  number;
  buchungenHeute:   number;
  artikelOhneBestand: number;
};

export type StatFilter = {
  von?: Date;
  bis?: Date;
};

/**
 * Live-Kennzahlen für Dashboard.
 */
export async function getLiveStats(): Promise<LiveStats> {
  const heute      = new Date();
  const heuteStart = new Date(heute.toISOString().slice(0, 10));
  const heuteEnde  = new Date(heuteStart);
  heuteEnde.setDate(heuteEnde.getDate() + 1);

  const [gesamtArtikel, offeneAnfragen, technikerOnline, buchungenHeute, artikelOhneBestand] =
    await Promise.all([
      prisma.artikel.count(),
      prisma.anfrage.count({
        where: { status: { in: [AnfrageStatus.NEU, AnfrageStatus.BEDARF] } },
      }),
      prisma.technikerSession.count({ where: { online: true } }),
      prisma.buchung.count({
        where: { datum: { gte: heuteStart, lt: heuteEnde } },
      }),
      prisma.artikel.count({ where: { bestand: 0 } }),
    ]);

  return { gesamtArtikel, offeneAnfragen, technikerOnline, buchungenHeute, artikelOhneBestand };
}

/**
 * Meistgefragte Geräte im Zeitraum.
 */
export async function getMeistgefragteGeraete(tage: number) {
  const von = new Date();
  von.setDate(von.getDate() - tage);

  const anfragen = await prisma.anfrage.groupBy({
    by:      ["geraet"],
    where:   { datum: { gte: von } },
    _count:  { geraet: true },
    orderBy: { _count: { geraet: "desc" } },
    take:    10,
  });

  return anfragen.map((a) => ({ geraet: a.geraet, anzahl: a._count.geraet }));
}

/**
 * Meistgefragte Teile / Kategorien im Zeitraum.
 */
export async function getMeistgefragteTeile(tage: number) {
  const von = new Date();
  von.setDate(von.getDate() - tage);

  const anfragen = await prisma.anfrage.groupBy({
    by:      ["teil"],
    where:   { datum: { gte: von } },
    _count:  { teil: true },
    orderBy: { _count: { teil: "desc" } },
    take:    10,
  });

  return anfragen.map((a) => ({ teil: a.teil, anzahl: a._count.teil }));
}

/**
 * Anfragen nach Status aufgeteilt.
 */
export async function getAnfragenNachStatus() {
  const gruppen = await prisma.anfrage.groupBy({
    by:     ["status"],
    _count: { status: true },
  });

  return gruppen.map((g) => ({ status: g.status, anzahl: g._count.status }));
}

/**
 * Buchungsverlauf der letzten N Tage (täglich).
 */
export async function getBuchungenVerlauf(tage: number) {
  const von = new Date();
  von.setDate(von.getDate() - tage);
  von.setHours(0, 0, 0, 0);

  const buchungen = await prisma.buchung.findMany({
    where:  { datum: { gte: von } },
    select: { datum: true, typ: true, menge: true },
    orderBy: { datum: "asc" },
  });

  // Tageweise aggregieren
  const tagesMap = new Map<string, { eingang: number; ausgang: number; direkt: number }>();

  for (let i = 0; i < tage; i++) {
    const d = new Date(von);
    d.setDate(d.getDate() + i);
    tagesMap.set(d.toISOString().slice(0, 10), { eingang: 0, ausgang: 0, direkt: 0 });
  }

  for (const b of buchungen) {
    const key = b.datum.toISOString().slice(0, 10);
    const tag = tagesMap.get(key);
    if (!tag) continue;

    if (b.typ === "EINGANG") tag.eingang += b.menge;
    else if (b.typ === "AUSGANG") tag.ausgang += b.menge;
    else if (b.typ === "DIREKT") tag.direkt += b.menge;
  }

  return Array.from(tagesMap.entries()).map(([datum, werte]) => ({ datum, ...werte }));
}

/**
 * KPI-Übersicht für Admin-Dashboard.
 */
export async function getKpiOverview(filter: StatFilter) {
  const where = {
    ...(filter.von && { datum: { gte: filter.von } }),
    ...(filter.bis && { datum: { lte: filter.bis } }),
  };

  const [gesamtAnfragen, abgeschlossen, bedarf, storniert, gesamtBuchungen] =
    await Promise.all([
      prisma.anfrage.count({ where }),
      prisma.anfrage.count({ where: { ...where, status: AnfrageStatus.ABGESCHLOSSEN } }),
      prisma.anfrage.count({ where: { ...where, status: AnfrageStatus.BEDARF } }),
      prisma.anfrage.count({ where: { ...where, status: AnfrageStatus.STORNIERT } }),
      prisma.buchung.count({ where }),
    ]);

  const erledigungsquote =
    gesamtAnfragen > 0 ? Math.round((abgeschlossen / gesamtAnfragen) * 100) : 0;

  return { gesamtAnfragen, abgeschlossen, bedarf, storniert, gesamtBuchungen, erledigungsquote };
}

/**
 * Techniker-Statistik: Anfragen + Buchungen pro Techniker.
 */
export async function getTechnikerStats(filter: StatFilter) {
  const datumFilter = {
    ...(filter.von && { gte: filter.von }),
    ...(filter.bis && { lte: filter.bis }),
  };
  const where = Object.keys(datumFilter).length ? { datum: datumFilter } : {};

  const anfragen = await prisma.anfrage.groupBy({
    by:      ["techniker"],
    where,
    _count:  { techniker: true },
    orderBy: { _count: { techniker: "desc" } },
  });

  return anfragen.map((a) => ({
    techniker: a.techniker,
    anfragen:  a._count.techniker,
  }));
}

/**
 * Monatsbericht: alle Buchungen + Anfragen eines Monats.
 */
export async function getMonatsbericht(monat: number, jahr: number) {
  const von = new Date(jahr, monat - 1, 1);
  const bis = new Date(jahr, monat, 1);

  const [buchungen, anfragen] = await Promise.all([
    prisma.buchung.findMany({
      where:   { datum: { gte: von, lt: bis } },
      orderBy: { datum: "asc" },
      include: { artikel: { select: { id: true, bezeichnung: true, kategorie: true } } },
    }),
    prisma.anfrage.findMany({
      where:   { datum: { gte: von, lt: bis } },
      orderBy: { datum: "asc" },
      include: { artikel: { select: { id: true, bezeichnung: true, kategorie: true } } },
    }),
  ]);

  return {
    monat,
    jahr,
    von,
    bis,
    buchungen,
    anfragen,
    zusammenfassung: {
      gesamtBuchungen:  buchungen.length,
      gesamtAnfragen:   anfragen.length,
      abgeschlossen:    anfragen.filter((a) => a.status === AnfrageStatus.ABGESCHLOSSEN).length,
      bedarf:           anfragen.filter((a) => a.status === AnfrageStatus.BEDARF).length,
      storniert:        anfragen.filter((a) => a.status === AnfrageStatus.STORNIERT).length,
    },
  };
}
