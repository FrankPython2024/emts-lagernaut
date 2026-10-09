import { z } from "zod";
import { Prisma } from "@prisma/client";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc";
import type { SessionUser } from "@/core/types";

// ── Dashboard-Konfiguration pro User ─────────────────────────────────────────
// Gespeichert als JSON? Spalte im User-Modell.
// null = User hat Default-Layout.

// ── Kleine Ansichts-Einstellungen pro User (09.10.2026) ────────────────────────
// Feste Schlüssel mit festen Werten — keine freie Ablage. Wunsch Frank: Umschalter
// „offen / abgeschlossen" in den Anfragen, dauerhaft PRO BENUTZER (nicht je Browser).
const EINSTELLUNGEN = {
  anfragenStatus: z.enum(["offen", "abgeschlossen"]),
} as const;
type EinstellungSchluessel = keyof typeof EINSTELLUNGEN;
const SCHLUESSEL = Object.keys(EINSTELLUNGEN) as [EinstellungSchluessel, ...EinstellungSchluessel[]];

function alsObjekt(j: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : {};
}

export const userPreferencesRouter = createTRPCRouter({

  getEinstellungen: protectedProcedure
    .query(async ({ ctx }) => {
      const user = ctx.session.user as SessionUser;
      const row  = await ctx.prisma.user.findUnique({ where: { id: user.id }, select: { einstellungen: true } });
      const roh  = alsObjekt(row?.einstellungen);
      // Nur gültige Werte zurückgeben — ein alter/kaputter Eintrag fällt auf den Standard.
      const status = EINSTELLUNGEN.anfragenStatus.safeParse(roh.anfragenStatus);
      return { anfragenStatus: status.success ? status.data : null };
    }),

  setEinstellung: protectedProcedure
    .input(z.object({ schluessel: z.enum(SCHLUESSEL), wert: z.string().max(50) }))
    .mutation(async ({ ctx, input }) => {
      const user = ctx.session.user as SessionUser;
      const wert = EINSTELLUNGEN[input.schluessel].parse(input.wert);
      const row  = await ctx.prisma.user.findUnique({ where: { id: user.id }, select: { einstellungen: true } });
      await ctx.prisma.user.update({
        where: { id: user.id },
        data:  { einstellungen: { ...alsObjekt(row?.einstellungen), [input.schluessel]: wert } as Prisma.InputJsonObject },
      });
      return { ok: true };
    }),

  getDashboardConfig: protectedProcedure
    .query(async ({ ctx }) => {
      const user = ctx.session.user as SessionUser;
      const row  = await ctx.prisma.user.findUnique({
        where:  { id: user.id },
        select: { dashboardConfig: true },
      });
      return row?.dashboardConfig ?? null;
    }),

  saveDashboardConfig: protectedProcedure
    .input(z.object({
      layouts:    z.any(),
      visibility: z.record(z.string(), z.boolean()),
    }))
    .mutation(async ({ ctx, input }) => {
      const user = ctx.session.user as SessionUser;
      await ctx.prisma.user.update({
        where: { id: user.id },
        data:  { dashboardConfig: { layouts: input.layouts, visibility: input.visibility } },
      });
    }),

  resetDashboardConfig: protectedProcedure
    .mutation(async ({ ctx }) => {
      const user = ctx.session.user as SessionUser;
      // Prisma JSON null → SQL NULL → Frontend fällt auf Default-Layout zurück
      await ctx.prisma.user.update({
        where: { id: user.id },
        data:  { dashboardConfig: Prisma.JsonNull },
      });
    }),
});
