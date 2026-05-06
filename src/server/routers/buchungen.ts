import { z } from "zod";
import { BuchungsTyp } from "@prisma/client";
import { createTRPCRouter, protectedProcedure, adminProcedure } from "@/server/trpc";
import {
  bucheLager,
  getBuchungsListe,
  syncAlleBestaende,
} from "@/modules/buchungen/service";

export const buchungenRouter = createTRPCRouter({

  // Neue Buchung erstellen — EINGANG / AUSGANG / DIREKT
  create: protectedProcedure
    .input(z.object({
      artikelId:   z.number().int().positive(),
      menge:       z.number().int().positive(),
      typ:         z.nativeEnum(BuchungsTyp),
      mitarbeiter: z.string().min(1).max(50),
      notiz:       z.string().max(500).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const buchung = await bucheLager(input);
      const artikel = await ctx.prisma.artikel.findUnique({
        where:  { id: input.artikelId },
        select: { bestand: true },
      });
      return { ...buchung, neuerBestand: artikel?.bestand ?? 0 };
    }),

  // Buchungshistorie — mit Filter
  getAll: protectedProcedure
    .input(z.object({
      artikelId: z.number().int().positive().optional(),
      typ:       z.nativeEnum(BuchungsTyp).optional(),
      von:       z.date().optional(),
      bis:       z.date().optional(),
      limit:     z.number().int().min(1).max(100).default(50),
      offset:    z.number().int().min(0).default(0),
    }).optional())
    .query(({ input }) =>
      getBuchungsListe({
        limit:  50,
        offset: 0,
        ...input,
      }),
    ),

  // Buchungen für einen Artikel
  getByArtikel: protectedProcedure
    .input(z.object({
      artikelId: z.number().int().positive(),
      limit:     z.number().int().min(1).max(100).default(20),
      offset:    z.number().int().min(0).default(0),
    }))
    .query(({ input }) =>
      getBuchungsListe({
        artikelId: input.artikelId,
        limit:     input.limit,
        offset:    input.offset,
      }),
    ),

  // Alle Bestände neu berechnen — nur Admin
  syncAlleBestaende: adminProcedure
    .mutation(() => syncAlleBestaende()),

});
