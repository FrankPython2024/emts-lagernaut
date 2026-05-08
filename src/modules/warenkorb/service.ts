import { KorbStatus } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { prisma } from "@/core/db/prisma";
import { erstelleAnfrage } from "@/modules/anfragen/service";

/**
 * Aktiven Warenkorb eines Technikers abrufen (null wenn keiner existiert).
 */
export async function getAktiv(techniker: string) {
  return prisma.warenkorb.findFirst({
    where: {
      techniker: techniker.toUpperCase().trim(),
      status:    KorbStatus.AKTIV,
    },
    include: {
      items: {
        include: {
          artikel: {
            select: { id: true, bezeichnung: true, kategorie: true, bestand: true },
          },
        },
      },
    },
  });
}

/**
 * Item zum Warenkorb hinzufügen.
 * artikelId kann null sein (ZUSTAND C: kein Artikel verknüpft).
 * In diesem Fall wird nur der teiltyp gespeichert.
 */
export async function addItem(data: {
  techniker:    string;
  logId:        string;
  geraeteName?: string;
  artikelId:    number | null;
  teiltyp?:     string;
  grading?:     string;
  zusatzinfo?:  string;
}) {
  const techniker = data.techniker.toUpperCase().trim();
  const logId     = data.logId.trim();

  // Artikel nur prüfen wenn vorhanden
  if (data.artikelId) {
    const artikel = await prisma.artikel.findUnique({
      where:  { id: data.artikelId },
      select: { id: true },
    });
    if (!artikel) {
      throw new TRPCError({ code: "NOT_FOUND", message: `Artikel ${data.artikelId} nicht gefunden.` });
    }
  }

  return prisma.$transaction(async (tx) => {
    let korb = await tx.warenkorb.findFirst({
      where: { techniker, logId, status: KorbStatus.AKTIV },
    });

    if (!korb) {
      korb = await tx.warenkorb.create({
        data: { techniker, logId, geraeteName: data.geraeteName, status: KorbStatus.AKTIV },
      });
    }

    const item = await tx.warenkorbItem.create({
      data: {
        korbId:     korb.id,
        artikelId:  data.artikelId,
        teiltyp:    data.teiltyp,
        grading:    data.grading ?? "A+",
        zusatzinfo: data.zusatzinfo,
      },
      include: {
        artikel: { select: { id: true, bezeichnung: true, kategorie: true, bestand: true } },
      },
    });

    return { korb, item };
  });
}

/**
 * Item aus dem Warenkorb entfernen.
 */
export async function removeItem(itemId: number): Promise<void> {
  const item = await prisma.warenkorbItem.findUnique({ where: { id: itemId } });
  if (!item) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Warenkorb-Item nicht gefunden." });
  }
  await prisma.warenkorbItem.delete({ where: { id: itemId } });
}

/**
 * Warenkorb absenden — erstellt Anfragen für alle Items.
 *
 * Generiert gruppenNr im Format: YYYY-MM-DD-KUERZEL-NNN
 * Verknüpft alle Anfragen mit gruppenNr + korbId.
 * Setzt Warenkorb auf ABGESENDET.
 */
export async function submit(data: {
  korbId:      number;
  zusatzinfo?: string;
}): Promise<{ anzahl: number; gruppenNr: string }> {
  const korb = await prisma.warenkorb.findUnique({
    where:   { id: data.korbId },
    include: {
      items: {
        include: {
          artikel: { select: { id: true, kategorie: true, bezeichnung: true } },
        },
      },
    },
  });

  if (!korb) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Warenkorb nicht gefunden." });
  }

  if (korb.status !== KorbStatus.AKTIV) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Warenkorb wurde bereits abgesendet." });
  }

  if (korb.items.length === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Warenkorb ist leer." });
  }

  // gruppenNr generieren: YYYY-MM-DD-KUERZEL-NNN
  const heute = new Date();
  const datumStr = heute.toISOString().slice(0, 10); // YYYY-MM-DD

  const heuteStart = new Date(datumStr);
  const heuteEnde  = new Date(heuteStart);
  heuteEnde.setDate(heuteEnde.getDate() + 1);

  const anzahlHeute = await prisma.anfrage.count({
    where: {
      techniker:  korb.techniker,
      gruppenNr:  { not: null },
      datum:      { gte: heuteStart, lt: heuteEnde },
    },
  });

  const seq      = String(Math.floor(anzahlHeute / korb.items.length) + 1).padStart(3, "0");
  const gruppenNr = `${datumStr}-${korb.techniker}-${seq}`;

  // Anfragen für alle Items erstellen
  // item.artikelId kann null sein (ZUSTAND C) → Status BEDARF
  await Promise.all(
    korb.items.map((item) =>
      erstelleAnfrage({
        techniker:   korb.techniker,
        logId:       korb.logId,
        geraeteName: korb.geraeteName ?? undefined,
        geraet:      korb.geraeteName ?? korb.logId,
        artikelId:   item.artikelId,
        teil:        item.teiltyp ?? item.artikel?.kategorie ?? "Unbekannt",
        grading:     item.grading,
        kommentar:   item.zusatzinfo ?? data.zusatzinfo,
        gruppenNr,
        korbId:      korb.id,
      }),
    ),
  );

  // Warenkorb auf ABGESENDET setzen
  await prisma.warenkorb.update({
    where: { id: korb.id },
    data:  { status: KorbStatus.ABGESENDET },
  });

  return { anzahl: korb.items.length, gruppenNr };
}
