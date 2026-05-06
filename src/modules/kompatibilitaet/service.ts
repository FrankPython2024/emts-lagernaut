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
