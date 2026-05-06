import { z } from "zod";
import { createTRPCRouter, protectedProcedure, adminProcedure } from "@/server/trpc";
import {
  getLiveStats,
  getMeistgefragteGeraete,
  getMeistgefragteTeile,
  getAnfragenNachStatus,
  getBuchungenVerlauf,
  getKpiOverview,
  getTechnikerStats,
  getMonatsbericht,
} from "@/modules/statistik/service";

const StatFilterSchema = z.object({
  von: z.date().optional(),
  bis: z.date().optional(),
});

export const statistikRouter = createTRPCRouter({

  // Live-Kennzahlen — alle eingeloggten User
  getLiveStats: protectedProcedure
    .query(() => getLiveStats()),

  // Meistgefragte Geräte — Admin
  getMeistgefragteGeraete: adminProcedure
    .input(z.object({ tage: z.number().int().min(1).max(365).default(30) }))
    .query(({ input }) =>
      getMeistgefragteGeraete(input.tage),
    ),

  // Meistgefragte Teile — Admin
  getMeistgefragteTeile: adminProcedure
    .input(z.object({ tage: z.number().int().min(1).max(365).default(30) }))
    .query(({ input }) =>
      getMeistgefragteTeile(input.tage),
    ),

  // Anfragen nach Status — Admin
  getAnfragenNachStatus: adminProcedure
    .query(() => getAnfragenNachStatus()),

  // Buchungsverlauf täglich — Admin
  getBuchungenVerlauf: adminProcedure
    .input(z.object({ tage: z.number().int().min(1).max(365).default(30) }))
    .query(({ input }) =>
      getBuchungenVerlauf(input.tage),
    ),

  // KPI-Übersicht — Admin
  getKpiOverview: adminProcedure
    .input(StatFilterSchema.optional())
    .query(({ input }) =>
      getKpiOverview(input ?? {}),
    ),

  // Techniker-Statistik — Admin
  getTechnikerStats: adminProcedure
    .input(StatFilterSchema.optional())
    .query(({ input }) =>
      getTechnikerStats(input ?? {}),
    ),

  // Monatsbericht — Admin
  getMonatsbericht: adminProcedure
    .input(z.object({
      monat: z.number().int().min(1).max(12),
      jahr:  z.number().int().min(2020).max(2100),
    }))
    .query(({ input }) =>
      getMonatsbericht(input.monat, input.jahr),
    ),

});
