import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, adminProcedure } from "@/server/trpc";
import { getOrCreateModell } from "@/lib/geraete/getOrCreateModell";

export const modellRouter = createTRPCRouter({

  /**
   * Sucht ein Modell case-insensitiv (mit/ohne Prefix, nur aktive).
   * Legt nur an wenn adminBestaetigt=true.
   * Gibt istUnsicher=true zurück wenn ähnliche Modelle existieren.
   */
  lookup: adminProcedure
    .input(z.object({
      bezeichnung:     z.string().min(1).max(300),
      hersteller:      z.string().min(1).max(100),
      adminBestaetigt: z.boolean().optional(),
    }))
    .mutation(({ input }) =>
      getOrCreateModell(input.bezeichnung, input.hersteller, {
        allowCreate:     input.adminBestaetigt === true,
        adminBestaetigt: input.adminBestaetigt,
      })
    ),

  /**
   * Alle deaktivierten Modelle für Audit-Übersicht.
   */
  listInaktiv: adminProcedure.query(({ ctx }) =>
    ctx.prisma.geraeteModell.findMany({
      where:   { aktiv: false },
      orderBy: [{ deaktiviertAm: "desc" }, { hersteller: "asc" }],
      select:  {
        id:               true,
        modell:           true,
        hersteller:       true,
        deaktiviertGrund: true,
        deaktiviertAm:    true,
      },
    })
  ),

  /**
   * Deaktiviertes Modell reaktivieren (explizite Bestätigung erforderlich).
   */
  reaktivieren: adminProcedure
    .input(z.object({
      id:          z.number().int().positive(),
      bestaetigt:  z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!input.bestaetigt) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Reaktivierung muss explizit bestätigt werden" });
      }
      const modell = await ctx.prisma.geraeteModell.findUnique({ where: { id: input.id } });
      if (!modell) throw new TRPCError({ code: "NOT_FOUND", message: "Modell nicht gefunden" });
      if (modell.aktiv) return modell; // Idempotent

      return ctx.prisma.geraeteModell.update({
        where: { id: input.id },
        data:  { aktiv: true, deaktiviertGrund: null, deaktiviertAm: null },
      });
    }),

});
