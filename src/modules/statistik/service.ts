import { AnfrageStatus, BuchungsTyp } from "@prisma/client";
import { prisma } from "@/core/db/prisma";
import { redis } from "@/core/infra/redis";

export type LiveStats = {
  gesamtArtikel:       number;
  offeneAnfragen:      number;
  technikerOnline:     number;
  buchungenHeute:      number;
  artikelOhneBestand:  number;
  // Dashboard-KPIs (v2)
  aktiveAnfragen:       number;  // NEU + IN_BEARBEITUNG
  bedarfAnfragen:       number;  // BEDARF
  artikelMitBestand:    number;  // Artikel mit Bestand > 0
  heutigeAuslagerungen: number;  // AUSGANG + DIREKT heute
};

// Standort-Filter-Fragmente (fire-and-forget, kein import nötig)
function aF(sId?: number | null) { return sId != null ? { artikel: { standortId: sId } } : {}; }
function sF(sId?: number | null) { return sId != null ? { standortId: sId } : {}; }

// Test-Anfragen zählen NIEMALS in Statistik/KPIs. In jede Anfrage-Query gespreizt.
// (Buchungen sind automatisch sauber — Test-Anfragen erzeugen keine Buchung.)
const OHNE_TEST = { testModus: false } as const;

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
export async function getLiveStats(standortId?: number | null): Promise<LiveStats> {
  const heute      = new Date();
  const heuteStart = new Date(heute.toISOString().slice(0, 10));
  const heuteEnde  = new Date(heuteStart);
  heuteEnde.setDate(heuteEnde.getDate() + 1);
  const s = sF(standortId);
  const a = aF(standortId);

  const [
    gesamtArtikel, offeneAnfragen, technikerOnline, buchungenHeute, artikelOhneBestand,
    aktiveAnfragen, bedarfAnfragen, artikelMitBestand, heutigeAuslagerungen,
  ] = await Promise.all([
    prisma.artikel.count({ where: s }),
    prisma.anfrage.count({ where: { ...a, ...OHNE_TEST, status: { in: [AnfrageStatus.NEU, AnfrageStatus.BEDARF] } } }),
    prisma.technikerSession.count({ where: { online: true } }),
    prisma.buchung.count({ where: { ...a, datum: { gte: heuteStart, lt: heuteEnde } } }),
    prisma.artikel.count({ where: { ...s, bestand: 0 } }),
    // Dashboard-KPIs v2
    prisma.anfrage.count({ where: { ...a, ...OHNE_TEST, status: { in: [AnfrageStatus.NEU, AnfrageStatus.IN_BEARBEITUNG] } } }),
    prisma.anfrage.count({ where: { ...a, ...OHNE_TEST, status: AnfrageStatus.BEDARF } }),
    prisma.artikel.count({ where: { ...s, bestand: { gt: 0 } } }),
    prisma.buchung.count({
      where: {
        ...a,
        datum: { gte: heuteStart, lt: heuteEnde },
        typ:   { in: [BuchungsTyp.AUSGANG, BuchungsTyp.DIREKT] },
      },
    }),
  ]);

  return {
    gesamtArtikel, offeneAnfragen, technikerOnline, buchungenHeute, artikelOhneBestand,
    aktiveAnfragen, bedarfAnfragen, artikelMitBestand, heutigeAuslagerungen,
  };
}

/**
 * Meistgefragte Geräte im Zeitraum.
 */
export async function getMeistgefragteGeraete(tage: number, standortId?: number | null) {
  const von = new Date();
  von.setDate(von.getDate() - tage);

  const anfragen = await prisma.anfrage.groupBy({
    by:      ["geraet"],
    where:   { ...aF(standortId), ...OHNE_TEST, datum: { gte: von } },
    _count:  { geraet: true },
    orderBy: { _count: { geraet: "desc" } },
    take:    10,
  });

  return anfragen.map((a) => ({ geraet: a.geraet, anzahl: a._count.geraet }));
}

/**
 * Meistgefragte Teile / Kategorien im Zeitraum.
 */
export async function getMeistgefragteTeile(tage: number, standortId?: number | null) {
  const von = new Date();
  von.setDate(von.getDate() - tage);

  const anfragen = await prisma.anfrage.groupBy({
    by:      ["teil"],
    where:   { ...aF(standortId), ...OHNE_TEST, datum: { gte: von } },
    _count:  { teil: true },
    orderBy: { _count: { teil: "desc" } },
    take:    10,
  });

  return anfragen.map((a) => ({ teil: a.teil, anzahl: a._count.teil }));
}

/**
 * Anfragen nach Status aufgeteilt.
 */
export async function getAnfragenNachStatus(standortId?: number | null) {
  const gruppen = await prisma.anfrage.groupBy({
    by:     ["status"],
    where:  { ...aF(standortId), ...OHNE_TEST },
    _count: { status: true },
  });

  return gruppen.map((g) => ({ status: g.status, anzahl: g._count.status }));
}

/**
 * Buchungsverlauf der letzten N Tage (täglich).
 */
export async function getBuchungenVerlauf(tage: number, standortId?: number | null) {
  const von = new Date();
  von.setDate(von.getDate() - tage);
  von.setHours(0, 0, 0, 0);

  const buchungen = await prisma.buchung.findMany({
    where:  { ...aF(standortId), datum: { gte: von } },
    select: { datum: true, typ: true, menge: true },
    orderBy: { datum: "asc" },
  });

  // Tageweise aggregieren. von = heute - tage (00:00), die Query liefert datum >= von,
  // also von..heute (inkl. heute). Deshalb i <= tage — sonst fehlt der HEUTIGE Tag
  // und alle heutigen Buchungen fallen unten in `if (!tag) continue` heraus.
  const tagesMap = new Map<string, { eingang: number; ausgang: number; direkt: number }>();

  for (let i = 0; i <= tage; i++) {
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
export async function getKpiOverview(tage: number, standortId?: number | null) {
  const { von, bis } = tageZuDateRange(tage);
  const where  = { datum: { gte: von, lte: bis } };
  const artFlt = aF(standortId);

  const [gesamtAnfragen, abgeschlossen, bedarf, storniert, nichtVerfuegbar, gesamtBuchungen] =
    await Promise.all([
      prisma.anfrage.count({ where: { ...artFlt, ...where, ...OHNE_TEST } }),
      prisma.anfrage.count({ where: { ...artFlt, ...where, ...OHNE_TEST, status: AnfrageStatus.ABGESCHLOSSEN } }),
      prisma.anfrage.count({ where: { ...artFlt, ...where, ...OHNE_TEST, status: AnfrageStatus.BEDARF } }),
      prisma.anfrage.count({ where: { ...artFlt, ...where, ...OHNE_TEST, status: AnfrageStatus.STORNIERT } }),
      prisma.anfrage.count({ where: { ...artFlt, ...where, ...OHNE_TEST, status: AnfrageStatus.NICHT_VERFUEGBAR } }),
      prisma.buchung.count({ where: { ...artFlt, ...where } }),
    ]);

  const erledigungsquote =
    gesamtAnfragen > 0 ? Math.round((abgeschlossen / gesamtAnfragen) * 100) : 0;

  // NICHT_VERFUEGBAR wird bewusst NICHT in erledigungsquote/storniert eingerechnet.
  return { gesamtAnfragen, abgeschlossen, bedarf, storniert, nichtVerfuegbar, gesamtBuchungen, erledigungsquote };
}

/**
 * Techniker-Statistik — tage: Anzahl Tage rückwärts von heute.
 */
export async function getTechnikerStats(tage: number, standortId?: number | null) {
  const { von, bis } = tageZuDateRange(tage);
  const where = { ...aF(standortId), ...OHNE_TEST, datum: { gte: von, lte: bis } };

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
export async function getAnfragenVerlauf(tage: number, kuerzel?: string, standortId?: number | null) {
  const von = new Date();
  von.setDate(von.getDate() - tage);
  von.setHours(0, 0, 0, 0);

  const anfragen = await prisma.anfrage.findMany({
    where: {
      ...aF(standortId),
      ...OHNE_TEST,
      datum: { gte: von },
      ...(kuerzel ? { techniker: kuerzel } : {}),
    },
    select: { datum: true, status: true },
    orderBy: { datum: "asc" },
  });

  const tagesMap = new Map<string, { anfragen: number; erledigt: number; bedarf: number; nichtVerfuegbar: number }>();
  for (let i = 0; i < tage; i++) {
    const d = new Date(von);
    d.setDate(d.getDate() + i);
    tagesMap.set(d.toISOString().slice(0, 10), { anfragen: 0, erledigt: 0, bedarf: 0, nichtVerfuegbar: 0 });
  }

  for (const a of anfragen) {
    const key = a.datum.toISOString().slice(0, 10);
    const tag = tagesMap.get(key);
    if (!tag) continue;
    tag.anfragen++;
    if (a.status === AnfrageStatus.ABGESCHLOSSEN)    tag.erledigt++;
    if (a.status === AnfrageStatus.BEDARF)           tag.bedarf++;
    if (a.status === AnfrageStatus.NICHT_VERFUEGBAR) tag.nichtVerfuegbar++;
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
  const where = { techniker: kuerzel, ...OHNE_TEST, datum: { gte: von, lte: bis } };

  const alleAnfragen = await prisma.anfrage.findMany({
    where,
    select: { datum: true, status: true },
  });

  const gesamt       = alleAnfragen.length;
  const abgeschlossen = alleAnfragen.filter((a) => a.status === AnfrageStatus.ABGESCHLOSSEN).length;
  const bedarf        = alleAnfragen.filter((a) => a.status === AnfrageStatus.BEDARF).length;
  const storniert     = alleAnfragen.filter((a) => a.status === AnfrageStatus.STORNIERT).length;
  const nichtVerfuegbar = alleAnfragen.filter((a) => a.status === AnfrageStatus.NICHT_VERFUEGBAR).length;
  const offen         = alleAnfragen.filter((a) => a.status === AnfrageStatus.NEU).length;

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
    nichtVerfuegbar,
    offen,
    erledigungsrate: gesamt > 0 ? Math.round((abgeschlossen / gesamt) * 100) : 0,
    bedarfQuote:     gesamt > 0 ? Math.round((bedarf / gesamt) * 100) : 0,
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
    where:  { techniker: kuerzel, ...OHNE_TEST, datum: { gte: von } },
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
    where:  { techniker: kuerzel, ...OHNE_TEST, datum: { gte: von } },
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
    where:  { techniker: kuerzel, ...OHNE_TEST, datum: { gte: von } },
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
    where:  { techniker: kuerzel, ...OHNE_TEST, datum: { gte: von } },
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

  const where = { techniker: kuerzel, ...OHNE_TEST, datum: { gte: von } };

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
export async function getTechnikerTeamVergleich(tage: number, standortId?: number | null) {
  const { von, bis } = tageZuDateRange(tage);

  const alle = await prisma.anfrage.findMany({
    where:  { ...aF(standortId), ...OHNE_TEST, datum: { gte: von, lte: bis } },
    select: { techniker: true, status: true },
  });

  const map = new Map<string, {
    gesamt: number; abgeschlossen: number; bedarf: number; nichtVerfuegbar: number;
  }>();

  for (const a of alle) {
    const e = map.get(a.techniker) ?? { gesamt: 0, abgeschlossen: 0, bedarf: 0, nichtVerfuegbar: 0 };
    e.gesamt++;
    if (a.status === AnfrageStatus.ABGESCHLOSSEN)    e.abgeschlossen++;
    if (a.status === AnfrageStatus.BEDARF)           e.bedarf++;
    if (a.status === AnfrageStatus.NICHT_VERFUEGBAR) e.nichtVerfuegbar++;
    map.set(a.techniker, e);
  }

  return Array.from(map.entries())
    .map(([techniker, s]) => ({
      techniker,
      volumen:         s.gesamt,
      erledigungsrate: s.gesamt > 0 ? Math.round((s.abgeschlossen / s.gesamt) * 100) : 0,
      bedarfQuote:     s.gesamt > 0 ? Math.round((s.bedarf / s.gesamt) * 100) : 0,
      nichtVerfuegbar: s.nichtVerfuegbar,
    }))
    .sort((a, b) => b.volumen - a.volumen);
}

/**
 * Monatsbericht: alle Buchungen + Anfragen eines Monats.
 */
export async function getMonatsbericht(monat: number, jahr: number, standortId?: number | null) {
  const von    = new Date(jahr, monat - 1, 1);
  const bis    = new Date(jahr, monat, 1);
  const artFlt = aF(standortId);

  const [buchungen, anfragen] = await Promise.all([
    prisma.buchung.findMany({
      where:   { ...artFlt, datum: { gte: von, lt: bis } },
      orderBy: { datum: "asc" },
      include: { artikel: { select: { id: true, bezeichnung: true, kategorie: true } } },
    }),
    prisma.anfrage.findMany({
      where:   { ...artFlt, ...OHNE_TEST, datum: { gte: von, lt: bis } },
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

// ── Jahres-Archiv Funktionen ────────────────────────────────────────────────

/** Cache-Key Helpers */
const cacheKeyJahr   = (k: string, j: number) => `stats:techniker:${k}:jahr:${j}`;
const cacheKeyMonat  = (k: string, j: number, m: number) => `stats:techniker:${k}:monat:${j}-${m}`;
const cacheTTL       = (j: number, m: number) => {
  const now = new Date();
  const isCurrent = j === now.getFullYear() && m === now.getMonth() + 1;
  return isCurrent ? 300 : 3_600; // 5min aktueller Monat, 1h vergangene
};

/** Cache-Invalidierung für einen Techniker (nach neuer Anfrage / Status-Änderung). */
export async function invalidateTechnikerCache(kuerzel: string): Promise<void> {
  try {
    const pattern = `stats:techniker:${kuerzel}:*`;
    const keys    = await redis.keys(pattern);
    if (keys.length > 0) await redis.del(...keys);
  } catch { /* Redis nicht kritisch */ }
}

/**
 * Jahres-Archiv: 12 Monate mit Anfragen-KPIs.
 * Redis-Cache: vergangene Jahre 1h, aktuelles Jahr 5min.
 */
export async function getTechnikerJahresArchiv(kuerzel: string, jahr: number) {
  const key = cacheKeyJahr(kuerzel, jahr);
  try {
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached) as ReturnType<typeof _buildJahresArchiv>;
  } catch {}

  const result = await _buildJahresArchiv(kuerzel, jahr);

  const ttl = new Date().getFullYear() === jahr ? 300 : 3_600;
  try { await redis.setex(key, ttl, JSON.stringify(result)); } catch {}
  return result;
}

async function _buildJahresArchiv(kuerzel: string, jahr: number) {
  const von = new Date(jahr, 0, 1);
  const bis = new Date(jahr + 1, 0, 1);

  const anfragen = await prisma.anfrage.findMany({
    where:  { techniker: kuerzel, ...OHNE_TEST, datum: { gte: von, lt: bis } },
    select: { datum: true, status: true },
  });

  const monate = Array.from({ length: 12 }, (_, i) => {
    const ma = anfragen.filter((a) => new Date(a.datum).getMonth() === i);
    if (!ma.length) return { monat: i + 1, gesamt: null, erledigt: null, bedarf: null, storniert: null, erledigungsrate: null };
    const gesamt    = ma.length;
    const erledigt  = ma.filter((a) => a.status === AnfrageStatus.ABGESCHLOSSEN).length;
    const bedarf    = ma.filter((a) => a.status === AnfrageStatus.BEDARF).length;
    const storniert = ma.filter((a) => a.status === AnfrageStatus.STORNIERT).length;
    return {
      monat: i + 1,
      gesamt,
      erledigt,
      bedarf,
      storniert,
      erledigungsrate: Math.round((erledigt / gesamt) * 100),
    };
  });

  // Jahres-KPIs
  const mitDaten      = monate.filter((m) => m.gesamt !== null);
  const jahrGesamt    = mitDaten.reduce((s, m) => s + (m.gesamt ?? 0), 0);
  const jahrErledigt  = mitDaten.reduce((s, m) => s + (m.erledigt ?? 0), 0);
  const jahrRate      = jahrGesamt > 0 ? Math.round((jahrErledigt / jahrGesamt) * 100) : 0;
  const besterMonat   = mitDaten.reduce((best, m) => (m.erledigungsrate ?? 0) > (best?.erledigungsrate ?? -1) ? m : best, null as (typeof monate[0]) | null);
  const schlechtesterMonat = mitDaten.length > 1
    ? mitDaten.reduce((worst, m) => (m.erledigungsrate ?? 101) < (worst?.erledigungsrate ?? 101) ? m : worst, null as (typeof monate[0]) | null)
    : null;

  return {
    kuerzel,
    jahr,
    monate,
    jahresKpis: { gesamt: jahrGesamt, erledigt: jahrErledigt, erledigungsrate: jahrRate, besterMonat, schlechtesterMonat },
  };
}

/**
 * Verfügbare Jahre für einen Techniker (für den Jahr-Selector).
 */
export async function getTechnikerVerfuegbareJahre(kuerzel: string): Promise<number[]> {
  const [minA, maxA] = await Promise.all([
    prisma.anfrage.findFirst({ where: { techniker: kuerzel, ...OHNE_TEST }, orderBy: { datum: "asc" },  select: { datum: true } }),
    prisma.anfrage.findFirst({ where: { techniker: kuerzel, ...OHNE_TEST }, orderBy: { datum: "desc" }, select: { datum: true } }),
  ]);

  const aktuellesJahr = new Date().getFullYear();
  if (!minA) return [aktuellesJahr];

  const minJahr = new Date(minA.datum).getFullYear();
  const maxJahr = Math.max(new Date(maxA!.datum).getFullYear(), aktuellesJahr);
  const jahre: number[] = [];
  for (let j = maxJahr; j >= minJahr; j--) jahre.push(j);
  return jahre;
}

/**
 * Monats-Detail: alle KPIs + Top 3 Teile/Geräte + alle Anfragen.
 * Redis-Cache: 5min aktueller Monat, 1h vergangene.
 */
export async function getTechnikerMonatsDetail(kuerzel: string, monat: number, jahr: number) {
  const key = cacheKeyMonat(kuerzel, jahr, monat);
  try {
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached) as ReturnType<typeof _buildMonatsDetail>;
  } catch {}

  const result = await _buildMonatsDetail(kuerzel, monat, jahr);
  try { await redis.setex(key, cacheTTL(jahr, monat), JSON.stringify(result)); } catch {}
  return result;
}

async function _buildMonatsDetail(kuerzel: string, monat: number, jahr: number) {
  const von = new Date(jahr, monat - 1, 1);
  const bis = new Date(jahr, monat, 1);

  const anfragen = await prisma.anfrage.findMany({
    where:   { techniker: kuerzel, ...OHNE_TEST, datum: { gte: von, lt: bis } },
    include: { artikel: { select: { id: true, bezeichnung: true, kategorie: true } } },
    orderBy: { datum: "desc" },
  });

  const gesamt    = anfragen.length;
  const erledigt  = anfragen.filter((a) => a.status === AnfrageStatus.ABGESCHLOSSEN).length;
  const bedarf    = anfragen.filter((a) => a.status === AnfrageStatus.BEDARF).length;
  const storniert = anfragen.filter((a) => a.status === AnfrageStatus.STORNIERT).length;
  const nichtVerfuegbar = anfragen.filter((a) => a.status === AnfrageStatus.NICHT_VERFUEGBAR).length;

  // Top 3 Teile
  const teileMap = new Map<string, number>();
  for (const a of anfragen) teileMap.set(a.teil, (teileMap.get(a.teil) ?? 0) + 1);
  const topTeile = Array.from(teileMap.entries())
    .sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([teil, anzahl]) => ({ teil, anzahl }));

  // Top 3 Geräte
  const geraetMap = new Map<string, { anzahl: number; name: string }>();
  for (const a of anfragen) {
    const e = geraetMap.get(a.geraet) ?? { anzahl: 0, name: a.geraeteName ?? a.geraet };
    e.anzahl++;
    geraetMap.set(a.geraet, e);
  }
  const topGeraete = Array.from(geraetMap.entries())
    .sort((a, b) => b[1].anzahl - a[1].anzahl).slice(0, 3)
    .map(([geraet, { anzahl, name }]) => ({ geraet, name, anzahl }));

  return {
    kuerzel, monat, jahr, gesamt, erledigt, bedarf, storniert, nichtVerfuegbar,
    erledigungsrate: gesamt > 0 ? Math.round((erledigt / gesamt) * 100) : 0,
    topTeile, topGeraete,
    anfragen,
  };
}

/**
 * Jahres-Überblick aller Techniker (kompakt, für Admin-Chefüberblick).
 */
export async function getAllTechnikerJahresOverview(jahr: number) {
  const von = new Date(jahr, 0, 1);
  const bis = new Date(jahr + 1, 0, 1);

  const alle = await prisma.anfrage.findMany({
    where:  { ...OHNE_TEST, datum: { gte: von, lt: bis } },
    select: { techniker: true, datum: true, status: true },
  });

  const techMap = new Map<string, (number | null)[]>();

  for (const a of alle) {
    const m = new Date(a.datum).getMonth(); // 0-based
    if (!techMap.has(a.techniker)) techMap.set(a.techniker, new Array(12).fill(null));
    const arr = techMap.get(a.techniker)!;
    arr[m] = (arr[m] ?? 0) + 1;
  }

  return Array.from(techMap.entries())
    .map(([techniker, monate]) => ({ techniker, monate }))
    .sort((a, b) => a.techniker.localeCompare(b.techniker));
}
