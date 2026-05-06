import { TRPCError } from "@trpc/server";
import { prisma } from "@/core/db/prisma";

export type LagerplatzCreateData = {
  code:         string;
  beschreibung?: string;
  bereich?:     string;
};

/**
 * Alle Lagerplätze mit Artikel-Anzahl.
 */
export async function getAlleLagerplaetze(input?: { bereich?: string; nurAktive?: boolean }) {
  const where = {
    ...(input?.bereich    && { bereich: input.bereich }),
    ...(input?.nurAktive  && { aktiv: true }),
  };

  const lagerplaetze = await prisma.lagerplatz.findMany({
    where,
    orderBy: { code: "asc" },
    include: { _count: { select: { artikel: true } } },
  });

  return lagerplaetze.map((l) => ({
    ...l,
    artikelAnzahl: l._count.artikel,
  }));
}

/**
 * Alle einzigartigen Bereiche (für Filter-Dropdown).
 */
export async function getBereiche(): Promise<string[]> {
  const result = await prisma.lagerplatz.findMany({
    where:    { bereich: { not: null } },
    select:   { bereich: true },
    distinct: ["bereich"],
    orderBy:  { bereich: "asc" },
  });
  return result.map((r) => r.bereich!).filter(Boolean);
}

/**
 * Lagerplatz per ID mit allen Artikeln.
 */
export async function getLagerplatzById(id: number) {
  const lagerplatz = await prisma.lagerplatz.findUnique({
    where:   { id },
    include: {
      artikel: {
        select: {
          id: true, bezeichnung: true, kategorie: true, bestand: true,
        },
        orderBy: { bezeichnung: "asc" },
      },
    },
  });

  if (!lagerplatz) {
    throw new TRPCError({ code: "NOT_FOUND", message: `Lagerplatz ${id} nicht gefunden.` });
  }

  return lagerplatz;
}

/**
 * Neuen Lagerplatz anlegen.
 */
export async function createLagerplatz(data: LagerplatzCreateData) {
  const code = data.code.toUpperCase().trim();

  const bestehendes = await prisma.lagerplatz.findUnique({ where: { code } });
  if (bestehendes) {
    throw new TRPCError({
      code:    "CONFLICT",
      message: `Lagerplatz '${code}' existiert bereits.`,
    });
  }

  return prisma.lagerplatz.create({
    data: {
      code,
      beschreibung: data.beschreibung?.trim() || null,
      bereich:      data.bereich?.trim()      || null,
    },
  });
}

/**
 * Lagerplatz aktualisieren.
 */
export async function updateLagerplatz(
  id:   number,
  data: Partial<{ beschreibung: string | null; bereich: string | null; aktiv: boolean }>,
) {
  const lp = await prisma.lagerplatz.findUnique({ where: { id } });
  if (!lp) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Lagerplatz nicht gefunden." });
  }

  return prisma.lagerplatz.update({ where: { id }, data });
}

/**
 * Lagerplatz deaktivieren — nur wenn keine Artikel drin.
 */
export async function deactivateLagerplatz(id: number): Promise<void> {
  const lp = await prisma.lagerplatz.findUnique({
    where:   { id },
    include: { _count: { select: { artikel: true } } },
  });

  if (!lp) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Lagerplatz nicht gefunden." });
  }

  if (lp._count.artikel > 0) {
    throw new TRPCError({
      code:    "BAD_REQUEST",
      message: `Lagerplatz '${lp.code}' hat noch ${lp._count.artikel} Artikel. Bitte zuerst verschieben.`,
    });
  }

  await prisma.lagerplatz.update({ where: { id }, data: { aktiv: false } });
}

/**
 * Einzelnen Artikel auf anderen Lagerplatz verschieben.
 * Erstellt DIREKT-Buchung als Audit-Trail.
 */
export async function verschiebeArtikel(input: {
  artikelId:        number;
  vonLagerplatzId:  number;
  nachLagerplatzId: number;
  mitarbeiter:      string;
}) {
  const [artikel, von, nach] = await Promise.all([
    prisma.artikel.findUnique({ where: { id: input.artikelId }, select: { id: true, bezeichnung: true, lagerplatzId: true } }),
    prisma.lagerplatz.findUnique({ where: { id: input.vonLagerplatzId },  select: { id: true, code: true } }),
    prisma.lagerplatz.findUnique({ where: { id: input.nachLagerplatzId }, select: { id: true, code: true } }),
  ]);

  if (!artikel) throw new TRPCError({ code: "NOT_FOUND",   message: "Artikel nicht gefunden." });
  if (!von)     throw new TRPCError({ code: "NOT_FOUND",   message: "Quell-Lagerplatz nicht gefunden." });
  if (!nach)    throw new TRPCError({ code: "NOT_FOUND",   message: "Ziel-Lagerplatz nicht gefunden." });

  if (input.vonLagerplatzId === input.nachLagerplatzId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Quell- und Ziel-Lagerplatz sind identisch." });
  }

  await prisma.$transaction(async (tx) => {
    // Artikel-Relation + String aktualisieren
    await tx.artikel.update({
      where: { id: artikel.id },
      data:  { lagerplatzId: nach.id, lagerplatz: nach.code },
    });

    // DIREKT-Buchung als Audit-Trail (keine Bestandsänderung)
    const notiz = `Verschiebung von ${von.code} nach ${nach.code}`;
    await tx.buchung.createMany({
      data: [
        { artikelId: artikel.id, bezeichnung: artikel.bezeichnung, typ: "EINGANG", menge: 1, mitarbeiter: input.mitarbeiter, notiz },
        { artikelId: artikel.id, bezeichnung: artikel.bezeichnung, typ: "AUSGANG", menge: 1, mitarbeiter: input.mitarbeiter, notiz },
      ],
    });
  });

  return { success: true, von: von.code, nach: nach.code };
}

/**
 * ALLE Artikel eines Lagerplatzes auf einen anderen verschieben.
 */
export async function verschiebeAlle(input: {
  vonLagerplatzId:  number;
  nachLagerplatzId: number;
  mitarbeiter:      string;
}) {
  const [von, nach] = await Promise.all([
    prisma.lagerplatz.findUnique({
      where:   { id: input.vonLagerplatzId },
      include: { artikel: { select: { id: true, bezeichnung: true } } },
    }),
    prisma.lagerplatz.findUnique({ where: { id: input.nachLagerplatzId }, select: { id: true, code: true } }),
  ]);

  if (!von)  throw new TRPCError({ code: "NOT_FOUND", message: "Quell-Lagerplatz nicht gefunden." });
  if (!nach) throw new TRPCError({ code: "NOT_FOUND", message: "Ziel-Lagerplatz nicht gefunden." });
  if (input.vonLagerplatzId === input.nachLagerplatzId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Quell- und Ziel-Lagerplatz sind identisch." });
  }
  if (!von.artikel.length) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Lagerplatz '${von.code}' ist leer.` });
  }

  const notiz = `Verschiebung von ${von.code} nach ${nach.code}`;

  await prisma.$transaction(async (tx) => {
    // Alle Artikel aktualisieren
    await tx.artikel.updateMany({
      where: { lagerplatzId: von.id },
      data:  { lagerplatzId: nach.id, lagerplatz: nach.code },
    });

    // Buchungen für alle Artikel
    const buchungen = von.artikel.flatMap((a) => [
      { artikelId: a.id, bezeichnung: a.bezeichnung, typ: "EINGANG" as const, menge: 1, mitarbeiter: input.mitarbeiter, notiz },
      { artikelId: a.id, bezeichnung: a.bezeichnung, typ: "AUSGANG" as const, menge: 1, mitarbeiter: input.mitarbeiter, notiz },
    ]);
    await tx.buchung.createMany({ data: buchungen });
  });

  return { success: true, verschoben: von.artikel.length, von: von.code, nach: nach.code };
}
