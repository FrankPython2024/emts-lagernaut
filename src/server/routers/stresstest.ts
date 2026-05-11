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

  // Vollständiger Status + letzte 100 Events (Polling-Fallback wenn Socket nicht klappt)
  getStatus: adminProcedure
    .query(() => {
      const s = getState();
      return {
        running:      isRunning(),
        state:        s,
        recentEvents: s?.recentEvents ?? [],
      };
    }),

  // Alle Fehler des laufenden/letzten Tests mit Stack-Traces
  getErrors: adminProcedure
    .query(() => getErrors()),

  cleanup: adminProcedure
    .input(z.object({ runId: z.string().optional() }))
    .mutation(async ({ input }) => {
      return cleanupTestData(input.runId);
    }),

});
