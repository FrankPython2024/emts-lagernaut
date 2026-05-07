import { TRPCError } from "@trpc/server";
import { prisma } from "@/core/db/prisma";

/**
 * Fuzzy-Suche nach kompatiblem Artikel für Gerät + Teiltyp.
 * Entspricht sucheModellUndBestand() aus code.gs.
 * Case-insensitive, contains-Matching in beide Richtungen.
 */
export async function sucheKompatibel(geraet: string, teiltyp: string) {
  const geraetLow = geraet.trim().toLowerCase();
  const teilLow   = teiltyp.trim().toLowerCase();

  const alle = await prisma.kompatibilitaet.findMany({
    include: {
      artikel: {
        select: { id: true, bezeichnung: true, kategorie: true, bestand: true },
      },
    },
  });

  // Fuzzy-Match: contains in beide Richtungen (wie in code.gs)
  const treffer = alle.filter((k) => {
    const kGeraet = k.geraet.toLowerCase();
    const kTeil   = k.teiltyp.toLowerCase();

    const geraetMatch = kGeraet.includes(geraetLow) || geraetLow.includes(kGeraet);
    const teilMatch   = kTeil.includes(teilLow)     || teilLow.includes(kTeil);

    return geraetMatch && teilMatch;
  });

  return treffer.map((k) => ({
    id:          k.id,
    geraet:      k.geraet,
    teiltyp:     k.teiltyp,
    artikel:     k.artikel,
    verfuegbar:  k.artikel.bestand > 0,
  }));
}

/**
 * Alle kompatiblen Teile für ein Gerät — mit aktuellem Bestand.
 * Wird im Kompatibilitäts-Modal des Techniker-Portals verwendet.
 */
export async function getByGeraet(geraet: string) {
  const geraetLow = geraet.trim().toLowerCase();

  const alle = await prisma.kompatibilitaet.findMany({
    include: {
      artikel: {
        select: { id: true, bezeichnung: true, kategorie: true, bestand: true },
      },
    },
  });

  return alle
    .filter((k) => {
      const kGeraet = k.geraet.toLowerCase();
      return kGeraet.includes(geraetLow) || geraetLow.includes(kGeraet);
    })
    .map((k) => ({
      id:         k.id,
      geraet:     k.geraet,
      teiltyp:    k.teiltyp,
      artikel:    k.artikel,
      verfuegbar: k.artikel.bestand > 0,
    }));
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

  // Artikel pro Kategorie
  const artikelPerKategorie: Record<string, { id: number; bezeichnung: string; bestand: number }[]> = {};
  for (const teil of standardTeile) {
    artikelPerKategorie[teil] = await prisma.artikel.findMany({
      where:   { kategorie: teil },
      select:  { id: true, bezeichnung: true, bestand: true },
      orderBy: { bezeichnung: "asc" },
    });
  }

  // Smart-Vorschläge: Keyword aus Modell-Namen
  const keywords = extractKeywords(modell.modell);
  const vorschlaege: Record<string, number | null> = {};

  for (const teil of standardTeile) {
    if (currentMap.has(teil)) { vorschlaege[teil] = null; continue; } // bereits verknüpft
    let vorschlag: { id: number } | null = null;
    for (const kw of keywords) {
      vorschlag = await prisma.artikel.findFirst({
        where: { AND: [{ bezeichnung: { contains: kw } }, { kategorie: teil }] },
        select: { id: true },
      });
      if (vorschlag) break;
    }
    vorschlaege[teil] = vorschlag?.id ?? null;
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

  let neu = 0;
  for (const teil of standardTeile) {
    if (existingSet.has(teil)) continue;

    let artikel: { id: number } | null = null;
    for (const kw of keywords) {
      artikel = await prisma.artikel.findFirst({
        where: { AND: [{ bezeichnung: { contains: kw } }, { kategorie: teil }] },
        select: { id: true },
      });
      if (artikel) break;
    }

    if (artikel) {
      await prisma.kompatibilitaet.upsert({
        where:  { geraet_teiltyp: { geraet: geraetVoll, teiltyp: teil } },
        create: { geraet: geraetVoll, teiltyp: teil, artikelId: artikel.id },
        update: {},
      });
      neu++;
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

const STANDARD_TEILE_ENUM = [
  "Displaymodul", "Tastatur", "Touchpad", "Füße vorne", "Füße hinten",
  "D Cover", "USB Board", "Power Button", "Lautsprecher", "Lüfter",
  "Thermalmodul", "BIOS Batterie", "Akku",
] as const;

const STANDARD_TEILE_LOOKUP = [
  "Displaymodul", "Tastatur", "Touchpad", "Füße vorne", "Füße hinten",
  "D Cover", "USB Board", "Power Button", "Lautsprecher", "Lüfter",
  "Thermalmodul", "BIOS Batterie", "Akku",
] as const;

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
 * Kompatible Teile für ein Gerät — mit Fallback auf Standard-Teile.
 * Wird in LogID-Suche und Techniker-Portal verwendet.
 *
 * Gefunden → echte Kompatibilitäts-Einträge mit Bestand
 * Nicht gefunden → alle 13 Standard-Teile mit Bestand 0
 */
export async function getByGeraetMitStandard(geraet: string): Promise<GeraetMitStandardResult> {
  const geraetLow = geraet.trim().toLowerCase();

  const alleKomp = await prisma.kompatibilitaet.findMany({
    include: {
      artikel: {
        select: { id: true, bezeichnung: true, kategorie: true, bestand: true },
      },
    },
  });

  const treffer = alleKomp.filter((k) => {
    const kg = k.geraet.toLowerCase();
    return kg.includes(geraetLow) || geraetLow.includes(kg);
  });

  if (treffer.length > 0) {
    return {
      kompatibilitaetVorhanden: true,
      teile: treffer.map((k) => ({
        teiltyp:     k.teiltyp,
        artikelId:   k.artikel.id,
        bezeichnung: k.artikel.bezeichnung,
        kategorie:   k.artikel.kategorie,
        bestand:     k.artikel.bestand,
        verfuegbar:  k.artikel.bestand > 0,
      })),
    };
  }

  // Keine Kompatibilität → Standard-Teile mit Bestand 0
  return {
    kompatibilitaetVorhanden: false,
    teile: STANDARD_TEILE_LOOKUP.map((teil) => ({
      teiltyp:     teil,
      artikelId:   null,
      bezeichnung: null,
      kategorie:   teil,
      bestand:     0,
      verfuegbar:  false,
    })),
  };
}
