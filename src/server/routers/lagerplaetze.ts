import { z } from "zod";
import { createTRPCRouter, adminProcedure, protectedProcedure } from "@/server/trpc";
import {
  getAlleLagerplaetze,
  getBereiche,
  getLagerplatzDetails,
  createLagerplatz,
  verschiebeArtikel,
  verschiebeAlle,
} from "@/modules/lagerplaetze/service";

export const lagerplaetzeRouter = createTRPCRouter({

  // Alle Lagerplätze (distinct Strings) mit Artikel-Anzahl
  getAll: protectedProcedure
    .input(z.object({ bereich: z.string().optional() }).optional())
    .query(({ input }) => getAlleLagerplaetze(input)),

  // Alle Bereiche für Filter-Dropdown
  getBereiche: protectedProcedure
    .query(() => getBereiche()),

  // Neuen Lagerplatz manuell anlegen — Admin
  create: adminProcedure
    .input(z.object({
      code:         z.string().min(1).max(50),
      beschreibung: z.string().max(255).optional(),
      bereich:      z.string().max(100).optional(),
    }))
    .mutation(({ input }) => createLagerplatz(input)),

  // Lagerplatz-Details: alle Artikel mit diesem Code
  getByCode: protectedProcedure
    .input(z.object({ code: z.string().min(1) }))
    .query(({ input }) => getLagerplatzDetails(input.code)),

  // Einzelnen Artikel verschieben — Admin
  verschiebeArtikel: adminProcedure
    .input(z.object({
      artikelId:      z.number().int().positive(),
      neuerLagerplatz: z.string().min(1).max(50),
      mitarbeiter:    z.string().min(1).max(50),
    }))
    .mutation(({ input }) => verschiebeArtikel(input)),

  // Alle Artikel eines Lagerplatzes verschieben — Admin
  verschiebeAlle: adminProcedure
    .input(z.object({
      alterLagerplatz: z.string().min(1).max(50),
      neuerLagerplatz: z.string().min(1).max(50),
      mitarbeiter:     z.string().min(1).max(50),
    }))
    .mutation(({ input }) => verschiebeAlle(input)),

});
