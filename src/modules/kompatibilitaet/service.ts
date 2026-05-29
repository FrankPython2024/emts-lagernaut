import { TRPCError } from "@trpc/server";
import { prisma } from "@/core/db/prisma";
import { STANDARD_TEILNAMEN, VERSCHIEDENES_TEILTYP } from "@/lib/constants/teiltypen";

/**
 * Effiziente Fuzzy-Suche: findet passende Geräte-Strings per DB-Filter,
 * lädt nur die Artikel für echte Treffer (kein volles Table-Scan in JS).
 */
async function findMatchingGeraete(geraetLow: string): Promise<string[]> {
  // Richtung 1: DB-enthält-Suchanfrage (häufigster Fall)
  const containsHits = await prisma.kompatibilitaet.findMany({
    where:    { geraet: { contains: geraetLow } },
    distinct: ["geraet"],
    select:   { geraet: true },
  });

  // Richtung 2: Suchanfrage enthält DB-Eintrag (kürzere DB-Einträge)
  // Nur Strings laden — kein Join
  const allGeraeteStrings = await prisma.kompatibilitaet.findMany({
    distinct: ["geraet"],
    select:   { geraet: true },
  });
  const reverseHits = allGeraeteStrings
    .filter((g) => geraetLow.includes(g.geraet.toLowerCase()) && !g.geraet.toLowerCase().includes(geraetLow))
    .map((g) => g.geraet);

  return [...new Set([...containsHits.map((g) => g.geraet), ...reverseHits])];
}

/**
 * Fuzzy-Suche nach kompatiblem Artikel für Gerät + Teiltyp.
 * Entspricht sucheModellUndBestand() aus code.gs.
 */
export async function sucheKompatibel(geraet: string, teiltyp: string) {
  const geraetLow = geraet.trim().toLowerCase();
  const teilLow   = teiltyp.trim().toLowerCase();

  const matchingGeraete = await findMatchingGeraete(geraetLow);
  if (!matchingGeraete.length) return [];

  const treffer = await prisma.kompatibilitaet.findMany({
    where: {
      geraet: { in: matchingGeraete },
      OR: [
        { teiltyp: { contains: teilLow } },
      ],
    },
    include: {
      artikel: { select: { id: true, bezeichnung: true, kategorie: true, bestand: true } },
    },
  });

  // Zweite Richtung für Teiltyp (in-JS, nur auf gefilterten Ergebnissen)
  return treffer
    .filter((k) => {
      const kTeil = k.teiltyp.toLowerCase();
      return kTeil.includes(teilLow) || teilLow.includes(kTeil);
    })
    .map((k) => ({ id: k.id, geraet: k.geraet, teiltyp: k.teiltyp, artikel: k.artikel, verfuegbar: k.artikel.bestand > 0 }));
}

/**
 * Alle kompatiblen Teile für ein Gerät — mit aktuellem Bestand.
 */
export async function getByGeraet(geraet: string) {
  const geraetLow      = geraet.trim().toLowerCase();
  const matchingGeraete = await findMatchingGeraete(geraetLow);
  if (!matchingGeraete.length) return [];

  const treffer = await prisma.kompatibilitaet.findMany({
    where:   { geraet: { in: matchingGeraete } },
    include: { artikel: { select: { id: true, bezeichnung: true, kategorie: true, bestand: true } } },
  });

  return treffer.map((k) => ({ id: k.id, geraet: k.geraet, teiltyp: k.teiltyp, artikel: k.artikel, verfuegbar: k.artikel.bestand > 0 }));
}

/**
 * Alle Geräte die zu einem Artikel kompatibel sind.
 * Wird im Techniker-Portal für den "Kompatibilität"-Button verwendet.
 */
export async function getKompatibileGeraete(artikelId: number): Promise<string[]> {
  const eintraege = await prisma.kompatibilitaet.findMany({
    where:  { artikelId },
    select: { geraet: true },
  });
  return [...new Set(eintraege.map((e) => e.geraet))];
}

/**
 * Neuen Kompatibilitätseintrag hinzufügen.
 */
export async function addKompatibilitaet(data: {
  geraet:    string;
  teiltyp:   string;
  artikelId: number;
}) {
  const artikel = await prisma.artikel.findUnique({ where: { id: data.artikelId } });
  if (!artikel) {
    throw new TRPCError({ code: "NOT_FOUND", message: `Artikel ${data.artikelId} nicht gefunden.` });
  }

  return prisma.kompatibilitaet.create({
    data: {
      geraet:    data.geraet.trim(),
      teiltyp:   data.teiltyp.trim(),
      artikelId: data.artikelId,
    },
  });
}

/**
 * Kompatibilitätseintrag entfernen.
 */
export async function removeKompatibilitaet(id: number): Promise<void> {
  const eintrag = await prisma.kompatibilitaet.findUnique({ where: { id } });
  if (!eintrag) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Kompatibilitätseintrag nicht gefunden." });
  }
  await prisma.kompatibilitaet.delete({ where: { id } });
}

// ──────────────────────────────────────────────────────────────────────────────
// Modell-Verknüpfung (Admin)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Alle Kompatibilitäts-Einträge für ein GeraeteModell.
 */
export async function getByModell(modellId: number) {
  const modell = await prisma.geraeteModell.findUnique({ where: { id: modellId } });
  if (!modell) throw new TRPCError({ code: "NOT_FOUND", message: "Modell nicht gefunden." });

  const geraetVoll = `${modell.hersteller} ${modell.modell}`;
  const links = await prisma.kompatibilitaet.findMany({
    where:   { geraet: geraetVoll },
    include: { artikel: { select: { id: true, bezeichnung: true, kategorie: true, bestand: true } } },
    orderBy: { teiltyp: "asc" },
  });

  return { modell, geraetVoll, links };
}

/**
 * Alle Daten für das Verknüpfungs-Modal in einem Aufruf:
 * - Aktuelle Verknüpfungen
 * - Artikel pro STANDARD_TEIL Kategorie
 * - Smart-Vorschläge (Artikel mit Modell-Keyword in Bezeichnung)
 */
export async function getModalData(modellId: number) {
  const modell = await prisma.geraeteModell.findUnique({ where: { id: modellId } });
  if (!modell) throw new TRPCError({ code: "NOT_FOUND", message: "Modell nicht gefunden." });

  const geraetVoll  = `${modell.hersteller} ${modell.modell}`;
  const standardTeile = STANDARD_TEILE_ENUM;

  // Aktuelle Verknüpfungen
  const aktuelleLinks = await prisma.kompatibilitaet.findMany({
    where: { geraet: geraetVoll },
    select: { teiltyp: true, artikelId: true, id: true },
  });
  const currentMap = new Map(aktuelleLinks.map((l) => [l.teiltyp, l.artikelId]));

  // Alle Artikel für STANDARD_TEILE-Kategorien in einem einzigen Query laden
  const alleArtikel = await prisma.artikel.findMany({
    where:   { kategorie: { in: [...standardTeile] } },
    select:  { id: true, bezeichnung: true, bestand: true, kategorie: true },
    orderBy: { bezeichnung: "asc" },
  });

  const artikelPerKategorie: Record<string, { id: number; bezeichnung: string; bestand: number }[]> = {};
  for (const teil of standardTeile) {
    artikelPerKategorie[teil] = alleArtikel.filter((a) => a.kategorie === teil);
  }

  // Smart-Vorschläge: Keyword-Suche per IN-Query statt 13×N DB-Calls
  const keywords   = extractKeywords(modell.modell);
  const fehlendeTl = standardTeile.filter((t) => !currentMap.has(t));

  const vorschlaege: Record<string, number | null> = {};
  for (const teil of standardTeile) { vorschlaege[teil] = null; }

  if (fehlendeTl.length > 0 && keywords.length > 0) {
    // Alle Kandidaten für fehlende Teile in einem Query
    const kandidaten = await prisma.artikel.findMany({
      where: {
        kategorie:   { in: fehlendeTl },
        bezeichnung: { in: keywords.map((kw) => kw) }, // Fallback
        OR: keywords.map((kw) => ({ bezeichnung: { contains: kw } })),
      },
      select: { id: true, kategorie: true, bezeichnung: true },
    });

    for (const teil of fehlendeTl) {
      const kandidat = kandidaten.find((k) => k.kategorie === teil);
      vorschlaege[teil] = kandidat?.id ?? null;
    }
  }

  return { modell, geraetVoll, currentMap: Object.fromEntries(currentMap), artikelPerKategorie, vorschlaege };
}

/**
 * Alle Verknüpfungen eines Modells ersetzen.
 * null = kein Artikel für diesen Teiltyp.
 */
export async function setVerknuepfung(input: {
  modellId:       number;
  verknuepfungen: { teiltyp: string; artikelId: number | null }[];
}) {
  const modell = await prisma.geraeteModell.findUnique({ where: { id: input.modellId } });
  if (!modell) throw new TRPCError({ code: "NOT_FOUND", message: "Modell nicht gefunden." });

  const geraetVoll = `${modell.hersteller} ${modell.modell}`;

  await prisma.$transaction(async (tx) => {
    await tx.kompatibilitaet.deleteMany({ where: { geraet: geraetVoll } });

    const toCreate = input.verknuepfungen.filter((v) => v.artikelId !== null);
    if (toCreate.length > 0) {
      await tx.kompatibilitaet.createMany({
        data: toCreate.map((v) => ({ geraet: geraetVoll, teiltyp: v.teiltyp, artikelId: v.artikelId! })),
        skipDuplicates: true,
      });
    }
  });

  return { geraet: geraetVoll, gespeichert: input.verknuepfungen.filter((v) => v.artikelId).length };
}

/**
 * Auto-Verknüpfung: sucht passende Artikel per Keyword-Match.
 * Überschreibt NUR fehlende Teile (bestehende bleiben erhalten).
 */
export async function autoVerknuepfung(modellId: number) {
  const modell = await prisma.geraeteModell.findUnique({ where: { id: modellId } });
  if (!modell) throw new TRPCError({ code: "NOT_FOUND", message: "Modell nicht gefunden." });

  const geraetVoll   = `${modell.hersteller} ${modell.modell}`;
  const keywords     = extractKeywords(modell.modell);
  const standardTeile = STANDARD_TEILE_ENUM;

  const existing = await prisma.kompatibilitaet.findMany({
    where:  { geraet: geraetVoll },
    select: { teiltyp: true },
  });
  const existingSet = new Set(existing.map((e) => e.teiltyp));

  const fehlendeTl = standardTeile.filter((t) => !existingSet.has(t));
  let neu = 0;

  if (fehlendeTl.length > 0 && keywords.length > 0) {
    // Alle Kandidaten in einer Query laden
    const kandidaten = await prisma.artikel.findMany({
      where: {
        kategorie: { in: fehlendeTl },
        OR: keywords.map((kw) => ({ bezeichnung: { contains: kw } })),
      },
      select: { id: true, kategorie: true },
    });

    const kandidatenMap = new Map<string, number>();
    for (const k of kandidaten) {
      if (!kandidatenMap.has(k.kategorie)) kandidatenMap.set(k.kategorie, k.id);
    }

    const toCreate = fehlendeTl
      .filter((t) => kandidatenMap.has(t))
      .map((t) => ({ geraet: geraetVoll, teiltyp: t, artikelId: kandidatenMap.get(t)! }));

    if (toCreate.length > 0) {
      await prisma.kompatibilitaet.createMany({ data: toCreate, skipDuplicates: true });
      neu = toCreate.length;
    }
  }

  return { geraet: geraetVoll, neu };
}

/**
 * Massen-Auto-Verknüpfung: alle Modelle ohne Kompatibilität.
 */
export async function massAutoVerknuepfung() {
  const alleModelle = await prisma.geraeteModell.findMany({
    where: { aktiv: true },
    select: { id: true, hersteller: true, modell: true },
  });

  const kompCounts = await prisma.kompatibilitaet.groupBy({
    by:     ["geraet"],
    _count: { geraet: true },
  });
  const mitKomp = new Set(kompCounts.map((k) => k.geraet));

  let totalNeu = 0;
  let verarbeitet = 0;

  for (const m of alleModelle) {
    const gv = `${m.hersteller} ${m.modell}`;
    if (mitKomp.has(gv)) continue;
    const { neu } = await autoVerknuepfung(m.id);
    totalNeu += neu;
    verarbeitet++;
  }

  return { verarbeitet, totalNeu };
}

// Hilfsfunktion: Schlüsselwörter aus Modell-Namen extrahieren
function extractKeywords(modell: string): string[] {
  const words = modell.split(" ").filter((w) => w.length >= 2 && !/^(Gen|Inc|Co|Ltd|GmbH)$/i.test(w));
  const result: string[] = [];
  // Progressiv kürzer: erst vollständig, dann weniger Wörter
  for (let i = Math.min(words.length, 3); i >= 1; i--) {
    result.push(words.slice(0, i).join(" "));
  }
  return [...new Set(result)];
}

const STANDARD_TEILE_ENUM   = STANDARD_TEILNAMEN;
const STANDARD_TEILE_LOOKUP = STANDARD_TEILNAMEN;

export type TeilMitBestand = {
  teiltyp:   string;
  artikelId: number | null;
  bezeichnung: string | null;
  kategorie:   string;
  bestand:   number;
  verfuegbar: boolean;
};

export type GeraetMitStandardResult = {
  kompatibilitaetVorhanden: boolean;
  teile: TeilMitBestand[];
};

/**
 * IMMER alle 13 Standard-Teile zurückgeben — mit Bestand für verknüpfte Teile.
 *
 * Kernlogik:
 *   - Bestehende Kompatibilitäts-Einträge werden in eine Map geladen
 *   - Jedes der 13 Standard-Teile bekommt den verknüpften Artikel (falls vorhanden)
 *   - Nicht verknüpfte Teile: artikelId=null, bestand=0, verfuegbar=false (Zustand C)
 *
 * Wird in LogID-Suche und Techniker-Portal verwendet.
 * kompatibilitaetVorhanden=true → Badge "Keine Kompatibilität" wird ausgeblendet
 */
export async function getByGeraetMitStandard(args: {
  geraet:       string;
  standortIds?: number[];
}): Promise<GeraetMitStandardResult> {
  const geraetLow       = args.geraet.trim().toLowerCase();
  const matchingGeraete = await findMatchingGeraete(geraetLow);

  // Standort-Filter (Techniker = eigener Standort, Admin = ohne Filter).
  // Artikel ohne passenden Standort fallen aus der Verknüpfung raus — das Teil
  // erscheint dann als "nicht erfasst" (Zustand C) statt fremden Bestand zu zeigen.
  const artikelFilter = args.standortIds && args.standortIds.length > 0
    ? { standortId: { in: args.standortIds } }
    : undefined;

  // Teiltyp-Liste laden: Standards + (falls Modell identifizierbar) modell-spezifische Custom-Teile.
  // Auflösung: GeraeteModell-Reihe wird gesucht, deren "hersteller modell" (lowercased)
  // dem args.geraet entspricht. Bei Match → modell-spezifische Liste; sonst → globale Standards.
  const alleModelle = await prisma.geraeteModell.findMany({
    where:  { aktiv: true },
    select: { id: true, hersteller: true, modell: true },
  });
  const passendesModell = alleModelle.find(
    (m) => `${m.hersteller} ${m.modell}`.toLowerCase() === geraetLow,
  );

  const aktiveTeiltypen = passendesModell
    ? await prisma.teiltyp.findMany({
        where: {
          aktiv: true,
          OR: [
            { istStandard: true },
            { modellTeiltypen: { some: { modellId: passendesModell.id } } },
          ],
        },
        orderBy: { sortierung: "asc" },
        select:  { name: true },
      })
    : await prisma.teiltyp.findMany({
        where:   { aktiv: true, istStandard: true },
        orderBy: { sortierung: "asc" },
        select:  { name: true },
      });

  const treffer = matchingGeraete.length > 0
    ? await prisma.kompatibilitaet.findMany({
        where: {
          geraet: { in: matchingGeraete },
          ...(artikelFilter && { artikel: artikelFilter }),
        },
        include: { artikel: { select: { id: true, bezeichnung: true, kategorie: true, bestand: true } } },
      })
    : [];

  // Fallback auf hartkodierte Liste falls Teiltyp-Tabelle leer (z.B. vor Seed).
  // "Verschiedenes" wird als generischer Slot ausgeschlossen — es gibt keinen
  // generischen Verschiedenes-Artikel, nur Freitext-Varianten (siehe unten).
  const standardListe = (aktiveTeiltypen.length > 0
    ? aktiveTeiltypen.map(t => t.name)
    : STANDARD_TEILE_LOOKUP
  ).filter((name) => name !== VERSCHIEDENES_TEILTYP);

  // Map: teiltyp → artikel — bei Duplikaten (geraet mit/ohne Prefix) gewinnt höherer Bestand.
  // Schützt vor dem Fall wo Generator-Einträge (bestand=0) Einlager-Einträge (bestand>0) maskieren.
  const verknuepftMap = new Map<string, { id: number; bezeichnung: string; kategorie: string; bestand: number }>();
  for (const k of treffer) {
    const existing = verknuepftMap.get(k.teiltyp);
    if (!existing || k.artikel.bestand > existing.bestand) {
      verknuepftMap.set(k.teiltyp, k.artikel);
    }
  }

  const kompatibilitaetVorhanden = treffer.length > 0;

  // Alle aktiven Teiltypen — verknüpfte mit Bestandsdaten, andere als "nicht erfasst"
  const standardTeile: TeilMitBestand[] = standardListe.map((teiltyp) => {
    const artikel = verknuepftMap.get(teiltyp);
    if (artikel) {
      return {
        teiltyp,
        artikelId:   artikel.id,
        bezeichnung: artikel.bezeichnung,
        kategorie:   artikel.kategorie,
        bestand:     artikel.bestand,
        verfuegbar:  artikel.bestand > 0,
      };
    }
    return {
      teiltyp,
      artikelId:   null,
      bezeichnung: null,
      kategorie:   teiltyp,
      bestand:     0,
      verfuegbar:  false,
    };
  });

  // Verschiedenes-Varianten: eigener Artikel pro Freitext (Kategorie
  // "Verschiedenes"). Anders als Standard-Slots erscheinen sie NUR mit Bestand
  // (keine generischen Leer-Slots), jeweils mit dem Freitext im teiltyp/bezeichnung.
  const verschiedenesVarianten: TeilMitBestand[] = [...verknuepftMap.entries()]
    .filter(([, a]) => a.kategorie === VERSCHIEDENES_TEILTYP && a.bestand > 0)
    .map(([teiltyp, a]) => ({
      teiltyp,
      artikelId:   a.id,
      bezeichnung: a.bezeichnung,
      kategorie:   a.kategorie,
      bestand:     a.bestand,
      verfuegbar:  true,
    }));

  return {
    kompatibilitaetVorhanden,
    teile: [...standardTeile, ...verschiedenesVarianten],
  };
}
