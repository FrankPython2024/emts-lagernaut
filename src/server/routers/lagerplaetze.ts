import { z } from "zod";
import { createTRPCRouter, adminProcedure } from "@/server/trpc";
import {
  getAlleLagerplaetze,
  getBereiche,
  getLagerplatzById,
  createLagerplatz,
  updateLagerplatz,
  deactivateLagerplatz,
  verschiebeArtikel,
  verschiebeAlle,
} from "@/modules/lagerplaetze/service";

export const lagerplaetzeRouter = createTRPCRouter({

  // Alle Lagerplätze mit Artikel-Anzahl
  getAll: adminProcedure
    .input(z.object({
      bereich:   z.string().optional(),
      nurAktive: z.boolean().default(false),
    }).optional())
    .query(({ input }) => getAlleLagerplaetze(input)),

  // Alle Bereiche für Filter-Dropdown
  getBereiche: adminProcedure
    .query(() => getBereiche()),

  // Lagerplatz per ID mit Artikeln
  getById: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(({ input }) => getLagerplatzById(input.id)),

  // Neuen Lagerplatz anlegen
  create: adminProcedure
    .input(z.object({
      code:         z.string().min(1).max(50),
      beschreibung: z.string().max(255).optional(),
      bereich:      z.string().max(100).optional(),
    }))
    .mutation(({ input }) => createLagerplatz(input)),

  // Lagerplatz aktualisieren
  update: adminProcedure
    .input(z.object({
      id:           z.number().int().positive(),
      beschreibung: z.string().max(255).nullable().optional(),
      bereich:      z.string().max(100).nullable().optional(),
      aktiv:        z.boolean().optional(),
    }))
    .mutation(({ input }) => {
      const { id, ...data } = input;
      return updateLagerplatz(id, data);
    }),

  // Deaktivieren — nur wenn leer
  deactivate: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ input }) => deactivateLagerplatz(input.id)),

  // Einzelnen Artikel verschieben
  verschiebeArtikel: adminProcedure
    .input(z.object({
      artikelId:        z.number().int().positive(),
      vonLagerplatzId:  z.number().int().positive(),
      nachLagerplatzId: z.number().int().positive(),
      mitarbeiter:      z.string().min(1).max(50),
    }))
    .mutation(({ input }) => verschiebeArtikel(input)),

  // Alle Artikel eines Lagerplatzes verschieben
  verschiebeAlle: adminProcedure
    .input(z.object({
      vonLagerplatzId:  z.number().int().positive(),
      nachLagerplatzId: z.number().int().positive(),
      mitarbeiter:      z.string().min(1).max(50),
    }))
    .mutation(({ input }) => verschiebeAlle(input)),

});
