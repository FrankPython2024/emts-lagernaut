import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc";
import {
  getAktiv,
  addItem,
  addItemsBulk,
  addSonderItem,
  removeItem,
  submit,
  submitAlle,
  getItemOwner,
  getKorbOwner,
} from "@/modules/warenkorb/service";
import type { SessionUser } from "@/core/types";

// ── Ownership helper ──────────────────────────────────────────────────────────

function assertOwner(sessionUser: unknown, techniker: string) {
  const user = sessionUser as SessionUser;
  if (user?.rolle !== "ADMIN" && (user?.kuerzel ?? "").toUpperCase() !== techniker.toUpperCase()) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Nur eigenen Warenkorb zugreifbar." });
  }
}

/**
 * Berechtigung für das tatsächliche Absenden (= Erzeugen von Anfragen).
 *
 *  - testModus = true  → erlaubt für ADMIN und ADMIN_READONLY (Test-Daten, kein
 *    echter Schaden). ADMIN_READONLY darf hier ausnahmsweise schreiben.
 *  - testModus = false → echte Anfragen, nur für TECHNIKER (Self) und ADMIN.
 *    ADMIN_READONLY / BETRACHTER dürfen KEINE echten Anfragen erzeugen.
 */
function assertDarfAbsenden(sessionUser: unknown, testModus: boolean) {
  const rolle = (sessionUser as SessionUser)?.rolle;
  if (testModus) {
    if (rolle !== "ADMIN" && rolle !== "ADMIN_READONLY") {
      throw new TRPCError({ code: "FORBIDDEN", message: "Test-Modus ist nur für Admins verfügbar." });
    }
  } else if (rolle !== "TECHNIKER" && rolle !== "ADMIN") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Keine Berechtigung, echte Anfragen zu erstellen." });
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

  // Mehrere Items in einer Transaktion (atomar) — verhindert halb-befüllten
  // Warenkorb wenn der Client zwischen N addItem-Calls crasht
  addItemsBulk: protectedProcedure
    .input(z.object({
      techniker:    z.string().min(1).max(50),
      geraeteName:  z.string().max(255).optional(),
      items: z.array(z.object({
        logId:      z.string().min(1).max(100),
        artikelId:  z.number().int().positive().nullable(),
        teiltyp:    z.string().max(100).optional(),
        // Obergrenze hier bewusst großzügig — die teiltyp-genaue Prüfung
        // (Füße max 2, alles andere 1) macht der Service, siehe maxMengeFuer().
        menge:      z.number().int().min(1).max(2).optional(),
        grading:    z.string().max(10).optional(),
        zusatzinfo: z.string().max(500).optional(),
      })).min(1).max(50),
    }))
    .mutation(({ input, ctx }) => {
      assertOwner(ctx.session.user, input.techniker);
      return addItemsBulk(input);
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
  // Ownership: nur Owner des Korbs (oder ADMIN) darf löschen.
  removeItem: protectedProcedure
    .input(z.object({ itemId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const owner = await getItemOwner(input.itemId);
      if (owner === null) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Warenkorb-Item nicht gefunden." });
      }
      assertOwner(ctx.session.user, owner);
      return removeItem(input.itemId);
    }),

  // Einzelnen Warenkorb absenden
  // Ownership: nur Owner des Korbs (oder ADMIN) darf absenden — zusätzlich zum
  // Rollen-Gate (assertDarfAbsenden) für das Erzeugen echter Anfragen.
  submit: protectedProcedure
    .input(z.object({
      korbId:     z.number().int().positive(),
      zusatzinfo: z.string().max(500).optional(),
      testModus:  z.boolean().default(false),
    }))
    .mutation(async ({ input, ctx }) => {
      const owner = await getKorbOwner(input.korbId);
      if (owner === null) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Warenkorb nicht gefunden." });
      }
      assertOwner(ctx.session.user, owner);
      assertDarfAbsenden(ctx.session.user, input.testModus);
      return submit(input);
    }),

  // Alle aktiven Körbe auf einmal absenden
  submitAlle: protectedProcedure
    .input(z.object({
      techniker:  z.string().min(1).max(50),
      zusatzinfo: z.string().max(500).optional(),
      testModus:  z.boolean().default(false),
    }))
    .mutation(({ input, ctx }) => {
      assertOwner(ctx.session.user, input.techniker);
      assertDarfAbsenden(ctx.session.user, input.testModus);
      return submitAlle(input);
    }),

});
