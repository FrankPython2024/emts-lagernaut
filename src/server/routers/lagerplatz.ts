import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, adminProcedure } from "@/server/trpc";
import { extractSerie } from "@/lib/lager/serien";

export const lagerplatzRouter = createTRPCRouter({

  // ── Lesende Endpoints ──────────────────────────────────────────────────────

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

  // ── Vorschlag ──────────────────────────────────────────────────────────────

  vorschlag: adminProcedure
    .input(z.object({ modellId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const modell = await ctx.prisma.geraeteModell.findUnique({
        where:   { id: input.modellId },
        include: { lagerplatz: true },
      });
      if (!modell) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Modell nicht gefunden" });
      }

      if (modell.lagerplatz) {
        return {
          bereitsZugewiesen: true as const,
          platz:             modell.lagerplatz,
          vorschlaege:       [] as ScoredPlatz[],
          voll:              false,
        };
      }

      const freie = await ctx.prisma.lagerplatz.findMany({
        where:   { modellId: null },
        orderBy: [{ reihe: "asc" }, { fach: "desc" }, { ebene: "asc" }],
      });

      if (freie.length === 0) {
        return {
          bereitsZugewiesen: false as const,
          vorschlaege:       [] as ScoredPlatz[],
          voll:              true,
        };
      }

      const { familie, serie } = extractSerie(modell.modell);

      // Belegte Geschwister-Plätze (gleicher Hersteller, ähnliche Bezeichnung)
      const geschwister: { regal: number; fach: number; ebene: number; serie: string | null }[] = [];
      if (familie) {
        const naheVerwandte = await ctx.prisma.lagerplatz.findMany({
          where: {
            modellId: { not: null },
            modell: {
              hersteller: modell.hersteller,
              modell:     { contains: familie },
            },
          },
          include: { modell: { select: { modell: true } } },
        });
        for (const p of naheVerwandte) {
          geschwister.push({
            regal:  p.regal,
            fach:   p.fach,
            ebene:  p.ebene,
            serie:  extractSerie(p.modell?.modell ?? "").serie,
          });
        }
      }

      const scored: ScoredPlatz[] = freie.map((p) => {
        let score = 0;
        const gruende: string[] = [];

        // (1) Hersteller-Region
        if (p.hersteller === modell.hersteller) {
          score += 100;
          gruende.push(`bevorzugte ${modell.hersteller}-Region`);
        } else if (modell.hersteller === "Fujitsu" || p.hersteller === null) {
          score += 30;
          gruende.push("flexibler Platz");
        } else {
          score += 5;
          gruende.push(`außerhalb ${modell.hersteller}-Region`);
        }

        // (2) Position: obere Fächer (hohe Fach-Nr) und niedrige Ebenen bevorzugen
        score += p.fach * 8;                    // Fach 5=40, Fach 1=8
        score += Math.max(0, 7 - p.ebene) * 3; // Ebene 2=15, Ebene 6=3

        // (3) Serien-Cluster-Bonus
        for (const g of geschwister) {
          if (g.regal !== p.regal) continue;
          const dist = Math.abs(g.fach - p.fach) + Math.abs(g.ebene - p.ebene);
          if (g.serie !== null && g.serie === serie) {
            if (dist <= 2) { score += 50; gruende.push(`nahe ${serie}-Cluster`); break; }
            if (dist <= 4) { score += 20; gruende.push(`gleiches Regal wie ${serie}`); break; }
          } else if (familie !== null && g.serie?.split(" ")[0] === familie) {
            if (dist <= 3) { score += 15; gruende.push(`nahe ${familie}-Familie`); break; }
          }
        }

        return {
          id:         p.id,
          code:       p.code,
          regal:      p.regal,
          reihe:      p.reihe,
          ebene:      p.ebene,
          fach:       p.fach,
          hersteller: p.hersteller,
          score,
          grund:      gruende.join(", "),
        };
      });

      scored.sort((a, b) => b.score - a.score);

      return {
        bereitsZugewiesen: false as const,
        voll:              false,
        vorschlaege:       scored.slice(0, 5).map((p, i) => ({ ...p, istEmpfehlung: i === 0 })),
      };
    }),

  // ── Zuweisen ───────────────────────────────────────────────────────────────

  zuweisen: adminProcedure
    .input(z.object({
      modellId:     z.number().int().positive(),
      lagerplatzId: z.number().int().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.$transaction(async (tx) => {
        const platz = await tx.lagerplatz.findUnique({ where: { id: input.lagerplatzId } });
        if (!platz) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Lagerplatz nicht gefunden" });
        }
        if (platz.modellId !== null) {
          throw new TRPCError({ code: "CONFLICT", message: `Lagerplatz ${platz.code} ist bereits belegt` });
        }

        const modell = await tx.geraeteModell.findUnique({
          where:   { id: input.modellId },
          include: { lagerplatz: true },
        });
        if (!modell) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Modell nicht gefunden" });
        }
        if (modell.lagerplatz) {
          throw new TRPCError({
            code:    "CONFLICT",
            message: `Modell hat bereits Lagerplatz ${modell.lagerplatz.code}. Nutze "umziehen".`,
          });
        }

        return tx.lagerplatz.update({
          where:   { id: input.lagerplatzId },
          data:    { modellId: input.modellId },
          include: { modell: { select: { id: true, modell: true, hersteller: true } } },
        });
      });
    }),

  // ── Umziehen ───────────────────────────────────────────────────────────────

  umziehen: adminProcedure
    .input(z.object({
      modellId:          z.number().int().positive(),
      neuerLagerplatzId: z.number().int().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.$transaction(async (tx) => {
        const modell = await tx.geraeteModell.findUnique({
          where:   { id: input.modellId },
          include: { lagerplatz: true },
        });
        if (!modell?.lagerplatz) {
          throw new TRPCError({
            code:    "BAD_REQUEST",
            message: 'Modell hat noch keinen Lagerplatz. Nutze "zuweisen".',
          });
        }

        const neuerPlatz = await tx.lagerplatz.findUnique({ where: { id: input.neuerLagerplatzId } });
        if (!neuerPlatz) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Neuer Lagerplatz nicht gefunden" });
        }
        if (neuerPlatz.modellId !== null && neuerPlatz.modellId !== input.modellId) {
          throw new TRPCError({ code: "CONFLICT", message: `${neuerPlatz.code} ist bereits belegt` });
        }

        const alterCode = modell.lagerplatz.code;

        await tx.lagerplatz.update({
          where: { id: modell.lagerplatz.id },
          data:  { modellId: null },
        });
        const result = await tx.lagerplatz.update({
          where:   { id: input.neuerLagerplatzId },
          data:    { modellId: input.modellId },
          include: { modell: true },
        });

        return { result, von: alterCode, nach: neuerPlatz.code };
      });
    }),

  // ── Lösen ──────────────────────────────────────────────────────────────────

  loesen: adminProcedure
    .input(z.object({ lagerplatzId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const platz = await ctx.prisma.lagerplatz.findUnique({ where: { id: input.lagerplatzId } });
      if (!platz) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Lagerplatz nicht gefunden" });
      }
      if (!platz.modellId) return platz; // bereits frei — idempotent

      return ctx.prisma.lagerplatz.update({
        where: { id: input.lagerplatzId },
        data:  { modellId: null },
      });
    }),
});

// ── Lokaler Typ für Score-Berechnung ───────────────────────────────────────

type ScoredPlatz = {
  id:         number;
  code:       string;
  regal:      number;
  reihe:      number;
  ebene:      number;
  fach:       number;
  hersteller: string | null;
  score:      number;
  grund:      string;
};
