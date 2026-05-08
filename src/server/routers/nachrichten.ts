import { z } from "zod";
import { NachrichtTyp } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, adminProcedure, protectedProcedure } from "@/server/trpc";
import {
  sendeNachricht,
  getInbox,
  getUngelesen,
  markGelesen,
  alleMarkierenGelesen,
  erstelleAntwort,
  getAlleNachrichten,
  getByLogId,
} from "@/modules/nachrichten/service";
import type { SessionUser } from "@/core/types";
import { emitToUser }  from "@/modules/realtime/socket";
import { EVENTS }      from "@/modules/realtime/events";

export const nachrichtenRouter = createTRPCRouter({

  // Admin: neue Nachricht senden
  senden: adminProcedure
    .input(z.object({
      empfaenger: z.union([
        z.array(z.string().min(1).max(20)),
        z.literal("ALL"),
      ]),
      betreff: z.string().min(1).max(200).trim(),
      inhalt:  z.string().min(1).max(5000).trim(),
      typ:     z.nativeEnum(NachrichtTyp),
      logId:   z.string().max(100).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const user      = ctx.session.user as SessionUser;
      const nachricht = await sendeNachricht({ ...input, vonKuerzel: user.kuerzel });

      // Socket-Push an alle Empfänger
      for (const empf of nachricht.empfaenger) {
        emitToUser(empf.empfKuerzel, EVENTS.NACHRICHT_NEU, {
          id:         nachricht.id,
          betreff:    nachricht.betreff,
          inhalt:     nachricht.inhalt.substring(0, 150),
          vonKuerzel: user.kuerzel,
        });
      }

      return nachricht;
    }),

  // Eigene Inbox — sichergestellt: nur eigene Nachrichten
  getInbox: protectedProcedure
    .input(z.object({ kuerzel: z.string().min(1).max(20) }))
    .query(({ input, ctx }) => {
      const user = ctx.session.user as SessionUser;
      if (user.rolle !== "ADMIN" && user.kuerzel !== input.kuerzel) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return getInbox(input.kuerzel);
    }),

  // Ungelesen-Count für Badge
  getUngelesen: protectedProcedure
    .input(z.object({ kuerzel: z.string().min(1).max(20) }))
    .query(({ input, ctx }) => {
      const user = ctx.session.user as SessionUser;
      if (user.rolle !== "ADMIN" && user.kuerzel !== input.kuerzel) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return getUngelesen(input.kuerzel);
    }),

  // Einzelne Nachricht als gelesen markieren
  markGelesen: protectedProcedure
    .input(z.object({
      nachrichtId: z.number().int().positive(),
      kuerzel:     z.string().min(1).max(20),
    }))
    .mutation(({ input, ctx }) => {
      const user = ctx.session.user as SessionUser;
      if (user.rolle !== "ADMIN" && user.kuerzel !== input.kuerzel) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return markGelesen(input.nachrichtId, input.kuerzel);
    }),

  // Alle als gelesen markieren
  alleMarkierenGelesen: protectedProcedure
    .input(z.object({ kuerzel: z.string().min(1).max(20) }))
    .mutation(({ input, ctx }) => {
      const user = ctx.session.user as SessionUser;
      if (user.rolle !== "ADMIN" && user.kuerzel !== input.kuerzel) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return alleMarkierenGelesen(input.kuerzel);
    }),

  // Antwort senden (Techniker + Admin)
  antworten: protectedProcedure
    .input(z.object({
      nachrichtId: z.number().int().positive(),
      inhalt:      z.string().min(1).max(2000).trim(),
    }))
    .mutation(({ input, ctx }) => {
      const user = ctx.session.user as SessionUser;
      return erstelleAntwort({
        nachrichtId: input.nachrichtId,
        vonKuerzel:  user.kuerzel,
        inhalt:      input.inhalt,
      });
    }),

  // Einzelne Nachricht per ID mit allen Antworten (für Chat-Modal)
  getById: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const user      = ctx.session.user as SessionUser;
      const nachricht = await ctx.prisma.nachricht.findUnique({
        where:   { id: input.id },
        include: {
          antworten: { orderBy: { createdAt: "asc" } },
          empfaenger: { select: { empfKuerzel: true, gelesen: true } },
        },
      });
      if (!nachricht) throw new TRPCError({ code: "NOT_FOUND" });
      // Sicherheit: Admin darf alles, Techniker nur eigene Nachrichten
      const isEmpf = nachricht.empfaenger.some((e) => e.empfKuerzel === user.kuerzel);
      if (user.rolle !== "ADMIN" && !isEmpf) throw new TRPCError({ code: "FORBIDDEN" });
      return nachricht;
    }),

  // Alle Nachrichten für eine LogID — für Admin Chat (auch bereits gelesene)
  getByLogIdAll: adminProcedure
    .input(z.object({
      kuerzel: z.string().min(1).max(20),
      logId:   z.string().min(1).max(100),
    }))
    .query(({ input }) => getByLogId(input.kuerzel, input.logId, true)),

  // Ungelesene Nachrichten für eine LogID (Techniker-Portal Karten)
  getByLogId: protectedProcedure
    .input(z.object({
      kuerzel: z.string().min(1).max(20),
      logId:   z.string().min(1).max(100),
    }))
    .query(({ input, ctx }) => {
      const user = ctx.session.user as SessionUser;
      if (user.rolle !== "ADMIN" && user.kuerzel !== input.kuerzel) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return getByLogId(input.kuerzel, input.logId);
    }),

  // Admin: alle Nachrichten im System
  getAlle: adminProcedure
    .query(() => getAlleNachrichten()),

});
