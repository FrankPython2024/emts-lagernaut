import { z } from "zod";
import { BuchungsTyp } from "@prisma/client";
import { createTRPCRouter, protectedProcedure, adminProcedure } from "@/server/trpc";
import {
  bucheLager,
  getBuchungsListe,
  syncAlleBestaende,
  aktualisiereBuchung,
  loescheBuchung,
} from "@/modules/buchungen/service";
import { naechsteBelegNr } from "@/core/infra/belegnr";

export const buchungenRouter = createTRPCRouter({

  // Neue Buchung — EINGANG / AUSGANG / DIREKT
  // EINGANG → EL-YYYY-NNNN + artikel (lagerplatz, kategorie) für Einlagerbeleg
  // AUSGANG → AL-YYYY-NNNN + artikel für Auslagerbeleg
  // DIREKT  → belegNr = null (kein Beleg)
  create: protectedProcedure
    .input(z.object({
      artikelId:   z.number().int().positive(),
      menge:       z.number().int().positive(),
      typ:         z.nativeEnum(BuchungsTyp),
      mitarbeiter: z.string().min(1).max(50),
      notiz:       z.string().max(500).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const buchung  = await bucheLager(input);
      const artikel  = await ctx.prisma.artikel.findUnique({
        where:  { id: input.artikelId },
        select: { bestand: true, bezeichnung: true, lagerplatz: true, kategorie: true },
      });
      const belegNr =
        input.typ === BuchungsTyp.EINGANG ? await naechsteBelegNr("EL") :
        input.typ === BuchungsTyp.AUSGANG ? await naechsteBelegNr("AL") :
        null;
      return {
        ...buchung,
        neuerBestand: artikel?.bestand ?? 0,
        belegNr,
        artikel: {
          bezeichnung: artikel?.bezeichnung ?? buchung.bezeichnung,
          lagerplatz:  artikel?.lagerplatz  ?? null,
          kategorie:   artikel?.kategorie   ?? "",
        },
      };
    }),

  // Buchung bearbeiten — nur Menge + Notiz, Typ NIE änderbar — Admin only
  update: adminProcedure
    .input(z.object({
      id:    z.number().int().positive(),
      menge: z.number().int().positive(),
      notiz: z.string().max(500).optional().nullable(),
    }))
    .mutation(async ({ input }) => {
      const neuerBestand = await aktualisiereBuchung(input.id, {
        menge: input.menge,
        notiz: input.notiz,
      });
      return { neuerBestand };
    }),

  // Buchung löschen — Bestand wird neu berechnet — Admin only
  delete: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const neuerBestand = await loescheBuchung(input.id);
      return { neuerBestand };
    }),

  // Buchungshistorie mit Filter
  getAll: protectedProcedure
    .input(z.object({
      artikelId: z.number().int().positive().optional(),
      typ:       z.nativeEnum(BuchungsTyp).optional(),
      von:       z.date().optional(),
      bis:       z.date().optional(),
      limit:     z.number().int().min(1).max(200).default(50),
      offset:    z.number().int().min(0).default(0),
    }).optional())
    .query(({ input }) =>
      getBuchungsListe({ limit: 50, offset: 0, ...input }),
    ),

  // Buchungen für einen Artikel
  getByArtikel: protectedProcedure
    .input(z.object({
      artikelId: z.number().int().positive(),
      limit:     z.number().int().min(1).max(100).default(20),
      offset:    z.number().int().min(0).default(0),
    }))
    .query(({ input }) =>
      getBuchungsListe({ artikelId: input.artikelId, limit: input.limit, offset: input.offset }),
    ),

  // Alle Bestände neu berechnen — Admin only
  syncAlleBestaende: adminProcedure
    .mutation(() => syncAlleBestaende()),

});
