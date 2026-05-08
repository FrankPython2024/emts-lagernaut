import { KorbStatus } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { prisma } from "@/core/db/prisma";
import { erstelleAnfrage } from "@/modules/anfragen/service";

// ── Shared include ──────────────────────────────────────────────────────────

const ITEMS_INCLUDE = {
  items: {
    include: {
      artikel: {
        select: { id: true, bezeichnung: true, kategorie: true, bestand: true },
      },
    },
    orderBy: { id: "asc" as const },
  },
} as const;

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Alle aktiven Warenkörbe eines Technikers (je einer pro logId).
 */
export async function getAktiv(techniker: string) {
  return prisma.warenkorb.findMany({
    where:   { techniker: techniker.toUpperCase().trim(), status: KorbStatus.AKTIV },
    include: ITEMS_INCLUDE,
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Item hinzufügen. Gibt den aktualisierten kompletten Warenkorb zurück.
 * artikelId kann null sein (ZUSTAND C: kein Artikel verknüpft).
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

  if (data.artikelId) {
    const artikel = await prisma.artikel.findUnique({
      where:  { id: data.artikelId },
      select: { id: true },
    });
    if (!artikel) {
      throw new TRPCError({ code: "NOT_FOUND", message: `Artikel ${data.artikelId} nicht gefunden.` });
    }
  }

  const korbId = await prisma.$transaction(async (tx) => {
    let korb = await tx.warenkorb.findFirst({
      where: { techniker, logId, status: KorbStatus.AKTIV },
    });

    if (!korb) {
      korb = await tx.warenkorb.create({
        data: { techniker, logId, geraeteName: data.geraeteName, status: KorbStatus.AKTIV },
      });
    }

    await tx.warenkorbItem.create({
      data: {
        korbId:     korb.id,
        artikelId:  data.artikelId,
        teiltyp:    data.teiltyp,
        grading:    data.grading ?? "A+",
        zusatzinfo: data.zusatzinfo,
      },
    });

    return korb.id;
  });

  // Kompletten Warenkorb zurückgeben
  return prisma.warenkorb.findUnique({
    where:   { id: korbId },
    include: ITEMS_INCLUDE,
  });
}

/**
 * Item entfernen.
 */
export async function removeItem(itemId: number): Promise<void> {
  const item = await prisma.warenkorbItem.findUnique({ where: { id: itemId } });
  if (!item) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Warenkorb-Item nicht gefunden." });
  }
  await prisma.warenkorbItem.delete({ where: { id: itemId } });

  // Leeren Warenkorb automatisch löschen
  const remaining = await prisma.warenkorbItem.count({ where: { korbId: item.korbId } });
  if (remaining === 0) {
    await prisma.warenkorb.delete({ where: { id: item.korbId } });
  }
}

/**
 * Einen Warenkorb absenden → erstellt Anfragen, löscht danach Korb + Items.
 * Kein ABGESENDET-Status — Korb wird komplett gelöscht (kein Unique-Konflikt).
 */
export async function submit(data: {
  korbId:      number;
  zusatzinfo?: string;
}): Promise<{ anzahl: number; gruppenNr: string }> {
  const korb = await prisma.warenkorb.findUnique({
    where:   { id: data.korbId },
    include: { items: { include: { artikel: { select: { id: true, kategorie: true, bezeichnung: true } } } } },
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

  // GruppenNr generieren
  const datumStr   = new Date().toISOString().slice(0, 10);
  const heuteStart = new Date(datumStr);
  const heuteEnde  = new Date(heuteStart);
  heuteEnde.setDate(heuteEnde.getDate() + 1);

  const anzahlHeute = await prisma.anfrage.count({
    where: { techniker: korb.techniker, gruppenNr: { not: null }, datum: { gte: heuteStart, lt: heuteEnde } },
  });

  const seq      = String(Math.floor(anzahlHeute / korb.items.length) + 1).padStart(3, "0");
  const gruppenNr = `${datumStr}-${korb.techniker}-${seq}`;

  await Promise.all(
    korb.items.map((item) =>
      erstelleAnfrage({
        techniker:   korb.techniker,
        logId:       korb.logId,
        geraeteName: korb.geraeteName ?? undefined,
        geraet:      korb.geraeteName ?? (korb.logId !== "unbekannt" ? korb.logId : "Unbekannt"),
        artikelId:   item.artikelId,
        teil:        item.teiltyp ?? item.artikel?.kategorie ?? "Unbekannt",
        grading:     item.grading,
        kommentar:   item.zusatzinfo ?? data.zusatzinfo,
        gruppenNr,
        korbId:      korb.id,
      }),
    ),
  );

  // Korb + Items löschen (kein ABGESENDET → kein Unique-Konflikt bei Neuanlage)
  await prisma.warenkorbItem.deleteMany({ where: { korbId: korb.id } });
  await prisma.warenkorb.delete({ where: { id: korb.id } });

  return { anzahl: korb.items.length, gruppenNr };
}

/**
 * Alle aktiven Körbe eines Technikers auf einmal absenden.
 */
export async function submitAlle(data: {
  techniker:   string;
  zusatzinfo?: string;
}): Promise<{ anzahl: number; gruppenNrs: string[] }> {
  const techniker = data.techniker.toUpperCase().trim();
  const koerbe    = await prisma.warenkorb.findMany({
    where:   { techniker, status: KorbStatus.AKTIV },
    select:  { id: true, items: { select: { id: true } } },
  });

  const mitItems = koerbe.filter((k) => k.items.length > 0);
  if (mitItems.length === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Warenkorb ist leer." });
  }

  let totalAnzahl  = 0;
  const gruppenNrs: string[] = [];

  for (const korb of mitItems) {
    const result = await submit({ korbId: korb.id, zusatzinfo: data.zusatzinfo });
    totalAnzahl += result.anzahl;
    gruppenNrs.push(result.gruppenNr);
  }

  return { anzahl: totalAnzahl, gruppenNrs };
}
