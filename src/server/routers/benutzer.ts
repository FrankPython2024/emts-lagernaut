import { z } from "zod";
import { UserRolle } from "@prisma/client";
import { createTRPCRouter, adminProcedure, protectedProcedure } from "@/server/trpc";
import {
  createUser,
  getAllUsers,
  updateUser,
  deactivateUser,
  aktiviereDeaktiviere,
  loescheUser,
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

  // Benutzer deaktivieren — Admin (Legacy, kein Reaktivieren)
  deactivate: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ ctx, input }) => {
      const me = ctx.session.user as SessionUser;
      if (me.id === input.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Du kannst dich nicht selbst deaktivieren." });
      }
      return deactivateUser(input.id);
    }),

  // Bidirektionaler Toggle (Soft-Delete in/out). Schützt vor Selbst-Lockout.
  aktiviereDeaktiviere: adminProcedure
    .input(z.object({
      id:    z.number().int().positive(),
      aktiv: z.boolean(),
    }))
    .mutation(({ ctx, input }) => {
      const me = ctx.session.user as SessionUser;
      if (me.id === input.id && !input.aktiv) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Du kannst dich nicht selbst deaktivieren." });
      }
      return aktiviereDeaktiviere(input.id, input.aktiv);
    }),

  // Hart löschen — Admin, nur wenn keine Anfragen/Buchungen verknüpft.
  // CASCADE räumt UserStandortAccess automatisch weg.
  loeschen: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ ctx, input }) => {
      const me = ctx.session.user as SessionUser;
      if (me.id === input.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Du kannst dich nicht selbst löschen." });
      }
      return loescheUser(input.id);
    }),

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

  // ── Zusatz-Rechte pro User (zusätzlich zur Rolle) ────────────────────────

  // Lädt die aktuellen Zusatz-Rechte + die Rollen-Rechte (für "bereits durch Rolle").
  getExtraRechte: adminProcedure
    .input(z.object({ userId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const user = await prisma.user.findUnique({
        where:  { id: input.userId },
        select: {
          rolle:            true,
          extraPermissions: { select: { permission: { select: { key: true } } } },
        },
      });
      if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "Benutzer nicht gefunden." });

      const rolle = await prisma.rolle.findUnique({
        where:  { name: user.rolle },
        select: { permissions: { select: { permission: { select: { key: true } } } } },
      });

      return {
        rolle:       user.rolle,
        extra:       user.extraPermissions.map(p => p.permission.key),
        rolleRechte: rolle?.permissions.map(p => p.permission.key) ?? [],
      };
    }),

  // Ersetzt das Zusatz-Rechte-Set des Users transaktional. Nur Admin verwaltet
  // Rechte. Ungültige/gelöschte Recht-Codes werden ignoriert (nur existierende
  // Permissions werden verknüpft). Greift live (ohne Re-Login).
  setExtraRechte: adminProcedure
    .input(z.object({
      userId: z.number().int().positive(),
      rechte: z.array(z.string().max(50)).max(200),
    }))
    .mutation(async ({ input }) => {
      const perms = await prisma.permission.findMany({
        where:  { key: { in: input.rechte } },
        select: { id: true },
      });
      const permIds = perms.map(p => p.id);

      await prisma.$transaction(async (tx) => {
        await tx.userPermission.deleteMany({ where: { userId: input.userId } });
        if (permIds.length > 0) {
          await tx.userPermission.createMany({
            data:           permIds.map(pid => ({ userId: input.userId, permissionId: pid })),
            skipDuplicates: true,
          });
        }
      });

      return { gespeichert: permIds.length };
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
