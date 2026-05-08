import { AnfrageStatus } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { prisma } from "@/core/db/prisma";
import { aktualisiereBestand } from "@/modules/buchungen/buchungen.service";
import type { AnfrageErstellenInput } from "./anfragen.schema";

/**
 * Neue Ersatzteil-Anfrage vom Techniker-Portal.
 * Entspricht technikerAnfrageSubmit() aus code.gs.
 *
 * Bestand > 0 → Status NEU
 * Bestand = 0 → Status BEDARF
 */
export async function erstelleAnfrage(input: AnfrageErstellenInput) {
  const artikel = await prisma.artikel.findUnique({
    where:  { id: input.artikelId },
    select: { id: true, bezeichnung: true, kategorie: true, bestand: true },
  });

  if (!artikel) {
    throw new TRPCError({
      code:    "NOT_FOUND",
      message: `Artikel ${input.artikelId} nicht gefunden.`,
    });
  }

  // Status-Logik: Bestand > 0 → NEU, sonst BEDARF
  const status: AnfrageStatus =
    artikel.bestand > 0 ? AnfrageStatus.NEU : AnfrageStatus.BEDARF;

  const anfrage = await prisma.anfrage.create({
    data: {
      techniker:   input.techniker,
      logId:       input.logId,
      geraet:      input.geraet.toUpperCase().trim(),
      geraeteName: input.geraeteName,
      artikelId:   input.artikelId,
      teil:        artikel.kategorie,
      menge:       input.menge,
      grading:     input.grading,
      kommentar:   input.kommentar,
      gruppenNr:   input.gruppenNr,
      korbId:      input.korbId,
      status,
    },
    include: {
      artikel: { select: { id: true, bezeichnung: true, kategorie: true } },
    },
  });

  return {
    anfrage,
    meldung:
      status === AnfrageStatus.BEDARF
        ? "Bedarf wurde gemeldet."
        : "Anfrage erfolgreich! 1 Stück wurde reserviert.",
  };
}

/**
 * Anfragen eines Technikers — neueste zuerst, mit Pagination.
 * Entspricht getAnfragenFuerTechniker() aus code.gs.
 */
export async function getAnfragenFuerTechniker(input: {
  techniker: string;
  limit:     number;
  offset:    number;
}) {
  const where = { techniker: input.techniker.toUpperCase().trim() };

  const [anfragen, total] = await Promise.all([
    prisma.anfrage.findMany({
      where,
      orderBy: { datum: "desc" },
      take:    input.limit,
      skip:    input.offset,
      include: {
        artikel: { select: { id: true, bezeichnung: true, kategorie: true } },
      },
    }),
    prisma.anfrage.count({ where }),
  ]);

  return {
    anfragen,
    total,
    hasMore: input.offset + input.limit < total,
    offset:  input.offset,
  };
}

/**
 * Alle Anfragen für Admin — mit Filter, Pagination.
 */
export async function getAnfragenAdmin(input: {
  status?:    AnfrageStatus;
  techniker?: string;
  von?:       Date;
  bis?:       Date;
  limit:      number;
  offset:     number;
}) {
  const where = {
    ...(input.status    && { status: input.status }),
    ...(input.techniker && { techniker: input.techniker.toUpperCase().trim() }),
    ...(input.von || input.bis
      ? { datum: {
            ...(input.von && { gte: input.von }),
            ...(input.bis && { lte: input.bis }),
          },
        }
      : {}),
  };

  const [anfragen, total] = await Promise.all([
    prisma.anfrage.findMany({
      where,
      orderBy: { datum: "desc" },
      take:    input.limit,
      skip:    input.offset,
      include: {
        artikel: { select: { id: true, bezeichnung: true, kategorie: true, lagerplatz: true } },
      },
    }),
    prisma.anfrage.count({ where }),
  ]);

  return { anfragen, total, hasMore: input.offset + input.limit < total };
}

/**
 * Anfrage stornieren — nur bei Status NEU oder BEDARF möglich.
 * Entspricht storniereAnfrageTechniker() aus code.gs.
 *
 * Techniker darf nur eigene Anfragen stornieren.
 */
export async function storniereAnfrage(input: {
  id:        number;
  techniker: string;
}) {
  const anfrage = await prisma.anfrage.findUnique({
    where: { id: input.id },
    select: { id: true, status: true, techniker: true, artikelId: true },
  });

  if (!anfrage) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Anfrage nicht gefunden." });
  }

  // Techniker darf nur eigene Anfragen stornieren
  if (anfrage.techniker.toUpperCase() !== input.techniker.toUpperCase()) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Keine Berechtigung für diese Anfrage." });
  }

  // Nur NEU oder BEDARF können storniert werden
  const stornierbar: AnfrageStatus[] = [AnfrageStatus.NEU, AnfrageStatus.BEDARF];
  if (!stornierbar.includes(anfrage.status)) {
    throw new TRPCError({
      code:    "BAD_REQUEST",
      message: `Stornierung nicht möglich. Status: ${anfrage.status}. Nur NEU oder BEDARF kann storniert werden.`,
    });
  }

  await prisma.anfrage.update({
    where: { id: anfrage.id },
    data:  { status: AnfrageStatus.STORNIERT },
  });

  // Bestand neu berechnen nach Stornierung (nur wenn Artikel verknüpft)
  if (anfrage.artikelId) await aktualisiereBestand(anfrage.artikelId);

  return { erfolg: true, meldung: "Storniert & Bestand automatisch korrigiert." };
}

/**
 * Status einer Anfrage setzen — nur Admin.
 */
export async function setzeAnfrageStatus(input: {
  id:     number;
  status: AnfrageStatus;
}) {
  const anfrage = await prisma.anfrage.findUnique({
    where:  { id: input.id },
    select: { id: true, status: true },
  });

  if (!anfrage) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Anfrage nicht gefunden." });
  }

  return prisma.anfrage.update({
    where: { id: input.id },
    data:  { status: input.status },
    include: { artikel: { select: { id: true, bezeichnung: true } } },
  });
}
