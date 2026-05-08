import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc";
import {
  getAktiv,
  addItem,
  removeItem,
  submit,
} from "@/modules/warenkorb/service";

export const warenkorbRouter = createTRPCRouter({

  // Aktiven Warenkorb eines Technikers abrufen
  getAktiv: protectedProcedure
    .input(z.object({ techniker: z.string().min(1).max(50) }))
    .query(({ input }) =>
      getAktiv(input.techniker),
    ),

  // Item zum Warenkorb hinzufügen
  addItem: protectedProcedure
    .input(z.object({
      techniker:   z.string().min(1).max(50),
      logId:       z.string().min(1).max(100),
      geraeteName: z.string().max(255).optional(),
      artikelId:   z.number().int().positive().nullable(),
      teiltyp:     z.string().max(100).optional(),
      grading:     z.string().max(10).optional(),
      zusatzinfo:  z.string().max(500).optional(),
    }))
    .mutation(({ input }) =>
      addItem(input),
    ),

  // Item entfernen
  removeItem: protectedProcedure
    .input(z.object({ itemId: z.number().int().positive() }))
    .mutation(({ input }) =>
      removeItem(input.itemId),
    ),

  // Warenkorb absenden → erstellt alle Anfragen mit gruppenNr
  submit: protectedProcedure
    .input(z.object({
      korbId:     z.number().int().positive(),
      zusatzinfo: z.string().max(500).optional(),
    }))
    .mutation(({ input }) =>
      submit(input),
    ),

});
