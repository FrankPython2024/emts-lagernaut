import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc";
import {
  getByAnfrage,
  getTechnikerVonAnfrage,
  senden,
  markGelesen,
  getUngelesenCount,
  getUngelesenProAnfrage,
  getStatsForAnfrage,
  getStatsBatch,
  ADMIN_EMPF,
} from "@/modules/chat/service";
import { emitToUser, emitToAdmins } from "@/modules/realtime/socket";
import { EVENTS }                   from "@/modules/realtime/events";
import { prisma }                   from "@/core/db/prisma";
import type { SessionUser }          from "@/core/types";

// ── Security: Admin darf alles, Techniker nur eigene Anfragen ─────────────────

async function checkAccess(user: SessionUser, anfrageId: number) {
  if (user.rolle === "ADMIN") return;
  const anfrage = await prisma.anfrage.findUnique({
    where:  { id: anfrageId },
    select: { techniker: true },
  });
  if (!anfrage || anfrage.techniker.toUpperCase() !== user.kuerzel.toUpperCase()) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Kein Zugriff auf diesen Chat." });
  }
}

// ── Router ─────────────────────────────────────────────────────────────────────

export const chatRouter = createTRPCRouter({

  // Alle Nachrichten einer Anfrage (chronologisch) → für ChatModal
  getByAnfrage: protectedProcedure
    .input(z.object({ anfrageId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const user = ctx.session.user as SessionUser;
      await checkAccess(user, input.anfrageId);
      return getByAnfrage(input.anfrageId);
    }),

  // Nachricht senden — bestimmt Empfänger automatisch aus Rolle
  senden: protectedProcedure
    .input(z.object({
      anfrageId: z.number().int().positive(),
      inhalt:    z.string().min(1).max(2000).trim(),
    }))
    .mutation(async ({ input, ctx }) => {
      const user = ctx.session.user as SessionUser;
      await checkAccess(user, input.anfrageId);

      const technikerKuerzel = await getTechnikerVonAnfrage(input.anfrageId);
      if (!technikerKuerzel) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Anfrage nicht gefunden." });
      }

      const isAdmin     = user.rolle === "ADMIN";
      const empfKuerzel = isAdmin ? technikerKuerzel : ADMIN_EMPF;

      const nachricht = await senden({
        anfrageId:   input.anfrageId,
        vonKuerzel:  user.kuerzel,
        empfKuerzel,
        inhalt:      input.inhalt,
      });

      const payload = {
        anfrageId:  input.anfrageId,
        inhalt:     input.inhalt.substring(0, 150),
        vonKuerzel: user.kuerzel,
        id:         nachricht.id,
      };

      if (isAdmin) {
        emitToUser(technikerKuerzel, EVENTS.CHAT_NEU, payload);
      } else {
        emitToAdmins(EVENTS.CHAT_NEU, { ...payload, techniker: user.kuerzel });
      }

      return nachricht;
    }),

  // Alle Nachrichten der Anfrage als gelesen markieren (für aktuellen User)
  markGelesen: protectedProcedure
    .input(z.object({ anfrageId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const user        = ctx.session.user as SessionUser;
      const empfKuerzel = user.rolle === "ADMIN" ? ADMIN_EMPF : user.kuerzel;
      return markGelesen(input.anfrageId, empfKuerzel);
    }),

  // Gesamtzahl ungelesener Nachrichten → Glocken-Badge
  getUngelesenCount: protectedProcedure
    .query(async ({ ctx }) => {
      const user        = ctx.session.user as SessionUser;
      const empfKuerzel = user.rolle === "ADMIN" ? ADMIN_EMPF : user.kuerzel;
      return getUngelesenCount(empfKuerzel);
    }),

  // Ungelesen pro Anfrage → Badge an Anfrage-Karten
  getUngelesenProAnfrage: protectedProcedure
    .query(async ({ ctx }) => {
      const user        = ctx.session.user as SessionUser;
      const empfKuerzel = user.rolle === "ADMIN" ? ADMIN_EMPF : user.kuerzel;
      return getUngelesenProAnfrage(empfKuerzel);
    }),

  // Stats für eine Anfrage (ungelesen + letzte Nachricht + Gesamtanzahl) → Techniker-Karte
  getStatsForAnfrage: protectedProcedure
    .input(z.object({ anfrageId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const user        = ctx.session.user as SessionUser;
      await checkAccess(user, input.anfrageId);
      const empfKuerzel = user.rolle === "ADMIN" ? ADMIN_EMPF : user.kuerzel;
      return getStatsForAnfrage(input.anfrageId, empfKuerzel);
    }),

  // Batch-Stats für mehrere Anfragen → Admin Anfragen-Liste
  getStatsBatch: protectedProcedure
    .input(z.object({ anfrageIds: z.array(z.number().int().positive()).max(200) }))
    .query(async ({ ctx, input }) => {
      const user        = ctx.session.user as SessionUser;
      const empfKuerzel = user.rolle === "ADMIN" ? ADMIN_EMPF : user.kuerzel;
      return getStatsBatch(input.anfrageIds, empfKuerzel);
    }),

});
