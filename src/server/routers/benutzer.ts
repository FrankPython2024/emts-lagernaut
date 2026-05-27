import { z } from "zod";
import { UserRolle } from "@prisma/client";
import { createTRPCRouter, adminProcedure, protectedProcedure } from "@/server/trpc";
import {
  createUser,
  getAllUsers,
  updateUser,
  deactivateUser,
  resetPassword,
  resetPasswordToDefault,
  changePassword,
} from "@/modules/benutzer/service";
import { prisma } from "@/core/db/prisma";
import { TRPCError } from "@trpc/server";
import type { SessionUser } from "@/core/types";

export const benutzerRouter = createTRPCRouter({

  // Alle Benutzer — Admin
  getAll: adminProcedure
    .query(() => getAllUsers()),

  // Benutzer per ID — Admin
  getById: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const user = await prisma.user.findUnique({
        where:  { id: input.id },
        select: {
          id: true, name: true, kuerzel: true, email: true,
          rolle: true, aktiv: true, lastLogin: true, createdAt: true,
        },
      });
      if (!user) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Benutzer nicht gefunden." });
      }
      return user;
    }),

  // Neuen Benutzer anlegen — Admin
  create: adminProcedure
    .input(z.object({
      name:     z.string().min(1).max(100),
      kuerzel:  z.string().min(2).max(10).toUpperCase(),
      email:    z.string().email(),
      password: z.string().min(8).max(100),
      rolle:    z.nativeEnum(UserRolle).optional(),
    }))
    .mutation(({ input }) =>
      createUser(input),
    ),

  // Benutzer aktualisieren — Admin
  update: adminProcedure
    .input(z.object({
      id:    z.number().int().positive(),
      name:  z.string().min(1).max(100).optional(),
      email: z.string().email().optional(),
      rolle: z.nativeEnum(UserRolle).optional(),
    }))
    .mutation(({ input }) => {
      const { id, ...data } = input;
      return updateUser(id, data);
    }),

  // Benutzer deaktivieren — Admin (kein Hard-Delete)
  deactivate: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ input }) =>
      deactivateUser(input.id),
    ),

  // Passwort zurücksetzen — Admin (freies Passwort)
  resetPassword: adminProcedure
    .input(z.object({
      id:          z.number().int().positive(),
      newPassword: z.string().min(8).max(100),
    }))
    .mutation(({ input }) =>
      resetPassword(input.id, input.newPassword),
    ),

  // Passwort auf Standard zurücksetzen ("techniker123") — nur für Techniker/Betrachter
  resetPasswordDefault: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const result = await resetPasswordToDefault(input.id);
      if (result.rolle === "ADMIN") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin-Passwörter können nicht zurückgesetzt werden." });
      }
      return { erfolg: true, kuerzel: result.kuerzel };
    }),

  // ── Standort-Zugriff pro User ────────────────────────────────────────────

  // Liest aktuellen Standort-Zugriff: alleStandorte-Wildcard, Hauptstandort,
  // zusätzliche Standorte (M:N).
  getStandortAccess: adminProcedure
    .input(z.object({ userId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const user = await prisma.user.findUnique({
        where:   { id: input.userId },
        include: { standortAccess: { select: { standortId: true } } },
      });
      if (!user) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Benutzer nicht gefunden." });
      }
      return {
        alleStandorte:           user.alleStandorte,
        hauptstandortId:         user.standortId ?? null,
        zusaetzlicheStandortIds: user.standortAccess.map(a => a.standortId),
      };
    }),

  // Setzt Standort-Zugriff atomar: alleStandorte-Flag + zusätzliche Standorte.
  // Hauptstandort (user.standortId) wird hier NICHT verändert; das passiert über update().
  // Hinweis: Änderung wird beim Ziel-User erst nach Re-Login wirksam (Session-Cache).
  setzeStandortAccess: adminProcedure
    .input(z.object({
      userId:                  z.number().int().positive(),
      alleStandorte:           z.boolean(),
      zusaetzlicheStandortIds: z.array(z.number().int().positive()).max(50),
    }))
    .mutation(async ({ input }) => {
      return prisma.$transaction(async (tx) => {
        // Wildcard-Flag setzen
        await tx.user.update({
          where: { id: input.userId },
          data:  { alleStandorte: input.alleStandorte },
        });

        // Alte Access-Einträge wegwerfen
        await tx.userStandortAccess.deleteMany({ where: { userId: input.userId } });

        // Bei alleStandorte=true sind zusätzliche Einträge redundant — überspringen
        if (!input.alleStandorte && input.zusaetzlicheStandortIds.length > 0) {
          // Hauptstandort filtern (würde Unique [userId, standortId] verletzen).
          const haupt = await tx.user.findUnique({
            where:  { id: input.userId },
            select: { standortId: true },
          });
          const zusaetzliche = input.zusaetzlicheStandortIds.filter(
            sid => sid !== haupt?.standortId,
          );
          if (zusaetzliche.length > 0) {
            await tx.userStandortAccess.createMany({
              data:           zusaetzliche.map(sid => ({ userId: input.userId, standortId: sid })),
              skipDuplicates: true,
            });
          }
        }

        return { aktualisiert: true };
      });
    }),

  // Eigenes Passwort ändern — jeder eingeloggte User
  changePassword: protectedProcedure
    .input(z.object({
      aktuellesPasswort: z.string().min(1),
      neuesPasswort:     z.string().min(8).max(100),
    }))
    .mutation(async ({ input, ctx }) => {
      const user = ctx.session.user as SessionUser;
      if (!user.id) throw new TRPCError({ code: "UNAUTHORIZED" });
      await changePassword(user.id, input.aktuellesPasswort, input.neuesPasswort);
      return { erfolg: true };
    }),

});
