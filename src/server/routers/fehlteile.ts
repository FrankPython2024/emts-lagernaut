import { z } from "zod";
import { Prisma } from "@prisma/client";
import { createTRPCRouter, permissionProcedure } from "@/server/trpc";
import { prisma } from "@/core/db/prisma";
import { buildFehlteilWhere } from "@/modules/fehlteile/filter";

// Fehlteile (Verbleib = "Fehlteile") — Liste/Suche/Filter aus FehlteilStand.
// Teil von Lagerfuchs → Gating über GERAETE_REISE_VIEW. Reine Auswertung, kein
// Bestandseffekt. Fehlteile sind ALLE Artikelarten (Apple, Software, Akkus/
// Zubehör, Sonstige) — KEIN Hersteller-Filter wie im regulären Geräte-Import.

const filterInput = {
  suche:           z.string().optional(),
  geraeteart:      z.string().optional(),
  hersteller:      z.string().optional(),
  sortiment:       z.string().optional(),
  inVerbleibDurch: z.string().optional(),
  seitVon:         z.string().optional(),
  seitBis:         z.string().optional(),
};

export const fehlteileRouter = createTRPCRouter({
  // Paginierte, gefilterte Liste. Sortierung: inVerbleibSeit absteigend.
  liste: permissionProcedure("GERAETE_REISE_VIEW")
    .input(z.object({
      ...filterInput,
      page:     z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(200).default(50),
    }))
    .query(async ({ input }) => {
      const where = buildFehlteilWhere(input);
      const [rows, total] = await Promise.all([
        prisma.fehlteilStand.findMany({
          where,
          orderBy: { inVerbleibSeit: "desc" },
          skip:    (input.page - 1) * input.pageSize,
          take:    input.pageSize,
          select: {
            logId: true, seriennummer: true, hersteller: true, bezeichnung: true,
            geraeteart: true, unterart: true, aktuellerZustand: true, grading: true,
            sortiment: true, aan: true, inVerbleibSeit: true, inVerbleibDurch: true,
          },
        }),
        prisma.fehlteilStand.count({ where }),
      ]);
      return { rows, total };
    }),

  // Distinct, nicht-leere Werte (+ Anzahl) für die Filter-Dropdowns.
  filterWerte: permissionProcedure("GERAETE_REISE_VIEW").query(async () => {
    async function distinct(feld: "geraeteart" | "hersteller" | "sortiment" | "inVerbleibDurch") {
      const rows = await prisma.fehlteilStand.groupBy({
        by:     [feld],
        _count: { _all: true },
        where:  { AND: [{ [feld]: { not: null } }, { [feld]: { not: "" } }] } as Prisma.FehlteilStandWhereInput,
      });
      return rows
        .map((r) => ({ wert: (r[feld] as string | null) ?? "", anzahl: r._count._all }))
        .filter((r) => r.wert.trim() !== "")
        .sort((a, b) => b.anzahl - a.anzahl || a.wert.localeCompare(b.wert, "de", { numeric: true }));
    }
    const [geraeteart, hersteller, sortiment, inVerbleibDurch] = await Promise.all([
      distinct("geraeteart"),
      distinct("hersteller"),
      distinct("sortiment"),
      distinct("inVerbleibDurch"),
    ]);
    return { geraeteart, hersteller, sortiment, inVerbleibDurch };
  }),

  // Detail einer einzelnen Fehlteil-LogID (für das Lagerfuchs-Popup) — Zeile
  // oder null (Fehlteile liegen oft NICHT in LogIdStand).
  detail: permissionProcedure("GERAETE_REISE_VIEW")
    .input(z.object({ logId: z.string().trim().min(1).max(200) }))
    .query(async ({ input }) => {
      return prisma.fehlteilStand.findUnique({
        where:  { logId: input.logId },
        select: {
          logId: true, seriennummer: true, hersteller: true, bezeichnung: true,
          geraeteart: true, unterart: true, aktuellerZustand: true, grading: true,
          sortiment: true, aan: true, inVerbleibSeit: true, inVerbleibDurch: true, lager: true,
        },
      });
    }),

  // Kopf-Statistik: Gesamtzahl + Anzahl je Geräteart.
  kennzahlen: permissionProcedure("GERAETE_REISE_VIEW").query(async () => {
    const [gesamt, proRaw] = await Promise.all([
      prisma.fehlteilStand.count(),
      prisma.fehlteilStand.groupBy({ by: ["geraeteart"], _count: { _all: true } }),
    ]);
    const proGeraeteart = proRaw
      .map((r) => ({ geraeteart: r.geraeteart?.trim() || "ohne Angabe", anzahl: r._count._all }))
      .sort((a, b) => b.anzahl - a.anzahl);
    return { gesamt, proGeraeteart };
  }),
});
