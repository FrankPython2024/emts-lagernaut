import { z } from "zod";
import { AnfrageStatus, BuchungsTyp } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure, adminProcedure } from "@/server/trpc";
import { standortWhere, getZugaenglicheStandortIds } from "@/lib/auth/standortFilter";
import {
  erstelleAnfrage,
  storniereAnfrage,
  setzeStatus,
  schliesseAnfrageAb,
  getAnfragenByTechniker,
  getAnfragenAdmin,
  getAnfragenGruppiert,
  gruppeInBearbeitungNehmen,
  gruppeFreigeben,
  gruppeZurueckgeben,
} from "@/modules/anfragen/service";
import { bucheLager, syncBestandAusHistorie } from "@/modules/buchungen/service";
import { naechsteBelegNr } from "@/core/infra/belegnr";
import { emitToAdmins, emitToUser, emitToAll } from "@/modules/realtime/socket";
import { EVENTS } from "@/modules/realtime/events";
import type { SessionUser } from "@/core/types";

export const anfragenRouter = createTRPCRouter({

  // Neue Anfrage erstellen — Techniker-Portal
  create: protectedProcedure
    .input(z.object({
      techniker:   z.string().min(1).max(50),
      logId:       z.string().min(1).max(100),
      geraeteName: z.string().max(255).optional(),
      geraet:      z.string().min(1).max(255),
      artikelId:   z.number().int().positive().nullable(),
      teil:        z.string().min(1).max(255),
      grading:     z.string().max(10).optional(),
      kommentar:   z.string().max(1000).optional(),
      gruppenNr:   z.string().max(50).optional(),
      korbId:      z.number().int().positive().optional(),
    }))
    .mutation(({ input }) => erstelleAnfrage(input)),

  // Alle Anfragen — Admin mit Filter
  getAll: adminProcedure
    .input(z.object({
      status:     z.nativeEnum(AnfrageStatus).optional(),
      techniker:  z.string().optional(),
      von:        z.date().optional(),
      bis:        z.date().optional(),
      limit:      z.number().int().min(1).max(100).default(50),
      offset:     z.number().int().min(0).default(0),
      standortId: z.number().int().positive().nullish(),
    }).optional())
    .query(({ input, ctx }) => {
      const sF = standortWhere(ctx, input?.standortId);
      const sId = sF.standortId as number | undefined ?? null;
      return getAnfragenAdmin({ limit: 50, offset: 0, ...input, standortId: sId });
    }),

  // Anfragen eines Technikers
  getByTechniker: protectedProcedure
    .input(z.object({
      kuerzel: z.string().min(1).max(50),
      showAll: z.boolean().default(false),
      limit:   z.number().int().min(1).max(1000).default(50),
      offset:  z.number().int().min(0).default(0),
    }))
    .query(({ input, ctx }) => {
      const user = ctx.session.user as SessionUser;
      if (user.rolle !== "ADMIN" && user.kuerzel.toUpperCase() !== input.kuerzel.toUpperCase()) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Nur eigene Anfragen abrufbar." });
      }
      const standortIds = getZugaenglicheStandortIds(ctx);
      return getAnfragenByTechniker({
        techniker:   input.kuerzel,
        showAll:     input.showAll,
        limit:       input.limit,
        offset:      input.offset,
        standortIds: standortIds ?? undefined,
      });
    }),

  // Anfrage stornieren — Techniker: nur eigene, nur NEU/BEDARF
  storniere: protectedProcedure
    .input(z.object({
      techniker: z.string().min(1).max(50),
      logId:     z.string().min(1).max(100),
      teil:      z.string().min(1).max(255),
    }))
    .mutation(({ input, ctx }) => {
      const user = ctx.session.user as SessionUser;
      if (user.rolle !== "ADMIN" && user.kuerzel.toUpperCase() !== input.techniker.toUpperCase()) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Nur eigene Anfragen stornierbar." });
      }
      return storniereAnfrage(input);
    }),

  // Legacy abschließen
  abschliessen: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const user   = ctx.session.user as SessionUser;
      const result = await schliesseAnfrageAb(input.id, user.kuerzel);
      const belegNr = await naechsteBelegNr("AL");
      return { ...result, belegNr };
    }),

  // ── Status setzen — Haupt-Mutation für Admin ──────────────────────────────
  setStatus: adminProcedure
    .input(z.object({
      id:     z.number().int().positive(),
      status: z.nativeEnum(AnfrageStatus),
    }))
    .mutation(async ({ input, ctx }) => {
      const user = ctx.session.user as SessionUser;

      let belegNr:     string | null = null;
      let restBestand: number | null = null;
      let artikelInfo: { bezeichnung: string; lagerplatz: string | null; kategorie: string } | null = null;

      if (input.status === AnfrageStatus.ABGESCHLOSSEN) {
        const anfrage = await ctx.prisma.anfrage.findUnique({
          where:   { id: input.id },
          include: { artikel: { select: { id: true, bezeichnung: true, lagerplatz: true, kategorie: true } } },
        });

        if (anfrage) {
          // AUSGANG-Buchung erstellen — nur wenn Artikel verknüpft und noch nicht ABGESCHLOSSEN
          if (anfrage.artikelId && anfrage.status !== AnfrageStatus.ABGESCHLOSSEN) {
            try {
              await bucheLager({
                artikelId:   anfrage.artikelId,
                menge:       anfrage.menge,
                typ:         BuchungsTyp.AUSGANG,
                mitarbeiter: user.kuerzel,
                notiz:       `Anfrage #${input.id}`,
              });
            } catch (e) {
              // "Kein Bestand" / "Nicht genug Bestand" sind erwartete Fälle (BEDARF-Anfragen)
              const msg = e instanceof Error ? e.message : String(e);
              if (!msg.includes("Kein Bestand") && !msg.includes("Nicht genug Bestand")) {
                console.error(`[setStatus] AUSGANG für Anfrage #${input.id} fehlgeschlagen: ${msg}`);
              }
            }
          }

          belegNr = await naechsteBelegNr("AL");

          // Bestand IMMER neu berechnen — robust auch wenn bucheLager übersprungen wurde.
          // syncBestandAusHistorie summiert EINGANG - AUSGANG aus der kompletten Historie,
          // ignoriert DIREKT-Buchungen und schreibt das Ergebnis in Artikel.bestand.
          if (anfrage.artikelId) {
            restBestand = await syncBestandAusHistorie(anfrage.artikelId);
            // Explizites Socket-Event damit Frontend den Bestand sofort aktualisiert
            emitToAll(EVENTS.BESTAND_UPDATED, { artikelId: anfrage.artikelId, bestand: restBestand });
          }

          if (anfrage.artikel) {
            artikelInfo = { bezeichnung: anfrage.artikel.bezeichnung, lagerplatz: anfrage.artikel.lagerplatz, kategorie: anfrage.artikel.kategorie };
          }
        }
      }

      const aktualisiert = await setzeStatus(input.id, input.status);
      return { ...aktualisiert, belegNr, restBestand, artikel: artikelInfo };
    }),

  // Gruppenansicht — Admin
  getGruppiert: adminProcedure
    .input(z.object({
      status:     z.nativeEnum(AnfrageStatus).optional(),
      techniker:  z.string().optional(),
      von:        z.date().optional(),
      bis:        z.date().optional(),
      standortId: z.number().int().positive().nullish(),
    }).optional())
    .query(({ input, ctx }) => {
      const sF = standortWhere(ctx, input?.standortId);
      const sId = sF.standortId as number | undefined ?? null;
      return getAnfragenGruppiert({ ...input, standortId: sId });
    }),

  // ── Lock-System ────────────────────────────────────────────────────────────

  // Gruppe in Bearbeitung nehmen (atomic)
  gruppeInBearbeitungNehmen: adminProcedure
    .input(z.object({ anfrageIds: z.array(z.number().int().positive()).min(1).max(50) }))
    .mutation(async ({ input, ctx }) => {
      const user = ctx.session.user as SessionUser;
      const locked = await gruppeInBearbeitungNehmen(input.anfrageIds, user.kuerzel);

      // Techniker der ersten Anfrage ermitteln für gezielte Benachrichtigung
      const anfrage = await ctx.prisma.anfrage.findFirst({
        where:  { id: { in: input.anfrageIds } },
        select: { techniker: true },
      });

      const payload = { anfrageIds: input.anfrageIds, bearbeiter: user.kuerzel, seit: new Date() };
      emitToAdmins(EVENTS.ANFRAGE_UEBERNOMMEN, payload);
      if (anfrage) emitToUser(anfrage.techniker, EVENTS.ANFRAGE_UEBERNOMMEN, payload);

      return { locked };
    }),

  // Gruppe freigeben — Fail-Safe, jeder Admin darf
  gruppeFreigeben: adminProcedure
    .input(z.object({
      anfrageIds: z.array(z.number().int().positive()).min(1).max(50),
      grund:      z.string().max(500).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const user = ctx.session.user as SessionUser;
      const { vorBearbeiter, freigegeben } = await gruppeFreigeben(input.anfrageIds, user.kuerzel, input.grund);

      const anfrage = await ctx.prisma.anfrage.findFirst({
        where:  { id: { in: input.anfrageIds } },
        select: { techniker: true },
      });

      const payload = { anfrageIds: input.anfrageIds, durch: user.kuerzel, vorBearbeiter, grund: input.grund };
      emitToAdmins(EVENTS.ANFRAGE_FREIGEGEBEN, payload);
      if (anfrage) emitToUser(anfrage.techniker, EVENTS.ANFRAGE_FREIGEGEBEN, payload);

      return { freigegeben, vorBearbeiter };
    }),

  // Gruppe zurückgeben — nur durch den Bearbeiter selbst
  gruppeZurueckgeben: adminProcedure
    .input(z.object({ anfrageIds: z.array(z.number().int().positive()).min(1).max(50) }))
    .mutation(async ({ input, ctx }) => {
      const user = ctx.session.user as SessionUser;
      const zurueck = await gruppeZurueckgeben(input.anfrageIds, user.kuerzel);

      const payload = { anfrageIds: input.anfrageIds, bearbeiter: user.kuerzel };
      emitToAdmins(EVENTS.ANFRAGE_FREIGEGEBEN, { ...payload, durch: user.kuerzel, vorBearbeiter: user.kuerzel });

      return { zurueck };
    }),

});
