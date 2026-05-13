import { z } from "zod";
import { createTRPCRouter, adminProcedure } from "@/server/trpc";

export const lagerplatzRouter = createTRPCRouter({

  list: adminProcedure.query(({ ctx }) =>
    ctx.prisma.lagerplatz.findMany({
      include: { modell: { select: { id: true, modell: true, hersteller: true } } },
      orderBy: [{ reihe: "asc" }, { fach: "desc" }, { ebene: "asc" }],
    })
  ),

  listByReihe: adminProcedure.query(async ({ ctx }) => {
    const alle = await ctx.prisma.lagerplatz.findMany({
      include: { modell: { select: { id: true, modell: true, hersteller: true } } },
      orderBy: [{ reihe: "asc" }, { fach: "desc" }, { ebene: "asc" }],
    });

    const grouped: Record<number, typeof alle[number][]> = {};
    for (const p of alle) {
      if (!grouped[p.reihe]) grouped[p.reihe] = [];
      grouped[p.reihe].push(p);
    }
    return grouped;
  }),

  byCode: adminProcedure
    .input(z.object({ code: z.string() }))
    .query(({ ctx, input }) =>
      ctx.prisma.lagerplatz.findUnique({
        where:   { code: input.code },
        include: { modell: true },
      })
    ),

  byModellId: adminProcedure
    .input(z.object({ modellId: z.number() }))
    .query(({ ctx, input }) =>
      ctx.prisma.lagerplatz.findUnique({
        where: { modellId: input.modellId },
      })
    ),

  free: adminProcedure
    .input(z.object({ hersteller: z.string().optional() }))
    .query(({ ctx, input }) =>
      ctx.prisma.lagerplatz.findMany({
        where: {
          modellId: null,
          ...(input.hersteller ? { hersteller: input.hersteller } : {}),
        },
        orderBy: [{ reihe: "asc" }, { fach: "desc" }, { ebene: "asc" }],
      })
    ),
});
