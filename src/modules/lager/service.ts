import { TRPCError } from "@trpc/server";
import { prisma } from "@/core/db/prisma";

/**
 * Volltextsuche für das Techniker-Portal.
 * KEIN Lagerplatz im Ergebnis — Techniker dürfen ihn nicht sehen.
 */
export async function sucheArtikel(query: string) {
  const q = query.trim();

  const direktTreffer = await prisma.artikel.findMany({
    where: {
      OR: [
        { bezeichnung: { contains: q } },
        { kategorie:   { contains: q } },
      ],
    },
    include: { kompatibel: { select: { geraet: true } } },
    take: 30,
  });

  // Treffer über Kompatibilitäts-Gerätename (z.B. "HP 840 G5")
  const kompTreffer = await prisma.kompatibilitaet.findMany({
    where: { geraet: { contains: q } },
    include: {
      artikel: { include: { kompatibel: { select: { geraet: true } } } },
    },
    take: 30,
  });

  const seenIds = new Set(direktTreffer.map((a) => a.id));
  const combined = [...direktTreffer];

  for (const k of kompTreffer) {
    if (!seenIds.has(k.artikel.id)) {
      seenIds.add(k.artikel.id);
      combined.push(k.artikel);
    }
  }

  return combined.map((a) => ({
    id:          a.id,
    bezeichnung: a.bezeichnung,
    kategorie:   a.kategorie,
    bestand:     a.bestand,
    verfuegbar:  a.bestand > 0,
    kompatibel:  a.kompatibel.map((k) => k.geraet),
    // lagerplatz: bewusst NICHT enthalten
  }));
}

/**
 * Artikel per ID — ohne Lagerplatz (Techniker-Portal).
 */
export async function getArtikelById(id: number) {
  const artikel = await prisma.artikel.findUnique({
    where:   { id },
    include: { kompatibel: { select: { geraet: true, teiltyp: true } } },
  });

  if (!artikel) {
    throw new TRPCError({ code: "NOT_FOUND", message: `Artikel ${id} nicht gefunden.` });
  }

  const { lagerplatz: _lagerplatz, ...ohneOrt } = artikel;

  return {
    ...ohneOrt,
    verfuegbar:         artikel.bestand > 0,
    kompatibileGeraete: artikel.kompatibel.map((k) => k.geraet),
  };
}

/**
 * Artikel mit Lagerplatz — NUR für Admin-Bereich verwenden!
 */
export async function getArtikelMitLagerplatz(id: number) {
  const artikel = await prisma.artikel.findUnique({
    where:   { id },
    include: { kompatibel: { select: { geraet: true, teiltyp: true } } },
  });

  if (!artikel) {
    throw new TRPCError({ code: "NOT_FOUND", message: `Artikel ${id} nicht gefunden.` });
  }

  return {
    ...artikel,
    verfuegbar:         artikel.bestand > 0,
    kompatibileGeraete: artikel.kompatibel.map((k) => k.geraet),
  };
}

/**
 * Alle Artikel für Admin-Übersicht.
 */
export async function getAlleArtikel(input?: { kategorie?: string; limit?: number; offset?: number }) {
  const where    = input?.kategorie ? { kategorie: input.kategorie } : {};
  const limit    = input?.limit  ?? 100;
  const offset   = input?.offset ?? 0;

  const [artikel, total] = await Promise.all([
    prisma.artikel.findMany({
      where,
      orderBy: { bezeichnung: "asc" },
      take:    limit,
      skip:    offset,
    }),
    prisma.artikel.count({ where }),
  ]);

  return { artikel, total, hasMore: offset + limit < total };
}

/**
 * Neuen Artikel anlegen.
 */
export async function createArtikel(data: {
  bezeichnung: string;
  kategorie:   string;
  lagerplatz?: string;
}) {
  return prisma.artikel.create({
    data: { ...data, bestand: 0 },
  });
}

/**
 * Artikel aktualisieren.
 */
export async function updateArtikel(
  id:   number,
  data: Partial<{ bezeichnung: string; kategorie: string; lagerplatz: string | null }>,
) {
  const artikel = await prisma.artikel.findUnique({ where: { id } });
  if (!artikel) {
    throw new TRPCError({ code: "NOT_FOUND", message: `Artikel ${id} nicht gefunden.` });
  }

  return prisma.artikel.update({ where: { id }, data });
}

/**
 * Artikel löschen — nur wenn Bestand = 0.
 */
export async function deleteArtikel(id: number): Promise<void> {
  const artikel = await prisma.artikel.findUnique({
    where:  { id },
    select: { id: true, bestand: true, bezeichnung: true },
  });

  if (!artikel) {
    throw new TRPCError({ code: "NOT_FOUND", message: `Artikel ${id} nicht gefunden.` });
  }

  if (artikel.bestand !== 0) {
    throw new TRPCError({
      code:    "BAD_REQUEST",
      message: `Artikel '${artikel.bezeichnung}' kann nicht gelöscht werden — Bestand ist ${artikel.bestand} (muss 0 sein).`,
    });
  }

  await prisma.artikel.delete({ where: { id } });
}

/**
 * Alle vorhandenen Kategorien.
 */
export async function getKategorien(): Promise<string[]> {
  const result = await prisma.artikel.findMany({
    select:   { kategorie: true },
    distinct: ["kategorie"],
    orderBy:  { kategorie: "asc" },
  });
  return result.map((r) => r.kategorie);
}
