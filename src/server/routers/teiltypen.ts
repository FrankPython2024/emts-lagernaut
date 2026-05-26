import { z } from "zod";
import { createTRPCRouter, protectedProcedure, adminProcedure } from "@/server/trpc";
import {
  getAktiveTeiltypen,
  getAlleTeiltypen,
  erstelleTeiltyp,
  aktualisiereTeiltyp,
  getTeiltypenForModell,
  getModellTeiltypIds,
  setzeModellTeiltypen,
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

  // Modell-spezifische Liste: Standards + Custom-Teiltypen dieses Modells.
  // Wird vom Techniker-Portal pro Gerät geladen.
  fuerModell: protectedProcedure
    .input(z.object({ modellId: z.number().int().positive() }))
    .query(({ input }) => getTeiltypenForModell(input.modellId)),

  // Nur die Custom-IDs eines Modells (für Admin-UI-Auswahl)
  modellTeiltypIds: adminProcedure
    .input(z.object({ modellId: z.number().int().positive() }))
    .query(({ input }) => getModellTeiltypIds(input.modellId)),

  // Custom-Teiltyp-Verknüpfungen eines Modells komplett ersetzen — nur Admin.
  setzeFuerModell: adminProcedure
    .input(z.object({
      modellId:   z.number().int().positive(),
      teiltypIds: z.array(z.number().int().positive()).max(50),
    }))
    .mutation(({ input }) => setzeModellTeiltypen(input.modellId, input.teiltypIds)),
});
