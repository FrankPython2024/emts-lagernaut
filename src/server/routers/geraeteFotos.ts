import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc";
import type { SessionUser } from "@/core/types";
import {
  deuteBezeichnung, speichereFoto, loescheFoto, liste, holeAusShop,
} from "@/modules/geraete/fotos";

// ── Gerätefotos ──────────────────────────────────────────────────────────────
// Bewusst `protectedProcedure`: Wer den Pickup-Auftrag sehen darf, darf auch
// sehen, wie das gesuchte Gerät aussieht — und darf ein Foto beisteuern.
// Ein eigenes Recht wäre eine Hürde für genau die Leute, die die Bilder
// liefern sollen, und würde einen seed-rbac-Lauf erzwingen.

export const geraeteFotosRouter = createTRPCRouter({

  /** Aus dem ReForm-Text Hersteller, Modell und Foto-Stand ableiten. */
  info: protectedProcedure
    .input(z.object({ bezeichnung: z.string().max(500).nullish() }))
    .query(({ input }) => deuteBezeichnung(input.bezeichnung ?? null)),

  speichern: protectedProcedure
    .input(z.object({
      anzeige:  z.string().min(3).max(255),
      base64:   z.string().min(100).max(9_000_000),
      mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    }))
    .mutation(({ ctx, input }) => {
      const user = ctx.session!.user as SessionUser;
      return speichereFoto({ ...input, benutzer: user.kuerzel || user.name || null });
    }),

  loeschen: protectedProcedure
    .input(z.object({ schluessel: z.string().min(1).max(191) }))
    .mutation(async ({ input }) => { await loescheFoto(input.schluessel); return { ok: true }; }),

  /**
   * Bild aus dem AfB-Shop holen. Bewusst eine Mutation, obwohl sie nur liest:
   * Sie stösst eine Abfrage nach aussen an und darf deshalb nicht von React
   * automatisch wiederholt werden.
   */
  ausShop: protectedProcedure
    .input(z.object({
      anzeige: z.string().min(3).max(255),
      modell:  z.string().max(255).nullish(),
    }))
    .mutation(({ input }) => holeAusShop(input.anzeige, input.modell)),

  liste: protectedProcedure.query(() => liste()),
});
