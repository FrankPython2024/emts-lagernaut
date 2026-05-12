import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc";
import {
  getAktiv,
  addItem,
  addSonderItem,
  removeItem,
  submit,
  submitAlle,
} from "@/modules/warenkorb/service";
import type { SessionUser } from "@/core/types";

// ── Ownership helper ──────────────────────────────────────────────────────────

function assertOwner(sessionUser: unknown, techniker: string) {
  const user = sessionUser as SessionUser;
  if (user?.rolle !== "ADMIN" && (user?.kuerzel ?? "").toUpperCase() !== techniker.toUpperCase()) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Nur eigenen Warenkorb zugreifbar." });
  }
}

export const warenkorbRouter = createTRPCRouter({

  // Alle aktiven Körbe eines Technikers (je einer pro logId)
  getAktiv: protectedProcedure
    .input(z.object({ techniker: z.string().min(1).max(50) }))
    .query(({ input, ctx }) => {
      assertOwner(ctx.session.user, input.techniker);
      return getAktiv(input.techniker);
    }),

  // Item hinzufügen — gibt aktualisierten Warenkorb zurück
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
    .mutation(({ input, ctx }) => {
      assertOwner(ctx.session.user, input.techniker);
      return addItem(input);
    }),

  // Sonderanfrage hinzufügen (eigene Beschreibung, kein Lagerartikel)
  addSonderAnfrage: protectedProcedure
    .input(z.object({
      techniker:       z.string().min(1).max(50),
      logId:           z.string().min(1).max(100),
      geraeteName:     z.string().max(255).optional(),
      beschreibung:    z.string().min(5).max(500).trim(),
      sonderKategorie: z.string().max(50).optional(),
      grading:         z.enum(["A+", "A", "B", "C"]).nullable().optional(),
    }))
    .mutation(({ input, ctx }) => {
      assertOwner(ctx.session.user, input.techniker);
      return addSonderItem({
        techniker:       input.techniker,
        logId:           input.logId,
        geraeteName:     input.geraeteName,
        beschreibung:    input.beschreibung,
        sonderKategorie: input.sonderKategorie ?? "Sonstiges",
        grading:         input.grading,
      });
    }),

  // Item entfernen (leerer Korb wird automatisch gelöscht)
  removeItem: protectedProcedure
    .input(z.object({ itemId: z.number().int().positive() }))
    .mutation(({ input }) =>
      removeItem(input.itemId),
    ),

  // Einzelnen Warenkorb absenden
  submit: protectedProcedure
    .input(z.object({
      korbId:     z.number().int().positive(),
      zusatzinfo: z.string().max(500).optional(),
    }))
    .mutation(({ input }) =>
      submit(input),
    ),

  // Alle aktiven Körbe auf einmal absenden
  submitAlle: protectedProcedure
    .input(z.object({
      techniker:  z.string().min(1).max(50),
      zusatzinfo: z.string().max(500).optional(),
    }))
    .mutation(({ input, ctx }) => {
      assertOwner(ctx.session.user, input.techniker);
      return submitAlle(input);
    }),

});
