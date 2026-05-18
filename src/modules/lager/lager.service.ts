import { TRPCError } from "@trpc/server";
import { prisma } from "@/core/db/prisma";
import { meilisearchSync } from "@/core/infra/meilisearchSync";
import type {
  ArtikelErstellenInput,
  ArtikelAktualisierenInput,
  ArtikelSucheInput,
} from "./lager.schema";

/**
 * Artikel per ID abrufen — mit kompatiblen Geräten.
 * Entspricht getBestand() aus code.gs.
 */
export async function getArtikelById(id: number) {
  const artikel = await prisma.artikel.findUnique({
    where:   { id },
    include: {
      kompatibel: { select: { geraet: true, teiltyp: true } },
    },
  });

  if (!artikel) {
    throw new TRPCError({
      code:    "NOT_FOUND",
      message: `Artikel ${id} nicht gefunden.`,
    });
  }

  return {
    ...artikel,
    verfuegbar: artikel.bestand > 0,
    kompatibileGeraete: artikel.kompatibel.map((k) => k.geraet),
  };
}

/**
 * Globale Volltextsuche über Bezeichnung, Kategorie und Kompatibilitäts-Geräte.
 * Entspricht sucheGlobal() aus code.gs.
 * Lagerplatz wird NICHT zurückgegeben — nur im Admin-Bereich sichtbar.
 */
export async function sucheArtikel(input: ArtikelSucheInput) {
  const q = input.q.trim();

  // Suche in Artikel-Bezeichnung und Kategorie
  const direktTreffer = await prisma.artikel.findMany({
    where: {
      OR: [
        { bezeichnung: { contains: q } },
        { kategorie:   { contains: q } },
      ],
    },
    include: {
      kompatibel: { select: { geraet: true } },
    },
    take:  input.limit,
    skip:  input.offset,
  });

  // Suche über Kompatibilitäts-Gerätenamen (z.B. "HP 840 G5")
  const kompTreffer = await prisma.kompatibilitaet.findMany({
    where: { geraet: { contains: q } },
    include: {
      artikel: {
        include: { kompatibel: { select: { geraet: true } } },
      },
    },
    take: input.limit,
  });

  // Zusammenführen, Duplikate entfernen
  const alleIds  = new Set(direktTreffer.map((a) => a.id));
  const combined = [...direktTreffer];

  for (const k of kompTreffer) {
    if (!alleIds.has(k.artikel.id)) {
      alleIds.add(k.artikel.id);
      combined.push(k.artikel);
    }
  }

  return combined.slice(0, input.limit).map((a) => ({
    id:          a.id,
    bezeichnung: a.bezeichnung,
    kategorie:   a.kategorie,
    bestand:     a.bestand,
    verfuegbar:  a.bestand > 0,
    // Lagerplatz bewusst weggelassen — kein Techniker-Portal Zugriff
    kompatibel:  a.kompatibel.map((k) => k.geraet),
  }));
}

/**
 * Suchergebnis MIT Lagerplatz — nur für Admin-Bereich.
 */
export async function sucheArtikelAdmin(input: ArtikelSucheInput) {
  const treffer = await sucheArtikel(input);
  const ids     = treffer.map((t) => t.id);

  const mitLagerplatz = await prisma.artikel.findMany({
    where: { id: { in: ids } },
    select: { id: true, lagerplatz: true },
  });

  const lagerMap = new Map(mitLagerplatz.map((a) => [a.id, a.lagerplatz]));

  return treffer.map((t) => ({
    ...t,
    lagerplatz: lagerMap.get(t.id) ?? null,
  }));
}

/**
 * Artikel-Liste für Admin (mit Lagerplatz, Pagination).
 */
export async function getArtikelListe(input: {
  kategorie?: string;
  limit:      number;
  offset:     number;
}) {
  const where = input.kategorie ? { kategorie: input.kategorie } : {};

  const [artikel, total] = await Promise.all([
    prisma.artikel.findMany({
      where,
      orderBy: { bezeichnung: "asc" },
      take:    input.limit,
      skip:    input.offset,
    }),
    prisma.artikel.count({ where }),
  ]);

  return { artikel, total, hasMore: input.offset + input.limit < total };
}

/**
 * Neuen Artikel anlegen.
 */
export async function erstelleArtikel(input: ArtikelErstellenInput) {
  const artikel = await prisma.artikel.create({
    data: {
      bezeichnung: input.bezeichnung,
      kategorie:   input.kategorie,
      lagerplatz:  input.lagerplatz,
      bestand:     0,
    },
  });
  meilisearchSync.artikel(artikel.id);
  return artikel;
}

/**
 * Artikel aktualisieren (Admin).
 */
export async function aktualisiereArtikel(input: ArtikelAktualisierenInput) {
  const { id, ...data } = input;

  const artikel = await prisma.artikel.findUnique({ where: { id } });
  if (!artikel) {
    throw new TRPCError({ code: "NOT_FOUND", message: `Artikel ${id} nicht gefunden.` });
  }

  const result = await prisma.artikel.update({
    where: { id },
    data:  {
      ...(data.bezeichnung !== undefined && { bezeichnung: data.bezeichnung }),
      ...(data.kategorie   !== undefined && { kategorie:   data.kategorie }),
      ...(data.lagerplatz  !== undefined && { lagerplatz:  data.lagerplatz }),
    },
  });
  meilisearchSync.artikel(id);
  return result;
}

/**
 * Alle vorhandenen Kategorien auflisten (für Filter-Dropdowns).
 */
export async function getKategorien(): Promise<string[]> {
  const result = await prisma.artikel.findMany({
    select:   { kategorie: true },
    distinct: ["kategorie"],
    orderBy:  { kategorie: "asc" },
  });
  return result.map((r) => r.kategorie);
}
