import { z } from "zod";
import { AnfrageStatus, BuchungsTyp } from "@prisma/client";
import { createTRPCRouter, protectedProcedure, adminProcedure } from "@/server/trpc";
import {
  erstelleAnfrage,
  storniereAnfrage,
  setzeStatus,
  schliesseAnfrageAb,
  getAnfragenByTechniker,
  getAnfragenAdmin,
  getAnfragenGruppiert,
} from "@/modules/anfragen/service";
import { bucheLager } from "@/modules/buchungen/service";
import { naechsteBelegNr } from "@/core/infra/belegnr";
import type { SessionUser } from "@/core/types";

export const anfragenRouter = createTRPCRouter({

  // Neue Anfrage erstellen — Techniker-Portal
  create: protectedProcedure
    .input(z.object({
      techniker:   z.string().min(1).max(50),
      logId:       z.string().min(1).max(100),
      geraeteName: z.string().max(255).optional(),
      geraet:      z.string().min(1).max(255),
      artikelId:   z.number().int().positive(),
      teil:        z.string().min(1).max(255),
      grading:     z.string().max(10).optional(),
      kommentar:   z.string().max(1000).optional(),
      gruppenNr:   z.string().max(50).optional(),
      korbId:      z.number().int().positive().optional(),
    }))
    .mutation(({ input }) =>
      erstelleAnfrage(input),
    ),

  // Alle Anfragen — Admin mit Filter
  getAll: adminProcedure
    .input(z.object({
      status:    z.nativeEnum(AnfrageStatus).optional(),
      techniker: z.string().optional(),
      von:       z.date().optional(),
      bis:       z.date().optional(),
      limit:     z.number().int().min(1).max(100).default(50),
      offset:    z.number().int().min(0).default(0),
    }).optional())
    .query(({ input }) =>
      getAnfragenAdmin({ limit: 50, offset: 0, ...input }),
    ),

  // Anfragen eines Technikers
  getByTechniker: protectedProcedure
    .input(z.object({
      kuerzel: z.string().min(1).max(50),
      showAll: z.boolean().default(false),
      limit:   z.number().int().min(1).max(50).default(20),
      offset:  z.number().int().min(0).default(0),
    }))
    .query(({ input }) =>
      getAnfragenByTechniker({
        techniker: input.kuerzel,
        showAll:   input.showAll,
        limit:     input.limit,
        offset:    input.offset,
      }),
    ),

  // Anfrage stornieren — Techniker: nur eigene, nur NEU/BEDARF
  storniere: protectedProcedure
    .input(z.object({
      techniker: z.string().min(1).max(50),
      logId:     z.string().min(1).max(100),
      teil:      z.string().min(1).max(255),
    }))
    .mutation(({ input }) =>
      storniereAnfrage(input),
    ),

  // Anfrage abschließen (Legacy-Route — weiterhin verfügbar)
  abschliessen: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const user    = ctx.session.user as SessionUser;
      const result  = await schliesseAnfrageAb(input.id, user.kuerzel);
      const belegNr = await naechsteBelegNr("AL");
      return { ...result, belegNr };
    }),

  // ── Status setzen (Haupt-Mutation für Admin) ──────────────────────────────
  //
  // Bei ABGESCHLOSSEN:
  //   1. AUSGANG-Buchung erstellen (Bestand -1)
  //      → silently skip wenn Bestand = 0 (BEDARF-Anfragen)
  //   2. Beleg-Nr generieren (AL-YYYY-NNNN via Redis)
  //   3. Artikel-Daten für Beleg sammeln
  //   4. setzeStatus() — setzt Status, sendet System-Nachricht, synct Bestand
  //   5. Alles zurückgeben: { ...anfrage, belegNr, restBestand, artikel }
  //
  // Bei allen anderen Status:
  //   → setzeStatus() direkt, belegNr/restBestand/artikel = null
  //
  setStatus: adminProcedure
    .input(z.object({
      id:     z.number().int().positive(),
      status: z.nativeEnum(AnfrageStatus),
    }))
    .mutation(async ({ input, ctx }) => {
      const user = ctx.session.user as SessionUser;

      let belegNr:    string | null = null;
      let restBestand: number | null = null;
      let artikelInfo: {
        bezeichnung: string;
        lagerplatz:  string | null;
        kategorie:   string;
      } | null = null;

      if (input.status === AnfrageStatus.ABGESCHLOSSEN) {
        // Anfrage + Artikel für Beleg-Daten laden
        const anfrage = await ctx.prisma.anfrage.findUnique({
          where:   { id: input.id },
          include: {
            artikel: {
              select: { id: true, bezeichnung: true, lagerplatz: true, kategorie: true },
            },
          },
        });

        if (anfrage && anfrage.status !== AnfrageStatus.ABGESCHLOSSEN) {
          // AUSGANG-Buchung — bei Bestand 0 überspringen (keine Exception!)
          try {
            await bucheLager({
              artikelId:   anfrage.artikelId,
              menge:       anfrage.menge,
              typ:         BuchungsTyp.AUSGANG,
              mitarbeiter: user.kuerzel,
              notiz:       `Anfrage #${input.id}`,
            });
          } catch {
            // Kein Bestand vorhanden — Buchung überspringen, Status trotzdem setzen
          }

          // Beleg-Nr (Redis INCR, Fallback auf Timestamp)
          belegNr = await naechsteBelegNr("AL");

          // Aktuellen Bestand nach der Buchung
          const aktuell = await ctx.prisma.artikel.findUnique({
            where:  { id: anfrage.artikelId },
            select: { bestand: true },
          });
          restBestand = aktuell?.bestand ?? 0;

          artikelInfo = {
            bezeichnung: anfrage.artikel.bezeichnung,
            lagerplatz:  anfrage.artikel.lagerplatz,
            kategorie:   anfrage.artikel.kategorie,
          };
        }
      }

      // Status setzen + System-Nachricht + syncBestandAusHistorie
      const aktualisiert = await setzeStatus(input.id, input.status);

      return { ...aktualisiert, belegNr, restBestand, artikel: artikelInfo };
    }),

  // Gruppenansicht — Admin
  getGruppiert: adminProcedure
    .input(z.object({
      status:    z.nativeEnum(AnfrageStatus).optional(),
      techniker: z.string().optional(),
      von:       z.date().optional(),
      bis:       z.date().optional(),
    }).optional())
    .query(({ input }) =>
      getAnfragenGruppiert(input),
    ),

});
