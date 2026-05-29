import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, adminProcedure } from "@/server/trpc";
import { getOrCreateModell } from "@/lib/geraete/getOrCreateModell";
import { meilisearchSync } from "@/core/infra/meilisearchSync";
import { gruppiereNachBasis } from "@/lib/format/basisModell";

export const modellRouter = createTRPCRouter({

  /**
   * Modelle nach Basis-Modell gruppiert — { basisName, varianten[], anzahl }.
   * `varianten` = volle "Hersteller Modell"-Strings (= Kompatibilitaet.geraet),
   * für Expansion beim Bulk-Speichern. Default: nur aktive.
   * Gruppierung ist reine UI-Schicht; das Datenmodell bleibt MTM-basiert.
   */
  list: adminProcedure
    .input(z.object({ aktiv: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const rows = await ctx.prisma.geraeteModell.findMany({
        where:   input?.aktiv === undefined ? {} : { aktiv: input.aktiv },
        select:  { id: true, hersteller: true, modell: true },
      });
      const flat = rows.map((r) => ({ id: r.id, name: `${r.hersteller} ${r.modell}` }));
      return gruppiereNachBasis(flat);
    }),

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

      const result = await ctx.prisma.geraeteModell.update({
        where: { id: input.id },
        data:  { aktiv: true, deaktiviertGrund: null, deaktiviertAm: null },
      });
      meilisearchSync.modell(input.id);
      return result;
    }),

});
