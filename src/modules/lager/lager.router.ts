import { createTRPCRouter, publicProcedure, protectedProcedure, adminProcedure } from "@/server/trpc";
import {
  ArtikelSucheSchema,
  ArtikelByIdSchema,
  ArtikelListeSchema,
  ArtikelErstellenSchema,
  ArtikelAktualisierenSchema,
} from "./lager.schema";
import {
  sucheArtikel,
  sucheArtikelAdmin,
  getArtikelById,
  getArtikelListe,
  erstelleArtikel,
  aktualisiereArtikel,
  getKategorien,
} from "./lager.service";

export const lagerRouter = createTRPCRouter({

  // Suche ohne Lagerplatz — Techniker-Portal
  suche: protectedProcedure
    .input(ArtikelSucheSchema)
    .query(async ({ input }) => {
      return sucheArtikel(input);
    }),

  // Suche mit Lagerplatz — nur Admin
  sucheAdmin: adminProcedure
    .input(ArtikelSucheSchema)
    .query(async ({ input }) => {
      return sucheArtikelAdmin(input);
    }),

  // Einzelner Artikel per ID
  byId: protectedProcedure
    .input(ArtikelByIdSchema)
    .query(async ({ input }) => {
      return getArtikelById(input.id);
    }),

  // Artikel-Liste (Admin)
  liste: adminProcedure
    .input(ArtikelListeSchema)
    .query(async ({ input }) => {
      return getArtikelListe(input);
    }),

  // Alle Kategorien
  kategorien: protectedProcedure
    .query(async () => {
      return getKategorien();
    }),

  // Artikel anlegen (Admin)
  erstellen: adminProcedure
    .input(ArtikelErstellenSchema)
    .mutation(async ({ input }) => {
      return erstelleArtikel(input);
    }),

  // Artikel aktualisieren (Admin)
  aktualisieren: adminProcedure
    .input(ArtikelAktualisierenSchema)
    .mutation(async ({ input }) => {
      return aktualisiereArtikel(input);
    }),

});
