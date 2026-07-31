import { TRPCError } from "@trpc/server";
import { prisma } from "@/core/db/prisma";
import { meilisearchSync } from "@/core/infra/meilisearchSync";

/**
 * Volltextsuche für das Techniker-Portal.
 * KEIN Lagerplatz im Ergebnis — Techniker dürfen ihn nicht sehen.
 */
export async function sucheArtikel(query: string, standortId?: number | null) {
  const q   = query.trim();
  const sF  = standortId != null ? { standortId } : {};

  const direktTreffer = await prisma.artikel.findMany({
    where: {
      ...sF,
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
    where: { geraet: { contains: q }, ...(standortId != null ? { artikel: { standortId } } : {}) },
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
 * Volltextsuche MIT Lagerplatz — nur für Admin-Bereich.
 */
export async function sucheArtikelAdmin(input: { query: string; limit?: number; offset?: number; standortId?: number | null }) {
  const treffer = await sucheArtikel(input.query, input.standortId);
  const ids     = treffer.map((t) => t.id);

  const mitLagerplatz = await prisma.artikel.findMany({
    where:  { id: { in: ids } },
    select: { id: true, lagerplatz: true },
  });

  const lagerMap = new Map(mitLagerplatz.map((a) => [a.id, a.lagerplatz]));

  return treffer.map((t) => ({
    ...t,
    lagerplatz: lagerMap.get(t.id) ?? null,
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

  // Pool-Partner (baugleiches Teil unter anderem Namen) mitliefern — die
  // Detailseite zeigt damit den gemeinsamen Bestand statt nur den eigenen.
  const poolPartner = artikel.poolPartnerId
    ? await prisma.artikel.findUnique({
        where:  { id: artikel.poolPartnerId },
        select: { id: true, bezeichnung: true, bestand: true },
      })
    : null;

  return {
    ...artikel,
    verfuegbar:         artikel.bestand > 0,
    kompatibileGeraete: artikel.kompatibel.map((k) => k.geraet),
    poolPartner,
    poolBestand:        artikel.bestand + (poolPartner?.bestand ?? 0),
  };
}

export type ArtikelFilter = {
  search?:     string;
  kategorie?:  string;
  lagerplatz?: string;
  bestand?:    "alle" | "vorhanden" | "leer" | "kritisch";
  sortBy?:     "bezeichnung" | "bestand" | "kategorie" | "updatedAt";
  sortOrder?:  "asc" | "desc";
  page?:       number;
  limit?:      number;
  standortId?: number | null;
};

/**
 * Alle Artikel für Admin-Übersicht mit Filter, Sortierung und Pagination.
 */
export async function getAlleArtikel(input?: ArtikelFilter) {
  const limit  = input?.limit ?? 50;
  const page   = input?.page  ?? 1;
  const offset = (page - 1) * limit;

  const where: Record<string, unknown> = {};

  if (input?.standortId != null) where.standortId = input.standortId;

  if (input?.search) {
    where.OR = [
      { bezeichnung: { contains: input.search } },
      { lagerplatz:  { contains: input.search } },
    ];
  }
  if (input?.kategorie)  where.kategorie  = input.kategorie;
  if (input?.lagerplatz) where.lagerplatz = input.lagerplatz;

  if (input?.bestand === "vorhanden") where.bestand = { gt: 0 };
  if (input?.bestand === "leer")      where.bestand = 0;
  if (input?.bestand === "kritisch")  where.bestand = { gt: 0, lt: 3 };

  const sortBy    = input?.sortBy    ?? "bezeichnung";
  const sortOrder = input?.sortOrder ?? "asc";
  const orderBy   = { [sortBy]: sortOrder };

  const [artikel, total] = await Promise.all([
    prisma.artikel.findMany({ where, orderBy, take: limit, skip: offset }),
    prisma.artikel.count({ where }),
  ]);

  return {
    artikel,
    total,
    pages:   Math.ceil(total / limit),
    page,
    hasMore: offset + limit < total,
  };
}

/**
 * Alle einzigartigen Lagerplätze (für Filter-Dropdown).
 */
export async function getLagerplaetze(): Promise<string[]> {
  const result = await prisma.artikel.findMany({
    where:    { lagerplatz: { not: null } },
    select:   { lagerplatz: true },
    distinct: ["lagerplatz"],
    orderBy:  { lagerplatz: "asc" },
  });
  return result.map((r) => r.lagerplatz!).filter(Boolean);
}

/**
 * Neuen Artikel anlegen.
 */
export async function createArtikel(data: {
  bezeichnung: string;
  kategorie:   string;
  lagerplatz?: string;
  standortId?: number;
}) {
  const artikel = await prisma.artikel.create({
    data: { ...data, bestand: 0, standortId: data.standortId ?? 1 },
  });
  meilisearchSync.artikel(artikel.id);
  return artikel;
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

  const result = await prisma.artikel.update({ where: { id }, data });
  meilisearchSync.artikel(id);
  return result;
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
  meilisearchSync.deleteArtikel(id);
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
