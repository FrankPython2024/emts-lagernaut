import { z } from "zod";
import { createTRPCRouter, adminProcedure } from "@/server/trpc";
import {
  startRunner,
  stopRunner,
  isRunning,
  getState,
  getErrors,
  cleanupTestData,
} from "@/modules/stresstest/runner";
import { prisma } from "@/core/db/prisma";

export const stresstestRouter = createTRPCRouter({

  start: adminProcedure
    .input(z.object({
      duration:     z.number().int().min(60_000).max(3_600_000).default(300_000),
      numTechniker: z.number().int().min(1).max(10).default(5),
      numAdmins:    z.number().int().min(1).max(3).default(2),
      loadMode:     z.enum(["normal", "heavy", "burst", "extreme"]).default("burst"),
    }))
    .mutation(async ({ input }) => {
      const runId = await startRunner(input);
      return { runId };
    }),

  stop: adminProcedure
    .mutation(() => {
      stopRunner();
      return { ok: true };
    }),

  // Vollständiger Status + letzte 100 Events
  getStatus: adminProcedure
    .query(() => {
      const s = getState();
      return {
        running:      isRunning(),
        state:        s,
        recentEvents: s?.recentEvents ?? [],
      };
    }),

  // Alle Fehler mit Stack-Traces
  getErrors: adminProcedure
    .query(() => getErrors()),

  // Anzahl Test-Daten in DB (für Cleanup-Dialog)
  getTestDataCount: adminProcedure
    .query(async () => {
      const anfragen = await prisma.anfrage.count({
        where: { kommentar: { contains: "STRESSTEST" } },
      });

      const buchungen = await prisma.buchung.count({
        where: { notiz: { contains: "STRESSTEST" } },
      });

      // Chat-Nachrichten über Test-Anfrage-IDs
      let nachrichten = 0;
      if (anfragen > 0) {
        const ids = await prisma.anfrage.findMany({
          where:  { kommentar: { contains: "STRESSTEST" } },
          select: { id: true },
          take:   500,
        });
        const chatLogIds = ids.map((a) => `chat:${a.id}`);
        nachrichten = await prisma.nachricht.count({
          where: { logId: { in: chatLogIds } },
        });
      }

      return {
        anfragen,
        buchungen,
        nachrichten,
        gesamt: anfragen + buchungen + nachrichten,
      };
    }),

  cleanup: adminProcedure
    .input(z.object({ runId: z.string().optional() }))
    .mutation(async ({ input }) => {
      return cleanupTestData(input.runId);
    }),

  // Letzte 10 Test-Runs aus DB (braucht SQL-Migration für StressTestRun Tabelle)
  getHistory: adminProcedure
    .query(async () => {
      try {
        return await prisma.stressTestRun.findMany({
          orderBy: { createdAt: "desc" },
          take:    10,
          select: {
            id:           true,
            startedAt:    true,
            endedAt:      true,
            modus:        true,
            technikerAnz: true,
            adminAnz:     true,
            score:        true,
            totalOps:     true,
            fehler:       true,
            avgResponseMs: true,
            p95Ms:        true,
          },
        });
      } catch {
        // Tabelle noch nicht angelegt → leere Liste
        return [];
      }
    }),

});
