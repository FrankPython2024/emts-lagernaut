import { z } from "zod";
import { createTRPCRouter, adminProcedure, permissionProcedure } from "@/server/trpc";
import {
  getBestellempfehlung,
  getTop5Bestellempfehlung,
  getBestellungenZuKombination,
  erfasseBestellung,
  aktualisiereBestellung,
  loescheBestellung,
} from "@/modules/bestellung/service";
import { protokolliereAktivitaet } from "@/modules/activity/service";
import { emitToAdmins } from "@/modules/realtime/socket";
import { EVENTS } from "@/modules/realtime/events";
import type { SessionUser } from "@/core/types";

// Lesen: ADMIN + BETRACHTER (via ANFRAGE_VIEW_ALL — die Auswertung leitet sich
// aus den Anfragen ab). Schreiben: nur ADMIN (adminProcedure).
const leseProcedure = permissionProcedure("ANFRAGE_VIEW_ALL");

export const bestellempfehlungRouter = createTRPCRouter({

  // Hauptauswertung (alle / nur offene)
  list: leseProcedure
    .input(z.object({ nurOffen: z.boolean().default(false) }).optional())
    .query(({ input }) => getBestellempfehlung({ nurOffen: input?.nurOffen ?? false })),

  // Top 5 offene Empfehlungen — Dashboard-Widget
  top5: leseProcedure.query(() => getTop5Bestellempfehlung()),

  // Bestell-Historie einer Kombination
  bestellungenZuKombination: leseProcedure
    .input(z.object({ modellName: z.string().min(1), teiltyp: z.string().min(1) }))
    .query(({ input }) => getBestellungenZuKombination(input.modellName, input.teiltyp)),

  // ── Schreib-Operationen (nur ADMIN) ─────────────────────────────────────────

  bestellungErfassen: adminProcedure
    .input(z.object({
      modellName: z.string().min(1).max(500),
      hersteller: z.string().max(191).optional(),
      teiltyp:    z.string().min(1).max(191),
      anzahl:     z.number().int().positive(),
      bestelltAm: z.date(),
      notiz:      z.string().max(2000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const user = ctx.session.user as SessionUser;
      const b = await erfasseBestellung({ ...input, erstelltVon: user.kuerzel });

      protokolliereAktivitaet({
        akteur: user.kuerzel,
        text:   `hat ${b.anzahl}x ${b.teiltyp} für ${b.modellName} als extern bestellt erfasst`,
      });
      emitToAdmins(EVENTS.BESTELLUNG_ERFASST, { id: b.id, modellName: b.modellName, teiltyp: b.teiltyp });
      return b;
    }),

  bestellungAktualisieren: adminProcedure
    .input(z.object({
      id:         z.number().int().positive(),
      anzahl:     z.number().int().positive(),
      bestelltAm: z.date(),
      notiz:      z.string().max(2000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const user = ctx.session.user as SessionUser;
      const b = await aktualisiereBestellung(input);

      protokolliereAktivitaet({
        akteur: user.kuerzel,
        text:   `hat eine externe Bestellung aktualisiert: ${b.anzahl}x ${b.teiltyp} für ${b.modellName}`,
      });
      emitToAdmins(EVENTS.BESTELLUNG_AKTUALISIERT, { id: b.id, modellName: b.modellName, teiltyp: b.teiltyp });
      return b;
    }),

  bestellungLoeschen: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const user = ctx.session.user as SessionUser;
      const b = await loescheBestellung(input.id);

      protokolliereAktivitaet({
        akteur: user.kuerzel,
        text:   `hat eine externe Bestellung gelöscht: ${b.anzahl}x ${b.teiltyp} für ${b.modellName}`,
      });
      emitToAdmins(EVENTS.BESTELLUNG_GELOESCHT, { id: b.id, modellName: b.modellName, teiltyp: b.teiltyp });
      return { id: b.id };
    }),

});
