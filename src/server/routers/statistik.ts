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

const TageSchema = z.object({
  tage: z.number().int().min(1).max(365).default(30),
});

export const statistikRouter = createTRPCRouter({

  // Live-Kennzahlen — alle eingeloggten User
  getLiveStats: protectedProcedure
    .query(() => getLiveStats()),

  // Meistgefragte Geräte — Admin
  getMeistgefragteGeraete: adminProcedure
    .input(TageSchema)
    .query(({ input }) => getMeistgefragteGeraete(input.tage)),

  // Meistgefragte Teile — Admin
  getMeistgefragteTeile: adminProcedure
    .input(TageSchema)
    .query(({ input }) => getMeistgefragteTeile(input.tage)),

  // Anfragen nach Status — Admin
  getAnfragenNachStatus: adminProcedure
    .query(() => getAnfragenNachStatus()),

  // Buchungsverlauf täglich — Admin
  getBuchungenVerlauf: adminProcedure
    .input(TageSchema)
    .query(({ input }) => getBuchungenVerlauf(input.tage)),

  // KPI-Übersicht — Admin (tage statt Date-Objekte)
  getKpiOverview: adminProcedure
    .input(TageSchema)
    .query(({ input }) => getKpiOverview(input.tage)),

  // Techniker-Statistik — Admin
  getTechnikerStats: adminProcedure
    .input(TageSchema)
    .query(({ input }) => getTechnikerStats(input.tage)),

  // Monatsbericht — Admin
  getMonatsbericht: adminProcedure
    .input(z.object({
      monat: z.number().int().min(1).max(12),
      jahr:  z.number().int().min(2020).max(2100),
    }))
    .query(({ input }) => getMonatsbericht(input.monat, input.jahr)),

});
