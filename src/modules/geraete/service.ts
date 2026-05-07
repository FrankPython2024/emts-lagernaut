import { TRPCError } from "@trpc/server";
import { prisma } from "@/core/db/prisma";

// Standard-Teile die bei jedem neuen Modell angelegt werden (aus code.gs: neuesModellAnlegen)
const STANDARD_TEILE = [
  "Displaymodul",
  "Tastatur",
  "Touchpad",
  "Füße vorne",
  "Füße hinten",
  "D Cover",
  "USB Board",
  "Power Button",
  "Lautsprecher",
  "Lüfter",
  "Thermalmodul",
  "BIOS Batterie",
  "Akku",
] as const;

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
  const geraetVoll      = `${herstellerClean} ${modellClean}`;

  const result = await prisma.$transaction(async (tx) => {
    // Gerätemodell anlegen oder finden
    const neuesModell = await tx.geraeteModell.upsert({
      where:  { hersteller_modell: { hersteller: herstellerClean, modell: modellClean } },
      create: { hersteller: herstellerClean, modell: modellClean },
      update: {},
    });

    const angelegtTeile: ModellAnlegenResult["angelegtTeile"] = [];

    for (const teil of STANDARD_TEILE) {
      const bezeichnung = `${modellClean} ${teil}`;

      // Artikel per upsert — kein Fehler wenn bereits vorhanden
      const vorher = await tx.artikel.findUnique({
        where: { bezeichnung_kategorie: { bezeichnung, kategorie: teil } },
        select: { id: true },
      });

      const artikel = vorher ?? await tx.artikel.create({
        data: { bezeichnung, kategorie: teil, lagerplatz: null, bestand: 0 },
      });

      // Kompatibilitätseintrag upsert
      await tx.kompatibilitaet.upsert({
        where:  { geraet_teiltyp: { geraet: geraetVoll, teiltyp: teil } },
        create: { geraet: geraetVoll, teiltyp: teil, artikelId: artikel.id },
        update: {},
      });

      angelegtTeile.push({ artikelId: artikel.id, bezeichnung, teiltyp: teil, neu: !vorher });
    }

    return { modell: neuesModell, angelegtTeile };
  });

  return result;
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
  return prisma.geraeteModell.update({ where: { id }, data: { aktiv } });
}
