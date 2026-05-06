import { createTRPCRouter, protectedProcedure, adminProcedure } from "@/server/trpc";
import {
  AnfrageErstellenSchema,
  AnfrageListeTechnikerSchema,
  AnfrageListeAdminSchema,
  AnfrageStorniereSchema,
  AnfrageStatusSetzenSchema,
} from "./anfragen.schema";
import {
  erstelleAnfrage,
  getAnfragenFuerTechniker,
  getAnfragenAdmin,
  storniereAnfrage,
  setzeAnfrageStatus,
} from "./anfragen.service";

export const anfragenRouter = createTRPCRouter({

  // Neue Anfrage erstellen (Techniker-Portal)
  erstellen: protectedProcedure
    .input(AnfrageErstellenSchema)
    .mutation(async ({ input }) => {
      return erstelleAnfrage(input);
    }),

  // Eigene Anfragen des Technikers
  meineAnfragen: protectedProcedure
    .input(AnfrageListeTechnikerSchema)
    .query(async ({ input }) => {
      return getAnfragenFuerTechniker(input);
    }),

  // Alle Anfragen (Admin)
  alleAnfragen: adminProcedure
    .input(AnfrageListeAdminSchema)
    .query(async ({ input }) => {
      return getAnfragenAdmin(input);
    }),

  // Anfrage stornieren (Techniker: nur eigene, nur NEU/BEDARF)
  stornieren: protectedProcedure
    .input(AnfrageStorniereSchema)
    .mutation(async ({ input }) => {
      return storniereAnfrage(input);
    }),

  // Status setzen (Admin)
  statusSetzen: adminProcedure
    .input(AnfrageStatusSetzenSchema)
    .mutation(async ({ input }) => {
      return setzeAnfrageStatus(input);
    }),

});
