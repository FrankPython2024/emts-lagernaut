import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure, adminProcedure } from "@/server/trpc";
import { prisma }                from "@/core/db/prisma";
import { queues }                from "@/modules/jobs/worker";
import { STANDARD_TEILTYPEN }   from "@/lib/constants/teiltypen";
import type { SessionUser }      from "@/core/types";

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
      const [total, letzter] = await Promise.all([
        prisma.geraeteLookup.count(),
        prisma.geraeteLookup.findFirst({
          orderBy: { updatedAt: "desc" },
          select:  { updatedAt: true },
        }),
      ]);
      return { total, letzterImport: letzter?.updatedAt ?? null };
    }),

  // ── Artikel-Generator ──────────────────────────────────────────────────────

  // Vorschau: Modell-Anzahl + bereits existierende Artikel
  getArtikelGeneratorPreview: adminProcedure
    .query(async () => {
      const [lookups, existingArtikel] = await Promise.all([
        prisma.geraeteLookup.findMany({
          where:    { bereinigt: { not: "" } },
          select:   { bereinigt: true },
          distinct: ["bereinigt"],
        }),
        prisma.artikel.count(),
      ]);
      return {
        modelle:        lookups.length,
        existingArtikel,
        teile:          STANDARD_TEILTYPEN.length,
        erwartet:       lookups.length * STANDARD_TEILTYPEN.length,
      };
    }),

  // Generator starten — BullMQ Job einreihen
  generiereArtikelFuerAlleModelle: adminProcedure
    .mutation(async ({ ctx }) => {
      const user = ctx.session!.user as SessionUser;

      // Bereits laufenden Job prüfen
      const aktive = await queues.artikelGenerator.getJobs(["active", "waiting"]);
      if (aktive.length > 0) {
        throw new TRPCError({ code: "CONFLICT", message: "Artikel-Generator läuft bereits." });
      }

      const lookups = await prisma.geraeteLookup.findMany({
        where:    { bereinigt: { not: "" } },
        select:   { bereinigt: true },
        distinct: ["bereinigt"],
      });
      const modelle  = lookups.length;
      const teile    = STANDARD_TEILTYPEN.length;
      const erwartet = modelle * teile;

      const job = await queues.artikelGenerator.add(
        "generate-alle",
        { initiatedBy: user.kuerzel },
        { removeOnComplete: false, removeOnFail: false, attempts: 1 },
      );

      console.log(`[ArtikelGen] Job #${job.id} gestartet von ${user.kuerzel} — ${modelle} Modelle × ${teile} Teile`);
      return { jobId: job.id!, modelle, teile, erwartet };
    }),

  // Job-Status (für UI-Polling alle 2 Sekunden)
  getArtikelGeneratorStatus: adminProcedure
    .input(z.object({ jobId: z.string().min(1) }))
    .query(async ({ input }) => {
      const job = await queues.artikelGenerator.getJob(input.jobId);
      if (!job) return null;

      const state    = await job.getState();
      const progress = job.progress as Record<string, unknown> | number | null;

      return {
        state,
        progress,
        result:       (job.returnvalue ?? null) as {
          totalModels: number; artikelCreated: number; artikelSkipped: number
        } | null,
        failedReason: job.failedReason ?? null,
      };
    }),

});
