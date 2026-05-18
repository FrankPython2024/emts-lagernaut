import { TRPCError } from "@trpc/server";
import { prisma } from "@/core/db/prisma";
import { getOrCreateModell } from "@/lib/geraete/getOrCreateModell";
import { STANDARD_TEILNAMEN } from "@/lib/constants/teiltypen";
import { meilisearchSync } from "@/core/infra/meilisearchSync";

export type ModellAnlegenResult = {
  modell:        { id: number; hersteller: string; modell: string };
  angelegtTeile: { artikelId: number; bezeichnung: string; teiltyp: string; neu: boolean }[];
};

/**
 * Neues Gerätemodell anlegen mit allen Standard-Ersatzteilen.
 * Entspricht neuesModellAnlegen() aus code.gs.
 *
 * Erstellt:
 * - GeraeteModell Eintrag
 * - Artikel für jedes Standard-Teil
 * - Kompatibilitaet Einträge
 */
export async function legeModellAn(
  hersteller: string,
  modell:     string,
): Promise<ModellAnlegenResult> {
  const herstellerClean = hersteller.trim();
  const modellClean     = modell.trim();

  // Sicher suchen/anlegen: kein Duplikat, bereinigter Name ohne Prefix
  const lookup = await getOrCreateModell(modellClean, herstellerClean, {
    allowCreate:     true,
    adminBestaetigt: true,
  });

  if (lookup.fehler) {
    throw new TRPCError({ code: "BAD_REQUEST", message: lookup.fehler });
  }
  if (!lookup.modell) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Modell konnte nicht angelegt werden" });
  }

  const kanonischerName = lookup.modell.modell; // z.B. "EliteBook 840 G5" (ohne Prefix)
  const neuesModell     = lookup.modell;

  const angelegtTeile = await prisma.$transaction(async (tx) => {
    const teile: ModellAnlegenResult["angelegtTeile"] = [];

    for (const teil of STANDARD_TEILNAMEN) {
      const bezeichnung = `${kanonischerName} ${teil}`;

      const vorher = await tx.artikel.findUnique({
        where: { bezeichnung_kategorie: { bezeichnung, kategorie: teil } },
        select: { id: true },
      });

      const artikel = vorher ?? await tx.artikel.create({
        data: { bezeichnung, kategorie: teil, lagerplatz: null, bestand: 0 },
      });

      // Kompatibilität mit kanonischem Namen (nicht "HP EliteBook 840 G5")
      await tx.kompatibilitaet.upsert({
        where:  { geraet_teiltyp: { geraet: kanonischerName, teiltyp: teil } },
        create: { geraet: kanonischerName, teiltyp: teil, artikelId: artikel.id },
        update: {},
      });

      teile.push({ artikelId: artikel.id, bezeichnung, teiltyp: teil, neu: !vorher });
    }

    return teile;
  });

  meilisearchSync.modell(neuesModell.id);
  for (const teil of angelegtTeile) {
    meilisearchSync.artikel(teil.artikelId);
  }

  return { modell: neuesModell, angelegtTeile };
}

/**
 * Einzelnes Ersatzteil zu einem bestehenden Modell hinzufügen.
 * Entspricht einzelteilAnlegen() aus code.gs.
 */
export async function legeEinzelteilAn(data: {
  hersteller: string;
  modell:     string;
  teiltyp:    string;
}): Promise<{ artikelId: number; bezeichnung: string }> {
  const geraetVoll  = `${data.hersteller.trim()} ${data.modell.trim()}`;
  const bezeichnung = `${data.modell.trim()} ${data.teiltyp.trim()}`;

  // Prüfen ob Kompatibilitätseintrag bereits existiert
  const bestehend = await prisma.kompatibilitaet.findUnique({
    where: { geraet_teiltyp: { geraet: geraetVoll, teiltyp: data.teiltyp.trim() } },
  });

  if (bestehend) {
    throw new TRPCError({
      code:    "CONFLICT",
      message: `Teil '${data.teiltyp}' für '${geraetVoll}' existiert bereits.`,
    });
  }

  const { artikel } = await prisma.$transaction(async (tx) => {
    const artikel = await tx.artikel.create({
      data: { bezeichnung, kategorie: data.teiltyp.trim(), bestand: 0 },
    });

    await tx.kompatibilitaet.create({
      data: { geraet: geraetVoll, teiltyp: data.teiltyp.trim(), artikelId: artikel.id },
    });

    return { artikel };
  });

  meilisearchSync.artikel(artikel.id);
  return { artikelId: artikel.id, bezeichnung };
}

/**
 * Alle Gerätemodelle auflisten.
 */
export async function getAlleModelle(nurAktive = true) {
  return prisma.geraeteModell.findMany({
    where:   nurAktive ? { aktiv: true } : {},
    orderBy: [{ hersteller: "asc" }, { modell: "asc" }],
  });
}

/**
 * Alle Gerätemodelle mit Kompatibilitäts-Anzahl — für Admin-Tabelle.
 */
export async function getAlleModelleWithKompCount(input?: {
  search?:      string;
  hersteller?:  string;
  ohneKomp?:    boolean;
  page?:        number;
  limit?:       number;
}) {
  const limit  = input?.limit ?? 50;
  const page   = input?.page  ?? 1;
  const offset = (page - 1) * limit;

  const where: Record<string, unknown> = { aktiv: true };
  if (input?.hersteller) where.hersteller = input.hersteller;
  if (input?.search) {
    where.OR = [
      { hersteller: { contains: input.search } },
      { modell:     { contains: input.search } },
    ];
  }

  const [alleModelle, total, kompCounts] = await Promise.all([
    prisma.geraeteModell.findMany({
      where,
      orderBy: [{ hersteller: "asc" }, { modell: "asc" }],
      take:    limit,
      skip:    offset,
    }),
    prisma.geraeteModell.count({ where }),
    prisma.kompatibilitaet.groupBy({ by: ["geraet"], _count: { geraet: true } }),
  ]);

  const countMap = new Map(kompCounts.map((k) => [k.geraet, k._count.geraet]));

  let modelle = alleModelle.map((m) => ({
    ...m,
    geraetVoll: `${m.hersteller} ${m.modell}`,
    kompAnzahl: countMap.get(`${m.hersteller} ${m.modell}`) ?? 0,
  }));

  if (input?.ohneKomp) modelle = modelle.filter((m) => m.kompAnzahl === 0);

  // Alle Hersteller für Filter-Dropdown
  const hersteller = [...new Set(alleModelle.map((m) => m.hersteller))].sort();

  return { modelle, total: input?.ohneKomp ? modelle.length : total, pages: Math.ceil(total / limit), page, hersteller };
}

/**
 * Alle einzigartigen Hersteller.
 */
export async function getHersteller(): Promise<string[]> {
  const result = await prisma.geraeteModell.findMany({
    where:    { aktiv: true },
    select:   { hersteller: true },
    distinct: ["hersteller"],
    orderBy:  { hersteller: "asc" },
  });
  return result.map((r) => r.hersteller);
}

/**
 * Gerätemodell aktivieren / deaktivieren.
 */
export async function setzeModellAktiv(id: number, aktiv: boolean) {
  const modell = await prisma.geraeteModell.findUnique({ where: { id } });
  if (!modell) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Gerätemodell nicht gefunden." });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.geraeteModell.update({
      where: { id },
      data:  {
        aktiv,
        deaktiviertAm:    aktiv ? null : new Date(),
        deaktiviertGrund: aktiv ? null : (modell.deaktiviertGrund ?? "Manuell deaktiviert"),
      },
    });

    // Bei Deaktivierung: Lagerplatz-Belegung aufheben (Phantom-Belegung verhindern)
    if (!aktiv) {
      await tx.lagerplatz.updateMany({
        where: { modellId: id },
        data:  { modellId: null },
      });
    }

    return result;
  });

  meilisearchSync.modell(id);
  return updated;
}
