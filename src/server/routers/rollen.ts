import { z } from "zod";
import { createTRPCRouter, adminProcedure, protectedProcedure } from "@/server/trpc";
import type { SessionUser } from "@/core/types";
import {
  listRollen,
  getRolle,
  listPermissions,
  erstelleRolle,
  aktualisiereRolle,
  loescheRolle,
  setzeRollePermissions,
  getMeinePermissions,
} from "@/modules/rollen/service";

export const rollenRouter = createTRPCRouter({

  // Permissions des eingeloggten Users (für Sidebar-Filter & has()-Checks im FE)
  meinePermissions: protectedProcedure.query(({ ctx }) => {
    const user = ctx.session.user as SessionUser;
    return getMeinePermissions(user.rolle);
  }),

  // Alle Rollen inkl. Permissions + Counts
  list: adminProcedure.query(() => listRollen()),

  // Einzelne Rolle
  get: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(({ input }) => getRolle(input.id)),

  // Alle verfügbaren Permissions (gruppierbar nach kategorie im UI)
  listPermissions: adminProcedure.query(() => listPermissions()),

  // Neue Rolle anlegen — Name nur UPPERCASE/Unterstrich
  erstellen: adminProcedure
    .input(z.object({
      name:         z.string().min(1).max(50).regex(/^[A-Z_][A-Z_0-9]*$/, "Nur Großbuchstaben, Ziffern und Unterstrich; muss mit Buchstabe oder Unterstrich beginnen"),
      bezeichnung:  z.string().min(1).max(100),
      beschreibung: z.string().max(255).optional(),
    }))
    .mutation(({ input }) => erstelleRolle(input)),

  // Rolle bearbeiten (Bezeichnung/Beschreibung/Aktiv). Name + istSystem sind fix.
  aktualisieren: adminProcedure
    .input(z.object({
      id:           z.number().int().positive(),
      bezeichnung:  z.string().min(1).max(100).optional(),
      beschreibung: z.string().max(255).nullable().optional(),
      aktiv:        z.boolean().optional(),
    }))
    .mutation(({ input }) =>
      aktualisiereRolle(input.id, {
        bezeichnung:  input.bezeichnung,
        beschreibung: input.beschreibung ?? undefined,
        aktiv:        input.aktiv,
      }),
    ),

  // Rolle löschen — System-Rollen sind geschützt
  loeschen: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ input }) => loescheRolle(input.id)),

  // Permissions einer Rolle setzen (komplett ersetzen, idempotent)
  setzePermissions: adminProcedure
    .input(z.object({
      rolleId:       z.number().int().positive(),
      permissionIds: z.array(z.number().int().positive()).max(200),
    }))
    .mutation(({ input }) => setzeRollePermissions(input.rolleId, input.permissionIds)),

});
