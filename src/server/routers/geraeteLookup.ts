import { z } from "zod";
import { createTRPCRouter, protectedProcedure, adminProcedure } from "@/server/trpc";
import { prisma } from "@/core/db/prisma";

// Gleiche Bereinigungslogik wie Import-Script
function bereinige(bezeichnung: string): string {
  let result = bezeichnung.trim();
  let prev   = "";
  while (prev !== result) {
    prev   = result;
    result = result.replace(/\s+[A-Z0-9]{4,}[-A-Z0-9]*$/, "").trim();
  }
  return result;
}

function logIdNormalize(logId: string): string {
  return logId.replace(/\./g, "").trim();
}

// Hersteller aus bereinigt-Feld extrahieren (erstes Wort)
function extractHersteller(bereinigt: string): string {
  return bereinigt.split(" ")[0] ?? "";
}

export const geraeteLookupRouter = createTRPCRouter({

  // Gerät per LogID suchen — für Techniker-Portal
  byLogId: protectedProcedure
    .input(z.object({ logId: z.string().min(1) }))
    .query(async ({ input }) => {
      const clean = logIdNormalize(input.logId);

      // Exakter Match auf logId ODER logIdClean
      const eintrag = await prisma.geraeteLookup.findFirst({
        where: {
          OR: [
            { logId:      input.logId },
            { logIdClean: clean },
          ],
        },
      });

      if (!eintrag) return { gefunden: false as const };

      return {
        gefunden:    true as const,
        logId:       eintrag.logId,
        bereinigt:   eintrag.bereinigt,
        hersteller:  extractHersteller(eintrag.bereinigt),
      };
    }),

  // Chunk-Import für Admin-Upload (papaparse im Browser)
  importChunk: adminProcedure
    .input(z.object({
      rows: z.array(z.object({
        logId:       z.string(),
        hersteller:  z.string(),
        bezeichnung: z.string(),
      })).max(500),
    }))
    .mutation(async ({ input }) => {
      let imported = 0;
      let updated  = 0;
      let errors   = 0;

      for (const row of input.rows) {
        try {
          const logId      = row.logId.trim();
          const hersteller = row.hersteller.trim();
          const bezRaw     = row.bezeichnung.trim();

          if (!logId || !bezRaw) continue;

          const logIdClean = logIdNormalize(logId);
          const bereinigt  = hersteller
            ? `${hersteller} ${bereinige(bezRaw)}`
            : bereinige(bezRaw);

          const existing = await prisma.geraeteLookup.findUnique({ where: { logId } });

          if (existing) {
            await prisma.geraeteLookup.update({
              where: { logId },
              data:  { logIdClean, bezeichnung: bezRaw, bereinigt },
            });
            updated++;
          } else {
            await prisma.geraeteLookup.create({
              data: { logId, logIdClean, bezeichnung: bezRaw, bereinigt },
            });
            imported++;
          }
        } catch {
          errors++;
        }
      }

      return { imported, updated, errors };
    }),

  // Statistik für Admin-Dashboard
  getStats: adminProcedure
    .query(async () => {
      const total = await prisma.geraeteLookup.count();
      return { total };
    }),

});
