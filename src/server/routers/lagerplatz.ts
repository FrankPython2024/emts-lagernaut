import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, adminProcedure, permissionProcedure } from "@/server/trpc";

// Read-Procedure für Lagerplatz (BETRACHTER bekommt LAGERPLATZ_VIEW).
const lagerplatzReadProcedure = permissionProcedure("LAGERPLATZ_VIEW");
import { extractSerie } from "@/lib/lager/serien";
import { prisma as _prisma } from "@/core/db/prisma";
import { standortWhere } from "@/lib/auth/standortFilter";
import { STANDARD_TEILTYPEN, VERSCHIEDENES_TEILTYP } from "@/lib/constants/teiltypen";

type PrismaInstance = typeof _prisma;

// Geschäftsregel: 1 Fach = mehrere Modelle DESSELBEN Herstellers, max 4 (= 4 Boxen).
const MAX_MODELLE_PRO_FACH = 4;

// ── Lokale Typen ──────────────────────────────────────────────────────────────

type ArtikelMitGrading = {
  id:             number;
  bezeichnung:    string;
  kategorie:      string;
  bestand:        number;
  grading:        string | null;
  letzteBuchung:  Date | null;
};

/**
 * Aggregiert die Artikel einer Belegung pro Teiltyp (= kategorie) zu EINER Zeile
 * mit Pool-Bestand (Summe) — konsistent mit dem Techniker-Portal
 * (getByGeraetMitStandard). Repräsentant (id/grading/bezeichnung) ist der Artikel
 * mit dem höchsten Einzelbestand. "Verschiedenes" wird NICHT aggregiert —
 * jede Freitext-Variante bleibt eine eigene Zeile. Sortierung nach STANDARD_TEILTYPEN.
 */
function aggregiereNachTeiltyp(artikel: ArtikelMitGrading[]): ArtikelMitGrading[] {
  const gruppen = new Map<string, ArtikelMitGrading[]>();
  const verschiedenes: ArtikelMitGrading[] = [];

  for (const a of artikel) {
    if (a.kategorie === VERSCHIEDENES_TEILTYP) { verschiedenes.push(a); continue; }
    const arr = gruppen.get(a.kategorie) ?? [];
    arr.push(a);
    gruppen.set(a.kategorie, arr);
  }

  const standard = [...gruppen.values()].map((arr) => {
    const sortiert = [...arr].sort((x, y) => y.bestand - x.bestand);
    const primaer  = sortiert[0]!;
    const bestand  = sortiert.reduce((s, x) => s + x.bestand, 0);
    return { ...primaer, bestand };
  });

  const idx = (name: string) => {
    const i = STANDARD_TEILTYPEN.findIndex((t) => t.name === name);
    return i === -1 ? 999 : i;
  };
  standard.sort((a, b) => idx(a.kategorie) - idx(b.kategorie));

  return [...standard, ...verschiedenes];
}

// Kandidat = Fach mit Restkapazität (leer ODER teilbelegt mit gleichem Hersteller)
type KandidatPlatz = {
  id:               number;
  code:             string;
  regal:            number;
  reihe:            number;
  ebene:            number;
  fach:             number;
  hersteller:       string | null; // Fach-Region-Hinweis
  belegt:           number;        // Anzahl Modelle aktuell im Fach
  modellHersteller: string | null; // Hersteller der Belegung (null = leer)
  modelle:          string[];      // Modellnamen im Fach
};

type ScoredPlatz = {
  id:         number;
  code:       string;
  regal:      number;
  reihe:      number;
  ebene:      number;
  fach:       number;
  hersteller: string | null;
  belegt:     number;
  frei:       number;
  score:      number;
  grund:      string;
};

// ── Kapazität / Hersteller-Reinheit (für Mutations, in $transaction nutzen) ─────

async function fachKapazitaet(
  tx:           Pick<PrismaInstance, "lagerplatzBelegung">,
  lagerplatzId: number,
): Promise<{ belegt: number; frei: number; voll: boolean }> {
  const belegt = await tx.lagerplatzBelegung.count({ where: { lagerplatzId } });
  return { belegt, frei: MAX_MODELLE_PRO_FACH - belegt, voll: belegt >= MAX_MODELLE_PRO_FACH };
}

// Hersteller der aktuellen Belegung eines Fachs — null = Fach leer (alle erlaubt)
async function fachHersteller(
  tx:           Pick<PrismaInstance, "lagerplatzBelegung">,
  lagerplatzId: number,
): Promise<string | null> {
  const erste = await tx.lagerplatzBelegung.findFirst({
    where:   { lagerplatzId },
    include: { modell: { select: { hersteller: true } } },
  });
  return erste?.modell.hersteller ?? null;
}

// ── Shared: Kandidaten laden + scoren ──────────────────────────────────────────

async function ladeGeschwister(
  prisma:      PrismaInstance,
  hersteller:  string,
  familie:     string | null,
  standortId?: number,
): Promise<{ regal: number; fach: number; ebene: number; serie: string | null }[]> {
  if (!familie || !hersteller) return [];

  const naheVerwandte = await prisma.lagerplatzBelegung.findMany({
    where: {
      ...(standortId != null ? { lagerplatz: { standortId } } : {}),
      modell: {
        aktiv: true,
        hersteller,
        modell: { contains: familie },
      },
    },
    include: {
      modell:     { select: { modell: true } },
      lagerplatz: { select: { regal: true, fach: true, ebene: true } },
    },
  });

  return naheVerwandte.map((b) => ({
    regal:  b.lagerplatz.regal,
    fach:   b.lagerplatz.fach,
    ebene:  b.lagerplatz.ebene,
    serie:  extractSerie(b.modell.modell).serie,
  }));
}

// Lädt alle Fächer mit Restkapazität für einen Ziel-Hersteller:
// - leere Fächer (belegt < 4, jeder Hersteller erlaubt)
// - teilbelegte Fächer NUR wenn gleicher Hersteller (Reinheit) UND belegt < 4
async function ladeKandidaten(
  prisma:        PrismaInstance,
  standortWo:    Record<string, unknown>,
  zielHersteller: string,
): Promise<KandidatPlatz[]> {
  const faecher = await prisma.lagerplatz.findMany({
    where:   standortWo,
    include: { belegungen: { include: { modell: { select: { hersteller: true, modell: true } } } } },
    orderBy: [{ reihe: "asc" }, { fach: "desc" }, { ebene: "asc" }],
  });

  const kandidaten: KandidatPlatz[] = [];
  for (const f of faecher) {
    const belegt = f.belegungen.length;
    if (belegt >= MAX_MODELLE_PRO_FACH) continue; // voll
    const modellHersteller = belegt > 0 ? (f.belegungen[0]!.modell.hersteller) : null;
    // Hersteller-Reinheit: teilbelegtes Fach nur bei passendem Hersteller
    if (belegt > 0 && modellHersteller !== zielHersteller) continue;
    kandidaten.push({
      id:               f.id,
      code:             f.code,
      regal:            f.regal,
      reihe:            f.reihe,
      ebene:            f.ebene,
      fach:             f.fach,
      hersteller:       f.hersteller,
      belegt,
      modellHersteller,
      modelle:          f.belegungen.map((b) => b.modell.modell),
    });
  }
  return kandidaten;
}

function scoreFreiePlaetze(
  kandidaten:  KandidatPlatz[],
  hersteller:  string,
  familie:     string | null,
  serie:       string | null,
  geschwister: { regal: number; fach: number; ebene: number; serie: string | null }[],
): (ScoredPlatz & { istEmpfehlung: boolean })[] {
  const scored: ScoredPlatz[] = kandidaten.map((p) => {
    let score = 0;
    const gruende: string[] = [];

    if (p.belegt > 0 && p.modellHersteller === hersteller) {
      // Konsolidierung: teilbelegtes Fach gleicher Hersteller stark bevorzugen
      score += 150;
      gruende.push(`${p.belegt} verwandte${p.belegt === 1 ? "s" : ""} ${hersteller}-Modell${p.belegt === 1 ? "" : "e"} hier`);
    } else if (p.hersteller === hersteller) {
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
      belegt:     p.belegt,
      frei:       MAX_MODELLE_PRO_FACH - p.belegt,
      score,
      grund:      gruende.join(", "),
    };
  });

  // Tiebreaker: höherer Score, dann weniger frei (volle Fächer zuerst füllen)
  scored.sort((a, b) => b.score - a.score || a.frei - b.frei);
  return scored.slice(0, 5).map((p, i) => ({ ...p, istEmpfehlung: i === 0 }));
}

// ── Router ─────────────────────────────────────────────────────────────────────

export const lagerplatzRouter = createTRPCRouter({

  // ── Lesende Endpoints ──────────────────────────────────────────────────────

  list: lagerplatzReadProcedure
    .input(z.object({ standortId: z.number().int().positive().nullish() }).optional())
    .query(({ ctx, input }) =>
      ctx.prisma.lagerplatz.findMany({
        where:   standortWhere(ctx, input?.standortId),
        include: { belegungen: { include: { modell: { select: { id: true, modell: true, hersteller: true } } } } },
        orderBy: [{ reihe: "asc" }, { fach: "desc" }, { ebene: "asc" }],
      })
    ),

  // Leichtgewichtige Übersicht für Grid-Anzeige (kein Artikel-Load)
  uebersicht: lagerplatzReadProcedure
    .input(z.object({ standortId: z.number().int().positive().nullish() }).optional())
    .query(({ ctx, input }) =>
      ctx.prisma.lagerplatz.findMany({
        where:   standortWhere(ctx, input?.standortId),
        include: { belegungen: { include: { modell: { select: { id: true, modell: true, hersteller: true } } } } },
        orderBy: [{ reihe: "asc" }, { fach: "desc" }, { ebene: "asc" }],
      })
    ),

  // Detail für Modal — alle Belegungen des Fachs + Artikel/Grading je Modell
  platzDetail: lagerplatzReadProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const platz = await ctx.prisma.lagerplatz.findUnique({
        where:   { id: input.id },
        include: { belegungen: { include: { modell: true }, orderBy: { erstelltAm: "asc" } } },
      });
      if (!platz) return { platz: null, belegungen: [] };

      const belegungen = await Promise.all(
        platz.belegungen.map(async (b) => {
          const sauber    = b.modell.modell;
          const mitPrefix = `${b.modell.hersteller} ${sauber}`;

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

          return {
            modellId:   b.modellId,
            modellName: b.modell.modell,
            hersteller: b.modell.hersteller,
            erstelltAm: b.erstelltAm,
            artikel:    aggregiereNachTeiltyp(artikelMitGrading),
          };
        }),
      );

      const { id, code, regal, reihe, ebene, fach, hersteller } = platz;
      return {
        platz:      { id, code, regal, reihe, ebene, fach, hersteller, belegt: belegungen.length },
        belegungen,
      };
    }),

  listByReihe: lagerplatzReadProcedure.query(async ({ ctx }) => {
    const alle = await ctx.prisma.lagerplatz.findMany({
      include: { belegungen: { include: { modell: { select: { id: true, modell: true, hersteller: true } } } } },
      orderBy: [{ reihe: "asc" }, { fach: "desc" }, { ebene: "asc" }],
    });

    const grouped: Record<number, typeof alle[number][]> = {};
    for (const p of alle) {
      if (!grouped[p.reihe]) grouped[p.reihe] = [];
      grouped[p.reihe].push(p);
    }
    return grouped;
  }),

  byCode: lagerplatzReadProcedure
    .input(z.object({ code: z.string() }))
    .query(({ ctx, input }) =>
      ctx.prisma.lagerplatz.findUnique({
        where:   { code: input.code },
        include: { belegungen: { include: { modell: true } } },
      })
    ),

  // Fach eines Modells (über Belegung) — null wenn nicht zugewiesen
  byModellId: lagerplatzReadProcedure
    .input(z.object({ modellId: z.number() }))
    .query(async ({ ctx, input }) => {
      const belegung = await ctx.prisma.lagerplatzBelegung.findUnique({
        where:   { modellId: input.modellId },
        include: { lagerplatz: true },
      });
      return belegung?.lagerplatz ?? null;
    }),

  // Fächer mit Restkapazität (belegt < 4). Optional hersteller-gefiltert:
  // leere Fächer immer, teilbelegte nur bei gleichem Hersteller (Reinheit).
  free: lagerplatzReadProcedure
    .input(z.object({
      hersteller: z.string().optional(),
      standortId: z.number().int().positive().nullish(),
    }))
    .query(async ({ ctx, input }) => {
      const faecher = await ctx.prisma.lagerplatz.findMany({
        where:   standortWhere(ctx, input.standortId),
        include: { belegungen: { include: { modell: { select: { hersteller: true, modell: true } } } } },
        orderBy: [{ reihe: "asc" }, { fach: "desc" }, { ebene: "asc" }],
      });

      return faecher
        .map((f) => {
          const belegt = f.belegungen.length;
          const modellHersteller = belegt > 0 ? f.belegungen[0]!.modell.hersteller : null;
          return {
            id:               f.id,
            code:             f.code,
            regal:            f.regal,
            reihe:            f.reihe,
            ebene:            f.ebene,
            fach:             f.fach,
            hersteller:       f.hersteller,
            belegt,
            frei:             MAX_MODELLE_PRO_FACH - belegt,
            modellHersteller,
            modelle:          f.belegungen.map((b) => b.modell.modell),
          };
        })
        .filter((f) =>
          f.frei > 0 &&
          (input.hersteller ? (f.belegt === 0 || f.modellHersteller === input.hersteller) : true),
        );
    }),

  // ── Vorschlag (nach ModellId) ──────────────────────────────────────────────

  vorschlag: lagerplatzReadProcedure
    .input(z.object({
      modellId:   z.number().int().positive(),
      standortId: z.number().int().positive().nullish(),
    }))
    .query(async ({ ctx, input }) => {
      const sId  = standortWhere(ctx, input.standortId);
      const sIdN = (sId.standortId as number | undefined) ?? null;

      const modell = await ctx.prisma.geraeteModell.findUnique({
        where:   { id: input.modellId },
        include: { belegung: { include: { lagerplatz: true } } },
      });
      if (!modell) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Modell nicht gefunden" });
      }

      if (modell.belegung) {
        return {
          bereitsZugewiesen: true  as const,
          platz:             modell.belegung.lagerplatz,
          modellId:          modell.id,
          vorschlaege:       [] as (ScoredPlatz & { istEmpfehlung: boolean })[],
          voll:              false,
        };
      }

      const kandidaten = await ladeKandidaten(ctx.prisma as PrismaInstance, sId, modell.hersteller);

      if (kandidaten.length === 0) {
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
        vorschlaege:       scoreFreiePlaetze(kandidaten, modell.hersteller, familie, serie, geschwister),
      };
    }),

  // ── Vorschlag (nach Gerätename — für Wizard vor execute) ──────────────────

  vorschlagByName: lagerplatzReadProcedure
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
            include: { belegung: { include: { lagerplatz: true } } },
          })
        : null;

      if (modell?.belegung) {
        return {
          bereitsZugewiesen: true  as const,
          platz:             modell.belegung.lagerplatz,
          modellId:          modell.id,
          vorschlaege:       [] as (ScoredPlatz & { istEmpfehlung: boolean })[],
          voll:              false,
        };
      }

      const kandidaten = await ladeKandidaten(ctx.prisma as PrismaInstance, sId, hersteller);

      if (kandidaten.length === 0) {
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
        vorschlaege:       scoreFreiePlaetze(kandidaten, hersteller, familie, serie, geschwister),
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

        const modell = await tx.geraeteModell.findUnique({
          where:   { id: input.modellId },
          include: { belegung: { include: { lagerplatz: true } } },
        });
        if (!modell) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Modell nicht gefunden" });
        }
        if (!modell.aktiv) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Inaktives Modell kann keinen Lagerplatz erhalten" });
        }
        if (modell.belegung) {
          throw new TRPCError({
            code:    "CONFLICT",
            message: `Modell hat bereits Lagerplatz ${modell.belegung.lagerplatz.code}. Nutze "umziehen".`,
          });
        }

        // Kapazität (max 4 Modelle pro Fach)
        const kap = await fachKapazitaet(tx, input.lagerplatzId);
        if (kap.voll) {
          throw new TRPCError({ code: "CONFLICT", message: `Fach ${platz.code} ist voll (max ${MAX_MODELLE_PRO_FACH} Modelle).` });
        }

        // Hersteller-Reinheit
        const fachHerst = await fachHersteller(tx, input.lagerplatzId);
        if (fachHerst && modell.hersteller !== fachHerst) {
          throw new TRPCError({
            code:    "BAD_REQUEST",
            message: `Fach ${platz.code} enthält ${fachHerst}-Modelle, ${modell.hersteller} ist nicht erlaubt.`,
          });
        }

        await tx.lagerplatzBelegung.create({ data: { lagerplatzId: input.lagerplatzId, modellId: input.modellId } });

        // Artikel.lagerplatz synchronisieren
        const n = modell.modell;
        await tx.artikel.updateMany({
          where: { OR: [{ bezeichnung: n }, { bezeichnung: { startsWith: `${n} ` } }] },
          data:  { lagerplatz: platz.code },
        });

        return tx.lagerplatz.findUnique({
          where:   { id: input.lagerplatzId },
          include: { belegungen: { include: { modell: { select: { id: true, modell: true, hersteller: true } } } } },
        });
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

        // Schon in genau diesem Fach? → idempotent
        const bestehend = await tx.lagerplatzBelegung.findUnique({ where: { modellId: modell.id } });
        if (bestehend && bestehend.lagerplatzId === input.lagerplatzId) {
          return tx.lagerplatz.findUnique({
            where:   { id: input.lagerplatzId },
            include: { belegungen: { include: { modell: { select: { id: true, modell: true, hersteller: true } } } } },
          });
        }

        // Kapazität + Hersteller-Reinheit prüfen
        const kap = await fachKapazitaet(tx, input.lagerplatzId);
        if (kap.voll) {
          throw new TRPCError({ code: "CONFLICT", message: `Fach ${platz.code} ist voll (max ${MAX_MODELLE_PRO_FACH} Modelle).` });
        }
        const fachHerst = await fachHersteller(tx, input.lagerplatzId);
        if (fachHerst && modell.hersteller !== fachHerst) {
          throw new TRPCError({
            code:    "BAD_REQUEST",
            message: `Fach ${platz.code} enthält ${fachHerst}-Modelle, ${modell.hersteller} ist nicht erlaubt.`,
          });
        }

        // Belegung verschieben (alte löschen, neue anlegen)
        if (bestehend) {
          await tx.lagerplatzBelegung.delete({ where: { id: bestehend.id } });
        }
        await tx.lagerplatzBelegung.create({ data: { lagerplatzId: input.lagerplatzId, modellId: modell.id } });

        // Artikel.lagerplatz synchronisieren
        const n = modell.modell;
        await tx.artikel.updateMany({
          where: { OR: [{ bezeichnung: n }, { bezeichnung: { startsWith: `${n} ` } }] },
          data:  { lagerplatz: platz.code },
        });

        return tx.lagerplatz.findUnique({
          where:   { id: input.lagerplatzId },
          include: { belegungen: { include: { modell: { select: { id: true, modell: true, hersteller: true } } } } },
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
          include: { belegung: { include: { lagerplatz: true } } },
        });
        if (!modell) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Modell nicht gefunden" });
        }
        if (!modell.aktiv) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Inaktives Modell kann nicht umgezogen werden" });
        }
        if (!modell.belegung) {
          throw new TRPCError({
            code:    "BAD_REQUEST",
            message: 'Modell hat noch keinen Lagerplatz. Nutze "zuweisen".',
          });
        }

        const neuerPlatz = await tx.lagerplatz.findUnique({ where: { id: input.neuerLagerplatzId } });
        if (!neuerPlatz) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Neuer Lagerplatz nicht gefunden" });
        }

        const alterCode  = modell.belegung.lagerplatz.code;
        const modellName = modell.modell;

        // Wenn Ziel == aktuelles Fach: nichts zu tun
        if (modell.belegung.lagerplatzId !== input.neuerLagerplatzId) {
          // Kapazität + Hersteller-Reinheit im Ziel-Fach
          const kap = await fachKapazitaet(tx, input.neuerLagerplatzId);
          if (kap.voll) {
            throw new TRPCError({ code: "CONFLICT", message: `Fach ${neuerPlatz.code} ist voll (max ${MAX_MODELLE_PRO_FACH} Modelle).` });
          }
          const fachHerst = await fachHersteller(tx, input.neuerLagerplatzId);
          if (fachHerst && modell.hersteller !== fachHerst) {
            throw new TRPCError({
              code:    "BAD_REQUEST",
              message: `Fach ${neuerPlatz.code} enthält ${fachHerst}-Modelle, ${modell.hersteller} ist nicht erlaubt.`,
            });
          }

          await tx.lagerplatzBelegung.update({
            where: { id: modell.belegung.id },
            data:  { lagerplatzId: input.neuerLagerplatzId },
          });

          // Artikel.lagerplatz auf neuen Code aktualisieren
          await tx.artikel.updateMany({
            where: { OR: [{ bezeichnung: modellName }, { bezeichnung: { startsWith: `${modellName} ` } }] },
            data:  { lagerplatz: neuerPlatz.code },
          });
        }

        const result = await tx.lagerplatz.findUnique({
          where:   { id: input.neuerLagerplatzId },
          include: { belegungen: { include: { modell: { select: { id: true, modell: true, hersteller: true } } } } },
        });

        return { result, von: alterCode, nach: neuerPlatz.code };
      });
    }),

  // ── Lösen (eine Modell-Belegung aus dem Fach entfernen) ─────────────────────

  loesen: adminProcedure
    .input(z.object({ modellId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.$transaction(async (tx) => {
        const belegung = await tx.lagerplatzBelegung.findUnique({
          where:   { modellId: input.modellId },
          include: { modell: { select: { modell: true } } },
        });
        if (!belegung) return { geloest: false as const }; // bereits frei — idempotent

        await tx.lagerplatzBelegung.delete({ where: { id: belegung.id } });

        // Artikel.lagerplatz leeren
        const n = belegung.modell.modell;
        await tx.artikel.updateMany({
          where: { OR: [{ bezeichnung: n }, { bezeichnung: { startsWith: `${n} ` } }] },
          data:  { lagerplatz: null },
        });

        return { geloest: true as const };
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
        const belegt = await ctx.prisma.lagerplatzBelegung.count({
          where: { lagerplatz: { standortId: input.standortId } },
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
  getRegalKonfig: lagerplatzReadProcedure
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
