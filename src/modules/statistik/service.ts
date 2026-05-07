import { AnfrageStatus } from "@prisma/client";
import { prisma } from "@/core/db/prisma";

export type LiveStats = {
  gesamtArtikel:    number;
  offeneAnfragen:   number;
  technikerOnline:  number;
  buchungenHeute:   number;
  artikelOhneBestand: number;
};

// Hilfsfunktion: tage → { von, bis }
function tageZuDateRange(tage: number): { von: Date; bis: Date } {
  const bis = new Date();
  const von = new Date();
  von.setDate(von.getDate() - tage);
  von.setHours(0, 0, 0, 0);
  return { von, bis };
}

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
 * KPI-Übersicht — tage: Anzahl Tage rückwärts von heute.
 */
export async function getKpiOverview(tage: number) {
  const { von, bis } = tageZuDateRange(tage);
  const where = { datum: { gte: von, lte: bis } };

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
 * Techniker-Statistik — tage: Anzahl Tage rückwärts von heute.
 */
export async function getTechnikerStats(tage: number) {
  const { von, bis } = tageZuDateRange(tage);
  const where = { datum: { gte: von, lte: bis } };

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

// ── Techniker-spezifische Funktionen (Anfragen-basiert) ──────────────────────

/**
 * Anfragen-Verlauf täglich (ersetzt Buchungs-Verlauf in Techniker-Statistik).
 * Optional nach Techniker-Kürzel filterbar.
 */
export async function getAnfragenVerlauf(tage: number, kuerzel?: string) {
  const von = new Date();
  von.setDate(von.getDate() - tage);
  von.setHours(0, 0, 0, 0);

  const anfragen = await prisma.anfrage.findMany({
    where: {
      datum: { gte: von },
      ...(kuerzel ? { techniker: kuerzel } : {}),
    },
    select: { datum: true, status: true },
    orderBy: { datum: "asc" },
  });

  const tagesMap = new Map<string, { anfragen: number; erledigt: number; bedarf: number }>();
  for (let i = 0; i < tage; i++) {
    const d = new Date(von);
    d.setDate(d.getDate() + i);
    tagesMap.set(d.toISOString().slice(0, 10), { anfragen: 0, erledigt: 0, bedarf: 0 });
  }

  for (const a of anfragen) {
    const key = a.datum.toISOString().slice(0, 10);
    const tag = tagesMap.get(key);
    if (!tag) continue;
    tag.anfragen++;
    if (a.status === AnfrageStatus.ABGESCHLOSSEN) tag.erledigt++;
    if (a.status === AnfrageStatus.BEDARF)        tag.bedarf++;
  }

  return Array.from(tagesMap.entries()).map(([datum, werte]) => ({ datum, ...werte }));
}

function getKW(d: Date): number {
  const onejan = new Date(d.getFullYear(), 0, 1);
  return Math.ceil((((d.getTime() - onejan.getTime()) / 86_400_000) + onejan.getDay() + 1) / 7);
}

/**
 * Techniker-KPIs: 6 persönliche Kennzahlen (nur Anfragen-basiert).
 */
export async function getTechnikerKpis(kuerzel: string, tage: number) {
  const { von, bis } = tageZuDateRange(tage);
  const where = { techniker: kuerzel, datum: { gte: von, lte: bis } };

  const alleAnfragen = await prisma.anfrage.findMany({
    where,
    select: { datum: true, status: true, createdAt: true, updatedAt: true },
  });

  const gesamt       = alleAnfragen.length;
  const abgeschlossen = alleAnfragen.filter((a) => a.status === AnfrageStatus.ABGESCHLOSSEN).length;
  const bedarf        = alleAnfragen.filter((a) => a.status === AnfrageStatus.BEDARF).length;
  const storniert     = alleAnfragen.filter((a) => a.status === AnfrageStatus.STORNIERT).length;
  const offen         = alleAnfragen.filter((a) => a.status === AnfrageStatus.NEU).length;

  const erledigte     = alleAnfragen.filter((a) => a.status === AnfrageStatus.ABGESCHLOSSEN);
  const avgWartezeitH = erledigte.length > 0
    ? Math.round(
        erledigte.reduce((s, a) => s + (a.updatedAt.getTime() - a.createdAt.getTime()), 0)
        / erledigte.length / 3_600_000,
      )
    : 0;

  // Aktivste Woche
  const wochenMap = new Map<string, number>();
  for (const a of alleAnfragen) {
    const d     = new Date(a.datum);
    const woche = `KW${getKW(d).toString().padStart(2, "0")}/${d.getFullYear()}`;
    wochenMap.set(woche, (wochenMap.get(woche) ?? 0) + 1);
  }
  let aktivsteWoche = "–";
  let maxWocheN     = 0;
  for (const [woche, n] of wochenMap) {
    if (n > maxWocheN) { maxWocheN = n; aktivsteWoche = woche; }
  }

  return {
    gesamt,
    abgeschlossen,
    bedarf,
    storniert,
    offen,
    erledigungsrate: gesamt > 0 ? Math.round((abgeschlossen / gesamt) * 100) : 0,
    bedarfQuote:     gesamt > 0 ? Math.round((bedarf / gesamt) * 100) : 0,
    avgWartezeitH,
    aktivsteWoche,
    aktivsteWocheAnzahl: maxWocheN,
  };
}

/**
 * Top Teile eines Technikers mit Bedarf-Anteil.
 */
export async function getTechnikerTeile(kuerzel: string, tage: number) {
  const von = new Date();
  von.setDate(von.getDate() - tage);

  const anfragen = await prisma.anfrage.findMany({
    where:  { techniker: kuerzel, datum: { gte: von } },
    select: { teil: true, status: true },
  });

  const map = new Map<string, { anzahl: number; bedarfAnzahl: number }>();
  for (const a of anfragen) {
    const e = map.get(a.teil) ?? { anzahl: 0, bedarfAnzahl: 0 };
    e.anzahl++;
    if (a.status === AnfrageStatus.BEDARF) e.bedarfAnzahl++;
    map.set(a.teil, e);
  }

  return Array.from(map.entries())
    .map(([teil, { anzahl, bedarfAnzahl }]) => ({
      teil,
      anzahl,
      bedarfAnzahl,
      bedarfQuote: Math.round((bedarfAnzahl / anzahl) * 100),
    }))
    .sort((a, b) => b.anzahl - a.anzahl)
    .slice(0, 10);
}

/**
 * Top Geräte eines Technikers.
 */
export async function getTechnikerGeraete(kuerzel: string, tage: number) {
  const von = new Date();
  von.setDate(von.getDate() - tage);

  const anfragen = await prisma.anfrage.findMany({
    where:  { techniker: kuerzel, datum: { gte: von } },
    select: { geraet: true, geraeteName: true },
  });

  const map = new Map<string, { name: string; anzahl: number }>();
  for (const a of anfragen) {
    const e = map.get(a.geraet) ?? { name: a.geraeteName ?? a.geraet, anzahl: 0 };
    e.anzahl++;
    map.set(a.geraet, e);
  }

  return Array.from(map.entries())
    .map(([geraet, { name, anzahl }]) => ({ geraet, name, anzahl }))
    .sort((a, b) => b.anzahl - a.anzahl)
    .slice(0, 10);
}

/**
 * Anfragen-Verteilung nach Wochentag (Mo=1 … So=7, vereinfacht 0–6).
 */
export async function getTechnikerWochentage(kuerzel: string, tage: number) {
  const von = new Date();
  von.setDate(von.getDate() - tage);

  const anfragen = await prisma.anfrage.findMany({
    where:  { techniker: kuerzel, datum: { gte: von } },
    select: { datum: true },
  });

  const NAMEN = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  const counts = new Array(7).fill(0) as number[];
  for (const a of anfragen) counts[new Date(a.datum).getDay()]++;
  return NAMEN.map((tag, i) => ({ tag, anzahl: counts[i] }));
}

/**
 * Anfragen-Verteilung nach Tagesstunde.
 */
export async function getTechnikerTageszeiten(kuerzel: string, tage: number) {
  const von = new Date();
  von.setDate(von.getDate() - tage);

  const anfragen = await prisma.anfrage.findMany({
    where:  { techniker: kuerzel, datum: { gte: von } },
    select: { datum: true },
  });

  const counts = new Array(24).fill(0) as number[];
  for (const a of anfragen) counts[new Date(a.datum).getHours()]++;
  return counts.map((anzahl, stunde) => ({ stunde, anzahl }));
}

/**
 * Letzte Anfragen eines Technikers (paginiert).
 */
export async function getTechnikerLetzteAnfragen(kuerzel: string, tage: number, limit: number, offset: number) {
  const von = new Date();
  von.setDate(von.getDate() - tage);

  const where = { techniker: kuerzel, datum: { gte: von } };

  const [anfragen, total] = await Promise.all([
    prisma.anfrage.findMany({
      where,
      orderBy: { datum: "desc" },
      take:    limit,
      skip:    offset,
      include: { artikel: { select: { id: true, bezeichnung: true, kategorie: true } } },
    }),
    prisma.anfrage.count({ where }),
  ]);

  return { anfragen, total };
}

/**
 * Team-Vergleich: alle Techniker mit mehreren Metriken (für Radar/Grid).
 */
export async function getTechnikerTeamVergleich(tage: number) {
  const { von, bis } = tageZuDateRange(tage);

  const alle = await prisma.anfrage.findMany({
    where:  { datum: { gte: von, lte: bis } },
    select: { techniker: true, status: true, createdAt: true, updatedAt: true },
  });

  const map = new Map<string, {
    gesamt: number; abgeschlossen: number; bedarf: number;
    wartezeitSumMs: number; erledigte: number;
  }>();

  for (const a of alle) {
    const e = map.get(a.techniker) ?? { gesamt: 0, abgeschlossen: 0, bedarf: 0, wartezeitSumMs: 0, erledigte: 0 };
    e.gesamt++;
    if (a.status === AnfrageStatus.ABGESCHLOSSEN) {
      e.abgeschlossen++;
      e.erledigte++;
      e.wartezeitSumMs += a.updatedAt.getTime() - a.createdAt.getTime();
    }
    if (a.status === AnfrageStatus.BEDARF) e.bedarf++;
    map.set(a.techniker, e);
  }

  return Array.from(map.entries())
    .map(([techniker, s]) => ({
      techniker,
      volumen:        s.gesamt,
      erledigungsrate: s.gesamt > 0 ? Math.round((s.abgeschlossen / s.gesamt) * 100) : 0,
      avgWartezeitH:   s.erledigte > 0 ? Math.round(s.wartezeitSumMs / s.erledigte / 3_600_000) : 0,
      bedarfQuote:     s.gesamt > 0 ? Math.round((s.bedarf / s.gesamt) * 100) : 0,
    }))
    .sort((a, b) => b.volumen - a.volumen);
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
