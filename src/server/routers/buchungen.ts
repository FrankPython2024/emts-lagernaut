import { z } from "zod";
import { BuchungsTyp } from "@prisma/client";
import { createTRPCRouter, adminProcedure, permissionProcedure } from "@/server/trpc";
import type { SessionUser } from "@/core/types";

// Read-Procedure für Buchungs-Historie (BETRACHTER bekommt BUCHUNG_VIEW).
const buchungReadProcedure = permissionProcedure("BUCHUNG_VIEW");
import { standortWhere } from "@/lib/auth/standortFilter";
import {
  bucheLager,
  getBuchungsListe,
  syncAlleBestaende,
  aktualisiereBuchung,
  loescheBuchung,
} from "@/modules/buchungen/service";
import { naechsteBelegNr } from "@/core/infra/belegnr";

export const buchungenRouter = createTRPCRouter({

  // Neue Buchung — EINGANG / AUSGANG / DIREKT — schreibt Bestand → ADMIN only
  // (gleiche Schreib-Grenze wie update/delete/syncAlleBestaende). Blockt damit
  // serverseitig BETRACHTER / ADMIN_READONLY / PICKUP / TECHNIKER.
  // EINGANG → EL-YYYY-NNNN + artikel (lagerplatz, kategorie) für Einlagerbeleg
  // AUSGANG → AL-YYYY-NNNN + artikel für Auslagerbeleg
  // DIREKT  → belegNr = null (kein Beleg)
  create: adminProcedure
    .input(z.object({
      artikelId:   z.number().int().positive(),
      menge:       z.number().int().positive(),
      typ:         z.nativeEnum(BuchungsTyp),
      // mitarbeiter wird serverseitig aus der Session abgeleitet (nicht fälschbar);
      // ein evtl. mitgesendetes Feld wird IGNORIERT. Optional nur zur Abwärtskompat.
      mitarbeiter: z.string().max(50).optional(),
      notiz:       z.string().max(500).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // Handelnder = eingeloggter Account (Kürzel, sonst Name) — nachvollziehbar.
      const sessionUser = ctx.session.user as SessionUser;
      const mitarbeiter = (sessionUser.kuerzel || sessionUser.name || "?").slice(0, 50);
      const buchung  = await bucheLager({
        artikelId:   input.artikelId,
        menge:       input.menge,
        typ:         input.typ,
        mitarbeiter,
        notiz:       input.notiz,
      });
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

  // Buchungshistorie mit Filter — BUCHUNG_VIEW (admin-seitige Tabelle)
  getAll: buchungReadProcedure
    .input(z.object({
      artikelId:  z.number().int().positive().optional(),
      typ:        z.nativeEnum(BuchungsTyp).optional(),
      von:        z.date().optional(),
      bis:        z.date().optional(),
      limit:      z.number().int().min(1).max(200).default(50),
      offset:     z.number().int().min(0).default(0),
      standortId: z.number().int().positive().nullish(),
    }).optional())
    .query(({ input, ctx }) => {
      const sF  = standortWhere(ctx, input?.standortId);
      const sId = sF.standortId as number | undefined ?? null;
      return getBuchungsListe({ limit: 50, offset: 0, ...input, standortId: sId });
    }),

  // Buchungen für einen Artikel — BUCHUNG_VIEW (Artikel-Detail in /admin)
  getByArtikel: buchungReadProcedure
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
