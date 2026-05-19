import { z } from "zod";
import { createTRPCRouter, protectedProcedure, adminProcedure } from "@/server/trpc";
import { standortWhere, resolveStandortId } from "@/lib/auth/standortFilter";
import type { SessionUser } from "@/core/types";
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
    .query(({ input, ctx }) => {
      const sId = (ctx.session.user as SessionUser).standortId;
      return sucheArtikel(input.query, sId);
    }),

  // Suche mit Lagerplatz — nur Admin
  searchAdmin: adminProcedure
    .input(z.object({
      query:      z.string().min(1).max(200),
      limit:      z.number().int().min(1).max(50).default(20),
      offset:     z.number().int().min(0).default(0),
      standortId: z.number().int().positive().nullish(),
    }))
    .query(({ input, ctx }) => {
      const sId = standortWhere(ctx, input.standortId).standortId as number | undefined;
      return sucheArtikelAdmin({ ...input, standortId: sId ?? null });
    }),

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
      standortId: z.number().int().positive().nullish(),
    }).optional())
    .query(({ input, ctx }) => {
      const filter = standortWhere(ctx, input?.standortId);
      return getAlleArtikel({ ...input, standortId: (filter.standortId as number | undefined) ?? null });
    }),

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
      standortId:  z.number().int().positive().optional(),
    }))
    .mutation(({ input, ctx }) => {
      const standortId = resolveStandortId(ctx, input.standortId);
      return createArtikel({ ...input, standortId });
    }),

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
