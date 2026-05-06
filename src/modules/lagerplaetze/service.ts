import { TRPCError } from "@trpc/server";
import { prisma } from "@/core/db/prisma";

/**
 * Alle einzigartigen Lagerplätze mit Artikel-Anzahl.
 * Arbeitet direkt auf dem Artikel.lagerplatz String-Feld — kein eigenes Model.
 */
export async function getAlleLagerplaetze(filter?: { bereich?: string }) {
  const gruppen = await prisma.artikel.groupBy({
    by:      ["lagerplatz"],
    where:   { lagerplatz: { not: null } },
    _count:  { lagerplatz: true },
    orderBy: { lagerplatz: "asc" },
  });

  const result = gruppen
    .filter((g) => g.lagerplatz !== null)
    .map((g) => ({
      lagerplatz:   g.lagerplatz!,
      artikelAnzahl: g._count.lagerplatz,
      bereich:      erkenneBereiche(g.lagerplatz!),
    }));

  if (filter?.bereich) {
    return result.filter((r) => r.bereich === filter.bereich);
  }

  return result;
}

/**
 * Alle einzigartigen Bereiche (für Filter-Dropdown).
 */
export async function getBereiche(): Promise<string[]> {
  const alle = await getAlleLagerplaetze();
  return [...new Set(alle.map((l) => l.bereich))].sort();
}

/**
 * Lagerplatz-Details: alle Artikel mit diesem Lagerplatz-String.
 */
export async function getLagerplatzDetails(code: string) {
  const artikel = await prisma.artikel.findMany({
    where:   { lagerplatz: code },
    select:  { id: true, bezeichnung: true, kategorie: true, bestand: true },
    orderBy: { bezeichnung: "asc" },
  });

  return { code, bereich: erkenneBereiche(code), artikel };
}

/**
 * Einzelnen Artikel auf neuen Lagerplatz verschieben.
 * Erstellt DIREKT-Buchung als Audit-Trail (kein Bestandseinfluss).
 */
export async function verschiebeArtikel(input: {
  artikelId:     number;
  neuerLagerplatz: string;
  mitarbeiter:   string;
}) {
  const artikel = await prisma.artikel.findUnique({
    where:  { id: input.artikelId },
    select: { id: true, bezeichnung: true, lagerplatz: true },
  });

  if (!artikel) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Artikel nicht gefunden." });
  }

  const alterLagerplatz = artikel.lagerplatz ?? "–";
  const notiz = `Verschiebung von ${alterLagerplatz} nach ${input.neuerLagerplatz}`;

  await prisma.$transaction(async (tx) => {
    await tx.artikel.update({
      where: { id: artikel.id },
      data:  { lagerplatz: input.neuerLagerplatz },
    });

    // DIREKT-Buchung = 2 Einträge (Eingang + Ausgang), Netto 0 → kein Bestandseinfluss
    await tx.buchung.createMany({
      data: [
        { artikelId: artikel.id, bezeichnung: artikel.bezeichnung, typ: "EINGANG", menge: 1, mitarbeiter: input.mitarbeiter, notiz },
        { artikelId: artikel.id, bezeichnung: artikel.bezeichnung, typ: "AUSGANG", menge: 1, mitarbeiter: input.mitarbeiter, notiz },
      ],
    });
  });

  return { success: true, von: alterLagerplatz, nach: input.neuerLagerplatz };
}

/**
 * ALLE Artikel eines Lagerplatzes verschieben.
 */
export async function verschiebeAlle(input: {
  alterLagerplatz:  string;
  neuerLagerplatz:  string;
  mitarbeiter:      string;
}) {
  if (input.alterLagerplatz === input.neuerLagerplatz) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Quell- und Ziel-Lagerplatz sind identisch." });
  }

  const artikel = await prisma.artikel.findMany({
    where:  { lagerplatz: input.alterLagerplatz },
    select: { id: true, bezeichnung: true },
  });

  if (!artikel.length) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Lagerplatz '${input.alterLagerplatz}' ist leer.` });
  }

  const notiz = `Verschiebung von ${input.alterLagerplatz} nach ${input.neuerLagerplatz}`;

  await prisma.$transaction(async (tx) => {
    await tx.artikel.updateMany({
      where: { lagerplatz: input.alterLagerplatz },
      data:  { lagerplatz: input.neuerLagerplatz },
    });

    const buchungen = artikel.flatMap((a) => [
      { artikelId: a.id, bezeichnung: a.bezeichnung, typ: "EINGANG" as const, menge: 1, mitarbeiter: input.mitarbeiter, notiz },
      { artikelId: a.id, bezeichnung: a.bezeichnung, typ: "AUSGANG" as const, menge: 1, mitarbeiter: input.mitarbeiter, notiz },
    ]);
    await tx.buchung.createMany({ data: buchungen });
  });

  return { success: true, verschoben: artikel.length, von: input.alterLagerplatz, nach: input.neuerLagerplatz };
}

// Bereich aus Code-Präfix erkennen
function erkenneBereiche(code: string): string {
  const prefix = code.split("-")[0]?.toUpperCase() ?? "";
  const map: Record<string, string> = { HP: "HP", L: "Lenovo", D: "Dell", A: "Acer" };
  return map[prefix] ?? "Sonstiges";
}
