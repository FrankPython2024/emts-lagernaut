import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, adminProcedure } from "@/server/trpc";
import { extractSerie } from "@/lib/lager/serien";
import { prisma as _prisma } from "@/core/db/prisma";
import { standortWhere } from "@/lib/auth/standortFilter";

type PrismaInstance = typeof _prisma;

// ── Lokale Typen ──────────────────────────────────────────────────────────────

type ArtikelMitGrading = {
  id:             number;
  bezeichnung:    string;
  kategorie:      string;
  bestand:        number;
  grading:        string | null;
  letzteBuchung:  Date | null;
};

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

type FreierPlatz = {
  id:         number;
  code:       string;
  regal:      number;
  reihe:      number;
  ebene:      number;
  fach:       number;
  hersteller: string | null;
};

// ── Shared Score-Berechnung ────────────────────────────────────────────────────

async function ladeGeschwister(
  prisma:      PrismaInstance,
  hersteller:  string,
  familie:     string | null,
  standortId?: number,
): Promise<{ regal: number; fach: number; ebene: number; serie: string | null }[]> {
  if (!familie || !hersteller) return [];

  const naheVerwandte = await prisma.lagerplatz.findMany({
    where: {
      modellId: { not: null },
      ...(standortId != null ? { standortId } : {}),
      modell: {
        aktiv: true,
        hersteller,
        modell: { contains: familie },
      },
    },
    include: { modell: { select: { modell: true } } },
  });

  return naheVerwandte.map((p) => ({
    regal:  p.regal,
    fach:   p.fach,
    ebene:  p.ebene,
    serie:  extractSerie(p.modell?.modell ?? "").serie,
  }));
}

function scoreFreiePlaetze(
  freie:       FreierPlatz[],
  hersteller:  string,
  familie:     string | null,
  serie:       string | null,
  geschwister: { regal: number; fach: number; ebene: number; serie: string | null }[],
): (ScoredPlatz & { istEmpfehlung: boolean })[] {
  const scored: ScoredPlatz[] = freie.map((p) => {
    let score = 0;
    const gruende: string[] = [];

    if (p.hersteller === hersteller) {
      score += 100;
      gruende.push(`bevorzugte ${hersteller}-Region`);
    } else if (hersteller === "Fujitsu" || p.hersteller === null) {
      score += 30;
      gruende.push("flexibler Platz");
    } else {
      score += 5;
      gruende.push(`außerhalb ${hersteller}-Region`);
    }

    score += p.fach * 8;
    score += Math.max(0, 7 - p.ebene) * 3;

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
  return scored.slice(0, 5).map((p, i) => ({ ...p, istEmpfehlung: i === 0 }));
}

// ── Router ─────────────────────────────────────────────────────────────────────

export const lagerplatzRouter = createTRPCRouter({

  // ── Lesende Endpoints ──────────────────────────────────────────────────────

  list: adminProcedure
    .input(z.object({ standortId: z.number().int().positive().nullish() }).optional())
    .query(({ ctx, input }) =>
      ctx.prisma.lagerplatz.findMany({
        where:   standortWhere(ctx, input?.standortId),
        include: { modell: { select: { id: true, modell: true, hersteller: true } } },
        orderBy: [{ reihe: "asc" }, { fach: "desc" }, { ebene: "asc" }],
      })
    ),

  // Leichtgewichtige Übersicht für Grid-Anzeige (kein Artikel-Load)
  uebersicht: adminProcedure
    .input(z.object({ standortId: z.number().int().positive().nullish() }).optional())
    .query(({ ctx, input }) =>
      ctx.prisma.lagerplatz.findMany({
        where:   standortWhere(ctx, input?.standortId),
        include: { modell: { select: { id: true, modell: true, hersteller: true } } },
        orderBy: [{ reihe: "asc" }, { fach: "desc" }, { ebene: "asc" }],
      })
    ),

  // Detail für Modal — lädt Artikel + Grading nur bei Klick
  platzDetail: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const platz = await ctx.prisma.lagerplatz.findUnique({
        where:   { id: input.id },
        include: { modell: true },
      });
      if (!platz?.modell) return { platz, artikel: [] as ArtikelMitGrading[] };

      const sauber    = platz.modell.modell;
      const mitPrefix = `${platz.modell.hersteller} ${sauber}`;

      const artikel = await ctx.prisma.artikel.findMany({
        where: {
          OR: [
            { bezeichnung: { startsWith: sauber } },
            { bezeichnung: { startsWith: mitPrefix } },
          ],
        },
        select:  { id: true, bezeichnung: true, kategorie: true, bestand: true },
        orderBy: { kategorie: "asc" },
      });

      const artikelMitGrading: ArtikelMitGrading[] = await Promise.all(
        artikel.map(async (a) => {
          const letzteBuchung = await ctx.prisma.buchung.findFirst({
            where:   { artikelId: a.id, typ: "EINGANG" },
            orderBy: { datum: "desc" },
            select:  { notiz: true, datum: true },
          });
          const m = letzteBuchung?.notiz?.match(/Grading:\s*(A\+|A|B|C)/i);
          return { ...a, grading: m?.[1] ?? null, letzteBuchung: letzteBuchung?.datum ?? null };
        }),
      );

      return { platz, artikel: artikelMitGrading };
    }),

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
    .input(z.object({
      hersteller: z.string().optional(),
      standortId: z.number().int().positive().nullish(),
    }))
    .query(({ ctx, input }) =>
      ctx.prisma.lagerplatz.findMany({
        where: {
          ...standortWhere(ctx, input.standortId),
          modellId: null,
          ...(input.hersteller ? { hersteller: input.hersteller } : {}),
        },
        orderBy: [{ reihe: "asc" }, { fach: "desc" }, { ebene: "asc" }],
      })
    ),

  // ── Vorschlag (nach ModellId) ──────────────────────────────────────────────

  vorschlag: adminProcedure
    .input(z.object({
      modellId:   z.number().int().positive(),
      standortId: z.number().int().positive().nullish(),
    }))
    .query(async ({ ctx, input }) => {
      const sId  = standortWhere(ctx, input.standortId);
      const sIdN = (sId.standortId as number | undefined) ?? null;

      const modell = await ctx.prisma.geraeteModell.findUnique({
        where:   { id: input.modellId },
        include: { lagerplatz: true },
      });
      if (!modell) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Modell nicht gefunden" });
      }

      if (modell.lagerplatz) {
        return {
          bereitsZugewiesen: true  as const,
          platz:             modell.lagerplatz,
          modellId:          modell.id,
          vorschlaege:       [] as (ScoredPlatz & { istEmpfehlung: boolean })[],
          voll:              false,
        };
      }

      const freie = await ctx.prisma.lagerplatz.findMany({
        where:   { ...sId, modellId: null },
        orderBy: [{ reihe: "asc" }, { fach: "desc" }, { ebene: "asc" }],
      });

      if (freie.length === 0) {
        return {
          bereitsZugewiesen: false as const,
          modellId:          modell.id,
          vorschlaege:       [] as (ScoredPlatz & { istEmpfehlung: boolean })[],
          voll:              true,
        };
      }

      const { familie, serie } = extractSerie(modell.modell);
      const geschwister = await ladeGeschwister(ctx.prisma as PrismaInstance, modell.hersteller, familie, sIdN ?? undefined);

      return {
        bereitsZugewiesen: false as const,
        modellId:          modell.id,
        voll:              false,
        vorschlaege:       scoreFreiePlaetze(freie, modell.hersteller, familie, serie, geschwister),
      };
    }),

  // ── Vorschlag (nach Gerätename — für Wizard vor execute) ──────────────────

  vorschlagByName: adminProcedure
    .input(z.object({
      geraetName: z.string().min(1),
      standortId: z.number().int().positive().nullish(),
    }))
    .query(async ({ ctx, input }) => {
      const sId        = standortWhere(ctx, input.standortId);
      const sIdN       = (sId.standortId as number | undefined) ?? null;
      const hersteller = input.geraetName.split(" ")[0] ?? "";

      const modell = hersteller
        ? await ctx.prisma.geraeteModell.findFirst({
            where:   { modell: input.geraetName, aktiv: true },
            include: { lagerplatz: true },
          })
        : null;

      if (modell?.lagerplatz) {
        return {
          bereitsZugewiesen: true  as const,
          platz:             modell.lagerplatz,
          modellId:          modell.id,
          vorschlaege:       [] as (ScoredPlatz & { istEmpfehlung: boolean })[],
          voll:              false,
        };
      }

      const freie = await ctx.prisma.lagerplatz.findMany({
        where:   { ...sId, modellId: null },
        orderBy: [{ reihe: "asc" }, { fach: "desc" }, { ebene: "asc" }],
      });

      if (freie.length === 0) {
        return {
          bereitsZugewiesen: false as const,
          modellId:          modell?.id ?? null,
          vorschlaege:       [] as (ScoredPlatz & { istEmpfehlung: boolean })[],
          voll:              true,
        };
      }

      const { familie, serie } = extractSerie(input.geraetName);
      const geschwister = await ladeGeschwister(ctx.prisma as PrismaInstance, hersteller, familie, sIdN ?? undefined);

      return {
        bereitsZugewiesen: false as const,
        modellId:          modell?.id ?? null,
        voll:              false,
        vorschlaege:       scoreFreiePlaetze(freie, hersteller, familie, serie, geschwister),
      };
    }),

  // ── Zuweisen (transaktional) ───────────────────────────────────────────────

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
        if (!modell.aktiv) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Inaktives Modell kann keinen Lagerplatz erhalten" });
        }
        if (modell.lagerplatz) {
          throw new TRPCError({
            code:    "CONFLICT",
            message: `Modell hat bereits Lagerplatz ${modell.lagerplatz.code}. Nutze "umziehen".`,
          });
        }

        const ergebnis = await tx.lagerplatz.update({
          where:   { id: input.lagerplatzId },
          data:    { modellId: input.modellId },
          include: { modell: { select: { id: true, modell: true, hersteller: true } } },
        });

        // Artikel.lagerplatz synchronisieren
        if (ergebnis.modell) {
          const n = ergebnis.modell.modell;
          await tx.artikel.updateMany({
            where: { OR: [{ bezeichnung: n }, { bezeichnung: { startsWith: `${n} ` } }] },
            data:  { lagerplatz: ergebnis.code },
          });
        }
        return ergebnis;
      });
    }),

  // ── Zuweisen nach Gerätename (für Wizard nach execute) ────────────────────

  zuweisenNachName: adminProcedure
    .input(z.object({
      geraetName:   z.string().min(1),
      lagerplatzId: z.number().int().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      const modell = await ctx.prisma.geraeteModell.findFirst({
        where: { modell: input.geraetName, aktiv: true },
      });
      if (!modell) {
        throw new TRPCError({
          code:    "NOT_FOUND",
          message: `Modell "${input.geraetName}" nicht gefunden (oder inaktiv). Zuerst einbuchen.`,
        });
      }

      return ctx.prisma.$transaction(async (tx) => {
        const platz = await tx.lagerplatz.findUnique({ where: { id: input.lagerplatzId } });
        if (!platz) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Lagerplatz nicht gefunden" });
        }
        if (platz.modellId !== null && platz.modellId !== modell.id) {
          throw new TRPCError({ code: "CONFLICT", message: `${platz.code} ist bereits belegt (Race-Condition)` });
        }

        // Alten Platz freigeben falls vorhanden
        const alterPlatz = await tx.lagerplatz.findUnique({ where: { modellId: modell.id } });
        if (alterPlatz) {
          await tx.lagerplatz.update({ where: { id: alterPlatz.id }, data: { modellId: null } });
        }

        const ergebnis = await tx.lagerplatz.update({
          where:   { id: input.lagerplatzId },
          data:    { modellId: modell.id },
          include: { modell: { select: { id: true, modell: true, hersteller: true } } },
        });

        // Artikel.lagerplatz synchronisieren
        const n = modell.modell;
        await tx.artikel.updateMany({
          where: { OR: [{ bezeichnung: n }, { bezeichnung: { startsWith: `${n} ` } }] },
          data:  { lagerplatz: ergebnis.code },
        });
        return ergebnis;
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
        if (!modell) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Modell nicht gefunden" });
        }
        if (!modell.aktiv) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Inaktives Modell kann nicht umgezogen werden" });
        }
        if (!modell.lagerplatz) {
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

        const alterCode  = modell.lagerplatz.code;
        const modellName = modell.modell;

        await tx.lagerplatz.update({
          where: { id: modell.lagerplatz.id },
          data:  { modellId: null },
        });
        const result = await tx.lagerplatz.update({
          where:   { id: input.neuerLagerplatzId },
          data:    { modellId: input.modellId },
          include: { modell: true },
        });

        // Artikel.lagerplatz auf neuen Code aktualisieren
        await tx.artikel.updateMany({
          where: { OR: [{ bezeichnung: modellName }, { bezeichnung: { startsWith: `${modellName} ` } }] },
          data:  { lagerplatz: neuerPlatz.code },
        });

        return { result, von: alterCode, nach: neuerPlatz.code };
      });
    }),

  // ── Lösen ──────────────────────────────────────────────────────────────────

  loesen: adminProcedure
    .input(z.object({ lagerplatzId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const platz = await ctx.prisma.lagerplatz.findUnique({
        where:   { id: input.lagerplatzId },
        include: { modell: { select: { modell: true } } },
      });
      if (!platz) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Lagerplatz nicht gefunden" });
      }
      if (!platz.modellId) return platz; // bereits frei — idempotent

      return ctx.prisma.$transaction(async (tx) => {
        const ergebnis = await tx.lagerplatz.update({
          where: { id: input.lagerplatzId },
          data:  { modellId: null },
        });

        // Artikel.lagerplatz leeren
        if (platz.modell) {
          const n = platz.modell.modell;
          await tx.artikel.updateMany({
            where: { OR: [{ bezeichnung: n }, { bezeichnung: { startsWith: `${n} ` } }] },
            data:  { lagerplatz: null },
          });
        }
        return ergebnis;
      });
    }),

  // ── Lagerstruktur-Generator ───────────────────────────────────────────────

  generateForStandort: adminProcedure
    .input(z.object({
      standortId: z.number().int().positive(),
      regale: z.array(z.object({
        name:            z.string().min(1).max(10),
        ebenen:          z.number().int().min(1).max(20),
        faecherProEbene: z.number().int().min(1).max(50),
      })).min(1).max(50),
      ueberschreiben: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const standort = await ctx.prisma.standort.findUnique({ where: { id: input.standortId } });
      if (!standort) throw new TRPCError({ code: "NOT_FOUND", message: "Standort nicht gefunden" });

      const existing = await ctx.prisma.lagerplatz.count({ where: { standortId: input.standortId } });

      if (existing > 0 && !input.ueberschreiben) {
        throw new TRPCError({
          code:    "CONFLICT",
          message: `${existing} Lagerplätze existieren bereits. Mit ueberschreiben=true erzwingen.`,
        });
      }

      if (input.ueberschreiben && existing > 0) {
        const belegt = await ctx.prisma.lagerplatz.count({
          where: { standortId: input.standortId, modellId: { not: null } },
        });
        if (belegt > 0) {
          throw new TRPCError({
            code:    "CONFLICT",
            message: `${belegt} Lagerplätze sind belegt — kann nicht überschreiben`,
          });
        }
        await ctx.prisma.lagerplatz.deleteMany({ where: { standortId: input.standortId } });
      }

      const plaetze: {
        code: string; standortId: number;
        regal: number; reihe: number; ebene: number; fach: number;
      }[] = [];

      input.regale.forEach((regal, idx) => {
        const regalNr = parseInt(regal.name, 10) || (idx + 1);
        for (let e = 1; e <= regal.ebenen; e++) {
          for (let f = 1; f <= regal.faecherProEbene; f++) {
            plaetze.push({
              code:       `${standort.kurzname}-${regal.name}-${e}-${f}`,
              standortId: input.standortId,
              regal:      regalNr,
              reihe:      regalNr,
              ebene:      e,
              fach:       f,
            });
          }
        }
      });

      await ctx.prisma.lagerplatz.createMany({ data: plaetze, skipDuplicates: true });

      return {
        angelegt:      plaetze.length,
        beispielCodes: plaetze.slice(0, 3).map((p) => p.code),
      };
    }),

  // Liest die Regal-Konfiguration eines Standorts aus bestehenden Plätzen
  getRegalKonfig: adminProcedure
    .input(z.object({ standortId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const plaetze = await ctx.prisma.lagerplatz.findMany({
        where:  { standortId: input.standortId },
        select: { code: true, regal: true, ebene: true, fach: true },
      });

      if (plaetze.length === 0) return { regale: [], total: 0 };

      // Gruppieren nach regal-Nummer
      const byRegal = new Map<number, { name: string; maxEbene: number; maxFach: number }>();
      for (const p of plaetze) {
        // Regal-Name aus Code extrahieren (Format: kurzname-regalName-ebene-fach)
        const parts    = p.code.split("-");
        const regalName = parts[1] ?? String(p.regal);
        const existing  = byRegal.get(p.regal);
        if (!existing) {
          byRegal.set(p.regal, { name: regalName, maxEbene: p.ebene, maxFach: p.fach });
        } else {
          existing.maxEbene = Math.max(existing.maxEbene, p.ebene);
          existing.maxFach  = Math.max(existing.maxFach,  p.fach);
        }
      }

      const regale = [...byRegal.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, r]) => ({ name: r.name, ebenen: r.maxEbene, faecherProEbene: r.maxFach }));

      return { regale, total: plaetze.length };
    }),
});
