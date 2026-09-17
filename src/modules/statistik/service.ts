import { AnfrageStatus, BuchungsTyp } from "@prisma/client";
import { prisma } from "@/core/db/prisma";
import { redis } from "@/core/infra/redis";
import {
  addiereTage, berlinMitternacht, berlinMonat, berlinMonatsbeginn, berlinStunde,
  berlinTag, berlinWochentag, isoKalenderwoche, zeitraum,
} from "@/lib/zeit/berlin";
import {
  anfrageStandortWhere, buchungStandortWhere, standortSchluessel,
  type StandortFilterId,
} from "./standort";

export type { StandortFilterId } from "./standort";

// ─────────────────────────────────────────────────────────────────────────────
// Statistik — Grundregeln (Prüfung 17.09.2026, vier Agents gegen die Produktion)
//
// 1. ZEITRAUM: „Letzte N Tage" heißt überall N Kalendertage einschließlich heute,
//    in deutscher Zeit ab 00:00 → `zeitraum()` aus src/lib/zeit/berlin.ts.
//    Vorher drei Regeln auf einer Seite (200 / 183 / 180 Anfragen unter
//    derselben Überschrift), der Verlauf ohne den heutigen Tag, Tagesgrenzen und
//    Uhrzeiten in UTC (Tageszeit-Grafik 2 h verschoben).
// 2. STANDORT: Anfragen über `anfrageStandortWhere` — ohne Artikel zählt der
//    Standort des Technikers. Nie wieder direkt `artikel.standortId` bei Anfragen.
// 3. ERLEDIGUNGSRATE: „nicht verfügbar" zählt NICHT gegen die Rate
//    (Entscheidung Frank 17.09.2026) → `erledigungsrate()`.
// 4. BEDARF-QUOTE entfernt: Sie zählte den HEUTIGEN Status BEDARF; erledigte
//    Bedarfsanfragen sind aber nicht mehr BEDARF — die Quote stand fast immer
//    bei 0 % (1 von 617 Anfragen in 30 Tagen).
// 5. Test-Anfragen zählen nie (`OHNE_TEST`).
// ─────────────────────────────────────────────────────────────────────────────

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

function sF(sId?: StandortFilterId) {
  if (sId == null) return {};
  return { standortId: Array.isArray(sId) ? { in: sId.length > 0 ? sId : [-1] } : sId };
}

// Test-Anfragen zählen NIEMALS in Statistik/KPIs. In jede Anfrage-Query gespreizt.
// (Buchungen sind automatisch sauber — Test-Anfragen erzeugen keine Buchung.)
const OHNE_TEST = { testModus: false } as const;

/** Offen = noch nicht erledigt, storniert oder als nicht beschaffbar markiert. */
const OFFENE_STATUS: AnfrageStatus[] = [
  AnfrageStatus.NEU, AnfrageStatus.IN_BEARBEITUNG, AnfrageStatus.BEDARF,
];

/**
 * Erledigungsrate in Prozent.
 *
 * ⚠️ „Nicht verfügbar" zählt NICHT gegen die Rate — das Teil war schlicht nicht
 * zu beschaffen, die Anfrage ist nicht liegen geblieben. Vorher stand es im
 * Nenner: 463 erledigt von 617 = 75 % (Grenze zu Rot) über 30 Tage; Monate
 * wurden als „schlechtester" markiert, in denen nur Teile fehlten.
 * Entscheidung Frank 17.09.2026. Storniert zählt weiterhin mit.
 */
export function erledigungsrate(erledigt: number, gesamt: number, nichtVerfuegbar: number): number {
  const nenner = gesamt - nichtVerfuegbar;
  return nenner > 0 ? Math.round((erledigt / nenner) * 100) : 0;
}

/** Beginn und Ende des heutigen Tages in deutscher Zeit. */
function heuteGrenzen(): { start: Date; ende: Date } {
  const heute = berlinTag(new Date());
  return { start: berlinMitternacht(heute), ende: berlinMitternacht(addiereTage(heute, 1)) };
}

/**
 * Live-Kennzahlen für Dashboard.
 */
export async function getLiveStats(standortId?: StandortFilterId): Promise<LiveStats> {
  const { start: heuteStart, ende: heuteEnde } = heuteGrenzen();
  const s = sF(standortId);
  const a = await anfrageStandortWhere(standortId);
  const b = buchungStandortWhere(standortId);

  const [
    gesamtArtikel, offeneAnfragen, technikerOnline, buchungenHeute, artikelOhneBestand,
    aktiveAnfragen, bedarfAnfragen, artikelMitBestand, heutigeAuslagerungen,
  ] = await Promise.all([
    prisma.artikel.count({ where: s }),
    prisma.anfrage.count({ where: { ...a, ...OHNE_TEST, status: { in: OFFENE_STATUS } } }),
    prisma.technikerSession.count({ where: { online: true } }),
    prisma.buchung.count({ where: { ...b, datum: { gte: heuteStart, lt: heuteEnde } } }),
    prisma.artikel.count({ where: { ...s, bestand: 0 } }),
    // Dashboard-KPIs v2
    prisma.anfrage.count({ where: { ...a, ...OHNE_TEST, status: { in: [AnfrageStatus.NEU, AnfrageStatus.IN_BEARBEITUNG] } } }),
    prisma.anfrage.count({ where: { ...a, ...OHNE_TEST, status: AnfrageStatus.BEDARF } }),
    prisma.artikel.count({ where: { ...s, bestand: { gt: 0 } } }),
    prisma.buchung.count({
      where: {
        ...b,
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
export async function getMeistgefragteGeraete(tage: number, standortId?: StandortFilterId) {
  const { von } = zeitraum(tage);

  const anfragen = await prisma.anfrage.groupBy({
    by:      ["geraet"],
    where:   { ...(await anfrageStandortWhere(standortId)), ...OHNE_TEST, datum: { gte: von } },
    _count:  { geraet: true },
    orderBy: { _count: { geraet: "desc" } },
    take:    10,
  });

  return anfragen.map((a) => ({ geraet: a.geraet, anzahl: a._count.geraet }));
}

/**
 * Meistgefragte Teile / Kategorien im Zeitraum.
 */
export async function getMeistgefragteTeile(tage: number, standortId?: StandortFilterId) {
  const { von } = zeitraum(tage);

  const anfragen = await prisma.anfrage.groupBy({
    by:      ["teil"],
    where:   { ...(await anfrageStandortWhere(standortId)), ...OHNE_TEST, datum: { gte: von } },
    _count:  { teil: true },
    orderBy: { _count: { teil: "desc" } },
    take:    10,
  });

  return anfragen.map((a) => ({ teil: a.teil, anzahl: a._count.teil }));
}

/**
 * Anfragen nach Status aufgeteilt — im gewählten Zeitraum.
 *
 * ⚠️ Nahm bis 17.09.2026 gar keinen Zeitraum entgegen und zählte alle Anfragen
 * seit Beginn — das Panel blieb bei 7, 30 oder 365 Tagen gleich.
 * Ohne `tage` weiterhin alles — für Aufrufer, die bewusst den Gesamtstand wollen.
 */
export async function getAnfragenNachStatus(tage?: number, standortId?: StandortFilterId) {
  const von = tage ? zeitraum(tage).von : null;
  const gruppen = await prisma.anfrage.groupBy({
    by:     ["status"],
    where:  { ...(await anfrageStandortWhere(standortId)), ...OHNE_TEST, ...(von ? { datum: { gte: von } } : {}) },
    _count: { status: true },
  });

  return gruppen.map((g) => ({ status: g.status, anzahl: g._count.status }));
}

/**
 * Buchungsverlauf der letzten N Tage (täglich, deutsche Kalendertage).
 */
export async function getBuchungenVerlauf(tage: number, standortId?: StandortFilterId) {
  const z = zeitraum(tage);

  const buchungen = await prisma.buchung.findMany({
    where:  { ...buchungStandortWhere(standortId), datum: { gte: z.von } },
    select: { datum: true, typ: true, menge: true },
    orderBy: { datum: "asc" },
  });

  const tagesMap = new Map<string, { eingang: number; ausgang: number; direkt: number }>();
  for (const tag of z.tage) tagesMap.set(tag, { eingang: 0, ausgang: 0, direkt: 0 });

  for (const b of buchungen) {
    const tag = tagesMap.get(berlinTag(b.datum));
    if (!tag) continue;

    if (b.typ === "EINGANG") tag.eingang += b.menge;
    else if (b.typ === "AUSGANG") tag.ausgang += b.menge;
    else if (b.typ === "DIREKT") tag.direkt += b.menge;
  }

  return Array.from(tagesMap.entries()).map(([datum, werte]) => ({ datum, ...werte }));
}

/**
 * KPI-Übersicht — tage: Anzahl Kalendertage einschließlich heute.
 *
 * `offen` hängt bewusst NICHT am Zeitraum: Die Kachel beantwortet „was liegt
 * gerade noch an" — eine offene Anfrage von vor acht Tagen gehört dazu, auch
 * wenn „7 Tage" gewählt ist. Vorher hieß die Kachel „Bedarf / Offen", zählte aber
 * nur BEDARF und nur, was im Zeitraum angelegt wurde.
 */
export async function getKpiOverview(tage: number, standortId?: StandortFilterId) {
  const { von } = zeitraum(tage);
  const artFlt = await anfrageStandortWhere(standortId);
  const where  = { ...artFlt, ...OHNE_TEST, datum: { gte: von } };

  const [gesamtAnfragen, abgeschlossen, storniert, nichtVerfuegbar, offen] =
    await Promise.all([
      prisma.anfrage.count({ where }),
      prisma.anfrage.count({ where: { ...where, status: AnfrageStatus.ABGESCHLOSSEN } }),
      prisma.anfrage.count({ where: { ...where, status: AnfrageStatus.STORNIERT } }),
      prisma.anfrage.count({ where: { ...where, status: AnfrageStatus.NICHT_VERFUEGBAR } }),
      prisma.anfrage.count({ where: { ...artFlt, ...OHNE_TEST, status: { in: OFFENE_STATUS } } }),
    ]);

  return {
    gesamtAnfragen, abgeschlossen, storniert, nichtVerfuegbar, offen,
    erledigungsquote: erledigungsrate(abgeschlossen, gesamtAnfragen, nichtVerfuegbar),
  };
}

/**
 * Techniker-Statistik — tage: Anzahl Kalendertage einschließlich heute.
 */
export async function getTechnikerStats(tage: number, standortId?: StandortFilterId) {
  const { von } = zeitraum(tage);
  const where = { ...(await anfrageStandortWhere(standortId)), ...OHNE_TEST, datum: { gte: von } };

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
 * Anfragen-Verlauf täglich (deutsche Kalendertage, heute eingeschlossen).
 * Optional nach Techniker-Kürzel filterbar.
 *
 * ⚠️ Bis 17.09.2026 fehlte der heutige Tag (Schleife `i < tage` ab „vor N Tagen"):
 * alle heutigen Anfragen fielen still heraus — 20 Stück an dem Tag, an dem es
 * auffiel. Beim Buchungsverlauf war genau das schon einmal behoben worden.
 */
export async function getAnfragenVerlauf(tage: number, kuerzel?: string, standortId?: StandortFilterId) {
  const z = zeitraum(tage);

  const anfragen = await prisma.anfrage.findMany({
    where: {
      ...(await anfrageStandortWhere(standortId)),
      ...OHNE_TEST,
      datum: { gte: z.von },
      ...(kuerzel ? { techniker: kuerzel } : {}),
    },
    select: { datum: true, status: true },
    orderBy: { datum: "asc" },
  });

  // ⚠️ Keine „Bedarf"-Reihe: Sie zählte je Tag, was HEUTE noch BEDARF ist — eine
  // erledigte Bedarfsanfrage verschwand rückwirkend aus der Kurve (gleicher Fehler
  // wie bei der entfernten Bedarf-Quote, Befund des Gegenlesens 17.09.2026).
  const tagesMap = new Map<string, { anfragen: number; erledigt: number; nichtVerfuegbar: number }>();
  for (const tag of z.tage) tagesMap.set(tag, { anfragen: 0, erledigt: 0, nichtVerfuegbar: 0 });

  for (const a of anfragen) {
    const tag = tagesMap.get(berlinTag(a.datum));
    if (!tag) continue;
    tag.anfragen++;
    if (a.status === AnfrageStatus.ABGESCHLOSSEN)    tag.erledigt++;
    if (a.status === AnfrageStatus.NICHT_VERFUEGBAR) tag.nichtVerfuegbar++;
  }

  return Array.from(tagesMap.entries()).map(([datum, werte]) => ({ datum, ...werte }));
}

/** Where-Teil für die Anfragen EINES Technikers im Zeitraum, am Standort. */
async function technikerWhere(kuerzel: string, tage: number, standortId?: StandortFilterId) {
  return {
    ...(await anfrageStandortWhere(standortId)),
    techniker: kuerzel,
    ...OHNE_TEST,
    datum: { gte: zeitraum(tage).von },
  };
}

/**
 * Techniker-KPIs (nur Anfragen-basiert).
 */
export async function getTechnikerKpis(kuerzel: string, tage: number, standortId?: StandortFilterId) {
  const alleAnfragen = await prisma.anfrage.findMany({
    where:  await technikerWhere(kuerzel, tage, standortId),
    select: { datum: true, status: true },
  });

  const gesamt          = alleAnfragen.length;
  const abgeschlossen   = alleAnfragen.filter((a) => a.status === AnfrageStatus.ABGESCHLOSSEN).length;
  const storniert       = alleAnfragen.filter((a) => a.status === AnfrageStatus.STORNIERT).length;
  const nichtVerfuegbar = alleAnfragen.filter((a) => a.status === AnfrageStatus.NICHT_VERFUEGBAR).length;
  const offen           = alleAnfragen.filter((a) => OFFENE_STATUS.includes(a.status)).length;

  // Aktivste Woche — ISO-Kalenderwoche in deutscher Zeit
  const wochenMap = new Map<string, number>();
  for (const a of alleAnfragen) {
    const { jahr, kw } = isoKalenderwoche(berlinTag(a.datum));
    const woche = `KW${kw.toString().padStart(2, "0")}/${jahr}`;
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
    storniert,
    nichtVerfuegbar,
    offen,
    erledigungsrate: erledigungsrate(abgeschlossen, gesamt, nichtVerfuegbar),
    aktivsteWoche,
    aktivsteWocheAnzahl: maxWocheN,
  };
}

/**
 * Top Teile eines Technikers.
 */
export async function getTechnikerTeile(kuerzel: string, tage: number, standortId?: StandortFilterId) {
  const anfragen = await prisma.anfrage.findMany({
    where:  await technikerWhere(kuerzel, tage, standortId),
    select: { teil: true },
  });

  const map = new Map<string, number>();
  for (const a of anfragen) map.set(a.teil, (map.get(a.teil) ?? 0) + 1);

  return Array.from(map.entries())
    .map(([teil, anzahl]) => ({ teil, anzahl }))
    .sort((a, b) => b.anzahl - a.anzahl)
    .slice(0, 10);
}

/**
 * Top Geräte eines Technikers.
 */
export async function getTechnikerGeraete(kuerzel: string, tage: number, standortId?: StandortFilterId) {
  const anfragen = await prisma.anfrage.findMany({
    where:  await technikerWhere(kuerzel, tage, standortId),
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
 * Anfragen-Verteilung nach Wochentag (0 = So … 6 = Sa), deutsche Zeit.
 */
export async function getTechnikerWochentage(kuerzel: string, tage: number, standortId?: StandortFilterId) {
  const anfragen = await prisma.anfrage.findMany({
    where:  await technikerWhere(kuerzel, tage, standortId),
    select: { datum: true },
  });

  const NAMEN = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  const counts = new Array(7).fill(0) as number[];
  for (const a of anfragen) counts[berlinWochentag(a.datum)]++;
  return NAMEN.map((tag, i) => ({ tag, anzahl: counts[i] ?? 0 }));
}

/**
 * Anfragen-Verteilung nach Tagesstunde, deutsche Zeit.
 * ⚠️ Vorher `getHours()` im UTC-Container: 7:30 Uhr erschien als 5 Uhr.
 */
export async function getTechnikerTageszeiten(kuerzel: string, tage: number, standortId?: StandortFilterId) {
  const anfragen = await prisma.anfrage.findMany({
    where:  await technikerWhere(kuerzel, tage, standortId),
    select: { datum: true },
  });

  const counts = new Array(24).fill(0) as number[];
  for (const a of anfragen) counts[berlinStunde(a.datum)]++;
  return counts.map((anzahl, stunde) => ({ stunde, anzahl }));
}

/**
 * Letzte Anfragen eines Technikers (paginiert).
 */
export async function getTechnikerLetzteAnfragen(
  kuerzel: string, tage: number, limit: number, offset: number, standortId?: StandortFilterId,
) {
  const where = await technikerWhere(kuerzel, tage, standortId);

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
 * Team-Vergleich: alle Techniker mit mehreren Metriken.
 */
export async function getTechnikerTeamVergleich(tage: number, standortId?: StandortFilterId) {
  const { von } = zeitraum(tage);

  const alle = await prisma.anfrage.findMany({
    where:  { ...(await anfrageStandortWhere(standortId)), ...OHNE_TEST, datum: { gte: von } },
    select: { techniker: true, status: true },
  });

  const map = new Map<string, { gesamt: number; abgeschlossen: number; nichtVerfuegbar: number }>();

  for (const a of alle) {
    const e = map.get(a.techniker) ?? { gesamt: 0, abgeschlossen: 0, nichtVerfuegbar: 0 };
    e.gesamt++;
    if (a.status === AnfrageStatus.ABGESCHLOSSEN)    e.abgeschlossen++;
    if (a.status === AnfrageStatus.NICHT_VERFUEGBAR) e.nichtVerfuegbar++;
    map.set(a.techniker, e);
  }

  return Array.from(map.entries())
    .map(([techniker, s]) => ({
      techniker,
      volumen:         s.gesamt,
      erledigungsrate: erledigungsrate(s.abgeschlossen, s.gesamt, s.nichtVerfuegbar),
      nichtVerfuegbar: s.nichtVerfuegbar,
    }))
    .sort((a, b) => b.volumen - a.volumen);
}

/**
 * Monatsbericht: alle Buchungen + Anfragen eines Monats (deutsche Monatsgrenzen).
 */
export async function getMonatsbericht(monat: number, jahr: number, standortId?: StandortFilterId) {
  const von = berlinMonatsbeginn(jahr, monat);
  const bis = berlinMonatsbeginn(jahr, monat + 1);

  const [buchungen, anfragen] = await Promise.all([
    prisma.buchung.findMany({
      where:   { ...buchungStandortWhere(standortId), datum: { gte: von, lt: bis } },
      orderBy: { datum: "asc" },
      include: { artikel: { select: { id: true, bezeichnung: true, kategorie: true } } },
    }),
    prisma.anfrage.findMany({
      where:   { ...(await anfrageStandortWhere(standortId)), ...OHNE_TEST, datum: { gte: von, lt: bis } },
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
      nichtVerfuegbar:  anfragen.filter((a) => a.status === AnfrageStatus.NICHT_VERFUEGBAR).length,
    },
  };
}

// ── Jahres-Archiv Funktionen ────────────────────────────────────────────────

/**
 * Cache-Schlüssel. ⚠️ Der Standort gehört hinein — sonst bekäme ein auf Sömmerda
 * beschränktes Konto das Archiv eines Admins mit allen Standorten aus dem Speicher.
 * Das Präfix `stats:techniker:<kürzel>:` bleibt, damit `invalidateTechnikerCache`
 * alle Varianten erwischt.
 */
const cacheKeyJahr  = (k: string, j: number, s: string) => `stats:techniker:${k}:jahr:${j}:s:${s}`;
const cacheKeyMonat = (k: string, j: number, m: number, s: string) => `stats:techniker:${k}:monat:${j}-${m}:s:${s}`;
const cacheTTL      = (j: number, m: number) => {
  const jetzt = berlinMonat(new Date());
  const isCurrent = j === jetzt.jahr && m === jetzt.monat;
  return isCurrent ? 300 : 3_600; // 5min aktueller Monat, 1h vergangene
};

/**
 * Cache-Invalidierung für einen Techniker (nach neuer Anfrage / Status-Änderung).
 *
 * ⚠️ Muss an JEDER Stelle laufen, die Anfragen anlegt, abschließt, zurücksetzt
 * oder löscht. Bis 17.09.2026 fehlte sie ausgerechnet beim normalen Abschließen
 * (`auslagern.teile`) sowie bei `schliesseAnfrageAb`, `anfragen.reset` und
 * `anfragen.loeschen` — das Jahresarchiv hing bis zu einer Stunde hinterher.
 */
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
export async function getTechnikerJahresArchiv(kuerzel: string, jahr: number, standortId?: StandortFilterId) {
  const key = cacheKeyJahr(kuerzel, jahr, standortSchluessel(standortId));
  try {
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached) as Awaited<ReturnType<typeof _buildJahresArchiv>>;
  } catch {}

  const result = await _buildJahresArchiv(kuerzel, jahr, standortId);

  const ttl = berlinMonat(new Date()).jahr === jahr ? 300 : 3_600;
  try { await redis.setex(key, ttl, JSON.stringify(result)); } catch {}
  return result;
}

async function _buildJahresArchiv(kuerzel: string, jahr: number, standortId?: StandortFilterId) {
  const von = berlinMonatsbeginn(jahr, 1);
  const bis = berlinMonatsbeginn(jahr + 1, 1);

  const anfragen = await prisma.anfrage.findMany({
    where:  { ...(await anfrageStandortWhere(standortId)), techniker: kuerzel, ...OHNE_TEST, datum: { gte: von, lt: bis } },
    select: { datum: true, status: true },
  });

  const monate = Array.from({ length: 12 }, (_, i) => {
    const ma = anfragen.filter((a) => berlinMonat(a.datum).monat === i + 1);
    if (!ma.length) {
      return { monat: i + 1, gesamt: null, erledigt: null, storniert: null, nichtVerfuegbar: null, erledigungsrate: null };
    }
    const gesamt          = ma.length;
    const erledigt        = ma.filter((a) => a.status === AnfrageStatus.ABGESCHLOSSEN).length;
    const storniert       = ma.filter((a) => a.status === AnfrageStatus.STORNIERT).length;
    const nichtVerfuegbar = ma.filter((a) => a.status === AnfrageStatus.NICHT_VERFUEGBAR).length;
    return {
      monat: i + 1,
      gesamt,
      erledigt,
      storniert,
      nichtVerfuegbar,
      erledigungsrate: erledigungsrate(erledigt, gesamt, nichtVerfuegbar),
    };
  });

  // Jahres-KPIs
  const mitDaten      = monate.filter((m) => m.gesamt !== null);
  const jahrGesamt    = mitDaten.reduce((s, m) => s + (m.gesamt ?? 0), 0);
  const jahrErledigt  = mitDaten.reduce((s, m) => s + (m.erledigt ?? 0), 0);
  const jahrNv        = mitDaten.reduce((s, m) => s + (m.nichtVerfuegbar ?? 0), 0);
  const jahrRate      = erledigungsrate(jahrErledigt, jahrGesamt, jahrNv);
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
export async function getTechnikerVerfuegbareJahre(kuerzel: string, standortId?: StandortFilterId): Promise<number[]> {
  const where = { ...(await anfrageStandortWhere(standortId)), techniker: kuerzel, ...OHNE_TEST };
  const [minA, maxA] = await Promise.all([
    prisma.anfrage.findFirst({ where, orderBy: { datum: "asc" },  select: { datum: true } }),
    prisma.anfrage.findFirst({ where, orderBy: { datum: "desc" }, select: { datum: true } }),
  ]);

  const aktuellesJahr = berlinMonat(new Date()).jahr;
  if (!minA) return [aktuellesJahr];

  const minJahr = berlinMonat(minA.datum).jahr;
  const maxJahr = Math.max(berlinMonat(maxA!.datum).jahr, aktuellesJahr);
  const jahre: number[] = [];
  for (let j = maxJahr; j >= minJahr; j--) jahre.push(j);
  return jahre;
}

/**
 * Monats-Detail: alle KPIs + Top 3 Teile/Geräte + alle Anfragen.
 * Redis-Cache: 5min aktueller Monat, 1h vergangene.
 */
export async function getTechnikerMonatsDetail(kuerzel: string, monat: number, jahr: number, standortId?: StandortFilterId) {
  const key = cacheKeyMonat(kuerzel, jahr, monat, standortSchluessel(standortId));
  try {
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached) as Awaited<ReturnType<typeof _buildMonatsDetail>>;
  } catch {}

  const result = await _buildMonatsDetail(kuerzel, monat, jahr, standortId);
  try { await redis.setex(key, cacheTTL(jahr, monat), JSON.stringify(result)); } catch {}
  return result;
}

async function _buildMonatsDetail(kuerzel: string, monat: number, jahr: number, standortId?: StandortFilterId) {
  const von = berlinMonatsbeginn(jahr, monat);
  const bis = berlinMonatsbeginn(jahr, monat + 1);

  const anfragen = await prisma.anfrage.findMany({
    where:   { ...(await anfrageStandortWhere(standortId)), techniker: kuerzel, ...OHNE_TEST, datum: { gte: von, lt: bis } },
    include: { artikel: { select: { id: true, bezeichnung: true, kategorie: true } } },
    orderBy: { datum: "desc" },
  });

  const gesamt          = anfragen.length;
  const erledigt        = anfragen.filter((a) => a.status === AnfrageStatus.ABGESCHLOSSEN).length;
  const storniert       = anfragen.filter((a) => a.status === AnfrageStatus.STORNIERT).length;
  const nichtVerfuegbar = anfragen.filter((a) => a.status === AnfrageStatus.NICHT_VERFUEGBAR).length;
  const offen           = anfragen.filter((a) => OFFENE_STATUS.includes(a.status)).length;

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
    kuerzel, monat, jahr, gesamt, erledigt, storniert, nichtVerfuegbar, offen,
    erledigungsrate: erledigungsrate(erledigt, gesamt, nichtVerfuegbar),
    topTeile, topGeraete,
    anfragen,
  };
}

/**
 * Jahres-Überblick aller Techniker (kompakt, für Admin-Chefüberblick).
 */
export async function getAllTechnikerJahresOverview(jahr: number, standortId?: StandortFilterId) {
  const von = berlinMonatsbeginn(jahr, 1);
  const bis = berlinMonatsbeginn(jahr + 1, 1);

  const alle = await prisma.anfrage.findMany({
    where:  { ...(await anfrageStandortWhere(standortId)), ...OHNE_TEST, datum: { gte: von, lt: bis } },
    select: { techniker: true, datum: true, status: true },
  });

  const techMap = new Map<string, (number | null)[]>();

  for (const a of alle) {
    const m = berlinMonat(a.datum).monat - 1; // 0-based
    if (!techMap.has(a.techniker)) techMap.set(a.techniker, new Array(12).fill(null));
    const arr = techMap.get(a.techniker)!;
    arr[m] = (arr[m] ?? 0) + 1;
  }

  return Array.from(techMap.entries())
    .map(([techniker, monate]) => ({ techniker, monate }))
    .sort((a, b) => a.techniker.localeCompare(b.techniker));
}
