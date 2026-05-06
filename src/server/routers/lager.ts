import { z } from "zod";
import { createTRPCRouter, protectedProcedure, adminProcedure } from "@/server/trpc";
import {
  sucheArtikel,
  sucheArtikelAdmin,
  getArtikelById,
  getArtikelMitLagerplatz,
  getAlleArtikel,
  createArtikel,
  updateArtikel,
  deleteArtikel,
  getKategorien,
  getLagerplaetze,
} from "@/modules/lager/service";

export const lagerRouter = createTRPCRouter({

  // Suche ohne Lagerplatz — Techniker-Portal
  search: protectedProcedure
    .input(z.object({
      query:  z.string().min(1).max(200),
      limit:  z.number().int().min(1).max(50).default(20),
      offset: z.number().int().min(0).default(0),
    }))
    .query(({ input }) =>
      sucheArtikel(input.query),
    ),

  // Suche mit Lagerplatz — nur Admin
  searchAdmin: adminProcedure
    .input(z.object({
      query:  z.string().min(1).max(200),
      limit:  z.number().int().min(1).max(50).default(20),
      offset: z.number().int().min(0).default(0),
    }))
    .query(({ input }) =>
      sucheArtikelAdmin(input),
    ),

  // Alle Artikel mit Filter + Pagination — Admin
  getAll: adminProcedure
    .input(z.object({
      search:     z.string().optional(),
      kategorie:  z.string().optional(),
      lagerplatz: z.string().optional(),
      bestand:    z.enum(["alle", "vorhanden", "leer", "kritisch"]).optional(),
      sortBy:     z.enum(["bezeichnung", "bestand", "kategorie", "updatedAt"]).optional(),
      sortOrder:  z.enum(["asc", "desc"]).optional(),
      page:       z.number().int().min(1).default(1),
      limit:      z.number().int().min(1).max(200).default(50),
    }).optional())
    .query(({ input }) =>
      getAlleArtikel(input),
    ),

  // Artikel per ID — ohne Lagerplatz (Techniker-Portal)
  getById: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(({ input }) =>
      getArtikelById(input.id),
    ),

  // Artikel per ID — mit Lagerplatz (nur Admin)
  getByIdAdmin: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(({ input }) =>
      getArtikelMitLagerplatz(input.id),
    ),

  // Alle Kategorien
  getKategorien: protectedProcedure
    .query(() => getKategorien()),

  // Alle Lagerplätze (für Filter-Dropdown)
  getLagerplaetze: adminProcedure
    .query(() => getLagerplaetze()),

  // Neuen Artikel anlegen — Admin
  create: adminProcedure
    .input(z.object({
      bezeichnung: z.string().min(1).max(255),
      kategorie:   z.string().min(1).max(100),
      lagerplatz:  z.string().max(50).optional(),
    }))
    .mutation(({ input }) =>
      createArtikel(input),
    ),

  // Artikel aktualisieren — Admin
  update: adminProcedure
    .input(z.object({
      id:          z.number().int().positive(),
      bezeichnung: z.string().min(1).max(255).optional(),
      kategorie:   z.string().min(1).max(100).optional(),
      lagerplatz:  z.string().max(50).nullable().optional(),
    }))
    .mutation(({ input }) => {
      const { id, ...data } = input;
      return updateArtikel(id, data);
    }),

  // Artikel löschen — Admin, nur wenn Bestand = 0
  delete: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ input }) =>
      deleteArtikel(input.id),
    ),

});
