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
  angelegtTeile: { artikelId: number; bezeichnung: string; teiltyp: string }[];
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

  // Prüfen ob Modell bereits existiert
  const bestehendes = await prisma.geraeteModell.findUnique({
    where: { hersteller_modell: { hersteller: herstellerClean, modell: modellClean } },
  });

  if (bestehendes) {
    throw new TRPCError({
      code:    "CONFLICT",
      message: `Modell '${geraetVoll}' existiert bereits (ID: ${bestehendes.id}).`,
    });
  }

  const result = await prisma.$transaction(async (tx) => {
    // Gerätemodell anlegen
    const neuesModell = await tx.geraeteModell.create({
      data: { hersteller: herstellerClean, modell: modellClean },
    });

    const angelegtTeile: ModellAnlegenResult["angelegtTeile"] = [];

    for (const teil of STANDARD_TEILE) {
      const bezeichnung = `${modellClean} ${teil}`;

      // Artikel anlegen
      const artikel = await tx.artikel.create({
        data: {
          bezeichnung,
          kategorie:  teil,
          lagerplatz: null,
          bestand:    0,
        },
      });

      // Kompatibilitätseintrag anlegen (unique: geraet + teiltyp)
      await tx.kompatibilitaet.upsert({
        where:  { geraet_teiltyp: { geraet: geraetVoll, teiltyp: teil } },
        create: { geraet: geraetVoll, teiltyp: teil, artikelId: artikel.id },
        update: {},
      });

      angelegtTeile.push({ artikelId: artikel.id, bezeichnung, teiltyp: teil });
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
 * Gerätemodell aktivieren / deaktivieren.
 */
export async function setzeModellAktiv(id: number, aktiv: boolean) {
  const modell = await prisma.geraeteModell.findUnique({ where: { id } });
  if (!modell) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Gerätemodell nicht gefunden." });
  }
  return prisma.geraeteModell.update({ where: { id }, data: { aktiv } });
}
