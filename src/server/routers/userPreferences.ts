import { z } from "zod";
import { Prisma } from "@prisma/client";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc";
import type { SessionUser } from "@/core/types";

// ── Dashboard-Konfiguration pro User ─────────────────────────────────────────
// Gespeichert als JSON? Spalte im User-Modell.
// null = User hat Default-Layout.

export const userPreferencesRouter = createTRPCRouter({

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
