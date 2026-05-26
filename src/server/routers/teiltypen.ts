import { z } from "zod";
import { createTRPCRouter, protectedProcedure, adminProcedure } from "@/server/trpc";
import {
  getAktiveTeiltypen,
  getAlleTeiltypen,
  erstelleTeiltyp,
  aktualisiereTeiltyp,
} from "@/modules/teiltypen/service";

export const teiltypenRouter = createTRPCRouter({

  // Liste — Default nur aktive (für Techniker-Portal & Kompatibilitäts-Service)
  list: protectedProcedure
    .input(z.object({ nurAktive: z.boolean().default(true) }).optional())
    .query(({ input }) =>
      input?.nurAktive === false ? getAlleTeiltypen() : getAktiveTeiltypen(),
    ),

  // Neuen Teiltyp anlegen — nur Admin
  erstellen: adminProcedure
    .input(z.object({
      name:       z.string().min(1).max(100),
      icon:       z.string().max(50).optional(),
      sortierung: z.number().int().optional(),
    }))
    .mutation(({ input }) => erstelleTeiltyp(input)),

  // Teiltyp ändern (Name, Icon, Sortierung, Aktiv-Toggle) — nur Admin.
  // istStandard ist absichtlich nicht änderbar.
  aktualisieren: adminProcedure
    .input(z.object({
      id:         z.number().int().positive(),
      name:       z.string().min(1).max(100).optional(),
      icon:       z.string().max(50).nullable().optional(),
      sortierung: z.number().int().optional(),
      aktiv:      z.boolean().optional(),
    }))
    .mutation(({ input }) =>
      aktualisiereTeiltyp(input.id, {
        name:       input.name,
        icon:       input.icon ?? undefined,
        sortierung: input.sortierung,
        aktiv:      input.aktiv,
      }),
    ),
});
