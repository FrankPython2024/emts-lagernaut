import { z } from "zod";
import { createTRPCRouter, protectedProcedure, adminProcedure, permissionProcedure } from "@/server/trpc";

// Read-Procedure für Artikel (BETRACHTER bekommt ARTIKEL_VIEW).
const artikelReadProcedure = permissionProcedure("ARTIKEL_VIEW");
import { standortWhere, resolveStandortId } from "@/lib/auth/standortFilter";
import { verknuepfePool, loesePool } from "@/lib/artikel/pool";
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

  // Suche mit Lagerplatz — ARTIKEL_VIEW (BETRACHTER read-only)
  searchAdmin: artikelReadProcedure
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

  // Alle Artikel mit Filter + Pagination — ARTIKEL_VIEW
  getAll: artikelReadProcedure
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

  // Artikel per ID — mit Lagerplatz — ARTIKEL_VIEW
  getByIdAdmin: artikelReadProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(({ input }) =>
      getArtikelMitLagerplatz(input.id),
    ),

  // ── Ersatzteil-Pool ────────────────────────────────────────────────────────
  // Zwei baugleiche Artikel (typisch: Füße vorne ↔ hinten) teilen sich einen
  // Bestand. Details siehe lib/artikel/pool.ts.

  // Mögliche Partner für einen Pool.
  //
  // ACHTUNG — hier lag ein Denkfehler: `Artikel.kategorie` IST der Teiltyp
  // („Füße vorne" / „Füße hinten"). Auf gleiche Kategorie zu filtern schließt
  // also genau das Gegenstück aus, das man verknüpfen will.
  // Richtig ist der Filter über das GERÄT: `bezeichnung` = "<Gerät> <Teiltyp>",
  // also Teiltyp hinten abschneiden und nach dem Rest suchen.
  // `suche` überschreibt das, falls die Bezeichnung mal vom Muster abweicht.
  poolKandidaten: artikelReadProcedure
    .input(z.object({
      artikelId: z.number().int().positive(),
      suche:     z.string().max(100).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const artikel = await ctx.prisma.artikel.findUnique({
        where:  { id: input.artikelId },
        select: { id: true, bezeichnung: true, kategorie: true, standortId: true },
      });
      if (!artikel) return [];

      const suche = input.suche?.trim();
      // Gerätename = Bezeichnung ohne den angehängten Teiltyp
      const geraet = artikel.bezeichnung.endsWith(artikel.kategorie)
        ? artikel.bezeichnung.slice(0, -artikel.kategorie.length).trim()
        : "";

      return ctx.prisma.artikel.findMany({
        where: {
          id:         { not: artikel.id },
          standortId: artikel.standortId,
          ...(suche
            ? { bezeichnung: { contains: suche } }
            : geraet
              ? { bezeichnung: { startsWith: geraet } }
              : {}),
        },
        select:  { id: true, bezeichnung: true, bestand: true, poolPartnerId: true },
        orderBy: { bezeichnung: "asc" },
        take:    200,
      });
    }),

  poolVerknuepfen: adminProcedure
    .input(z.object({
      artikelId: z.number().int().positive(),
      partnerId: z.number().int().positive(),
    }))
    .mutation(({ input }) => verknuepfePool(input.artikelId, input.partnerId)),

  poolLoesen: adminProcedure
    .input(z.object({ artikelId: z.number().int().positive() }))
    .mutation(({ input }) => loesePool(input.artikelId)),

  // Alle Kategorien
  getKategorien: protectedProcedure
    .query(() => getKategorien()),

  // Alle Lagerplätze (für Filter-Dropdown) — ARTIKEL_VIEW
  getLagerplaetze: artikelReadProcedure
    .query(() => getLagerplaetze()),

  // Neuen Artikel anlegen — Admin
  create: adminProcedure
    .input(z.object({
      bezeichnung: z.string().min(1).max(255),
      kategorie:   z.string().min(1).max(100),
      lagerplatz:  z.string().max(50).optional(),
      standortId:  z.number().int().positive().optional(),
      // Einzelpreis gleich beim Anlegen — spart den zweiten Weg über die
      // Detailseite, wenn viele Varianten erfasst werden (Festplatten, RAM).
      preis:       z.number().min(0).max(1_000_000).nullable().optional(),
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
      // Einzelpreis — schlägt den Kategoriepreis. null setzt ihn wieder zurück
      // auf „Kategoriepreis verwenden".
      preis:       z.number().min(0).max(1_000_000).nullable().optional(),
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
