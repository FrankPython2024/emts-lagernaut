import { z } from "zod";
import { EntsorgungBereich, EntsorgungStatus } from "@prisma/client";
import { createTRPCRouter, permissionProcedure } from "@/server/trpc";
import type { SessionUser } from "@/core/types";

// ── Entsorgung: Schrottabholung und Batterietransport ────────────────────────
//
// EIN Satz Prozeduren für beide Bereiche. Was sie unterscheidet, ist das Feld
// `bereich` — Beschriftung und Kapazitätsregel stehen in
// src/lib/entsorgung/bereiche.ts und gehen den Server nichts an.
//
// Ein Rechtepaar für beide: Es ist derselbe Vorgang mit denselben Papieren.
const sehen      = permissionProcedure("ENTSORGUNG_VIEW");
const bearbeiten = permissionProcedure("ENTSORGUNG_MANAGE");

/**
 * Behälternummer vereinheitlichen: nur Ziffern.
 *
 * Handscanner und Tastatur liefern dieselbe Nummer unterschiedlich
 * („3.202.971" und „3202971"). In der Auftragstabelle muss sie einheitlich
 * stehen, sonst sieht der Entsorger zwei Schreibweisen in einer Spalte.
 */
export function nummerNormal(roh: string): string {
  return roh.replace(/\D/g, "");
}

const gewicht        = z.number().int().min(0).max(100_000);
const bereichEingabe = z.nativeEnum(EntsorgungBereich);

export const entsorgungRouter = createTRPCRouter({
  // ── Stammdaten: Abfallarten ─────────────────────────────────────────────
  abfallarten: sehen
    .input(z.object({ bereich: bereichEingabe, auchInaktive: z.boolean().default(false) }))
    .query(({ ctx, input }) =>
      ctx.prisma.entsorgungAbfallart.findMany({
        where:   { bereich: input.bereich, ...(input.auchInaktive ? {} : { aktiv: true }) },
        orderBy: [{ sortierung: "asc" }, { bezeichnung: "asc" }],
      })),

  abfallartAnlegen: bearbeiten
    .input(z.object({
      bereich:     bereichEingabe,
      bezeichnung: z.string().trim().min(2).max(191),
      kurzform:    z.string().trim().min(1).max(40),
      schluessel:  z.string().trim().min(4).max(16),
      taraKg:      z.number().int().min(0).max(5000).nullable(),
      sortierung:  z.number().int().min(0).max(9999).default(500),
    }))
    .mutation(({ ctx, input }) =>
      ctx.prisma.entsorgungAbfallart.create({
        data: {
          ...input,
          // Schlüssel immer ohne Leerzeichen: „16 02 16" und „160216" sind
          // dieselbe Nummer und dürfen nicht zweimal entstehen.
          schluessel: input.schluessel.replace(/\s+/g, ""),
        },
      })),

  abfallartAktualisieren: bearbeiten
    .input(z.object({
      id:          z.number().int().positive(),
      bezeichnung: z.string().trim().min(2).max(191).optional(),
      kurzform:    z.string().trim().min(1).max(40).optional(),
      schluessel:  z.string().trim().min(4).max(16).optional(),
      taraKg:      z.number().int().min(0).max(5000).nullable().optional(),
      sortierung:  z.number().int().min(0).max(9999).optional(),
      aktiv:       z.boolean().optional(),
    }))
    .mutation(({ ctx, input }) => {
      const { id, schluessel, ...rest } = input;
      return ctx.prisma.entsorgungAbfallart.update({
        where: { id },
        data:  { ...rest, ...(schluessel ? { schluessel: schluessel.replace(/\s+/g, "") } : {}) },
      });
    }),

  // ── Aufträge ────────────────────────────────────────────────────────────
  auftraege: sehen
    .input(z.object({ bereich: bereichEingabe, status: z.nativeEnum(EntsorgungStatus).optional() }))
    .query(async ({ ctx, input }) => {
      const liste = await ctx.prisma.entsorgungAuftrag.findMany({
        where:   { bereich: input.bereich, ...(input.status ? { status: input.status } : {}) },
        orderBy: [{ datum: "desc" }, { id: "desc" }],
        take:    100,
        include: { _count: { select: { positionen: true } } },
      });

      // Gewichte je Auftrag in EINER Abfrage, nicht je Zeile.
      const summen = await ctx.prisma.entsorgungPosition.groupBy({
        by:    ["auftragId"],
        where: { auftragId: { in: liste.map((a) => a.id) } },
        _sum:  { bruttoKg: true, nettoKg: true },
      });
      const proAuftrag = new Map(summen.map((s) => [s.auftragId, s._sum]));

      return liste.map((a) => ({
        ...a,
        anzahl: a._count.positionen,
        brutto: proAuftrag.get(a.id)?.bruttoKg ?? 0,
        netto:  proAuftrag.get(a.id)?.nettoKg  ?? 0,
      }));
    }),

  auftrag: sehen
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const auftrag = await ctx.prisma.entsorgungAuftrag.findUnique({
        where:   { id: input.id },
        include: { positionen: { orderBy: [{ position: "asc" }, { id: "asc" }] } },
      });
      if (!auftrag) return null;

      const brutto = auftrag.positionen.reduce((s, p) => s + p.bruttoKg, 0);
      const netto  = auftrag.positionen.reduce((s, p) => s + p.nettoKg, 0);
      return { ...auftrag, brutto, netto };
    }),

  auftragAnlegen: bearbeiten
    .input(z.object({
      bereich:     bereichEingabe,
      bezeichnung: z.string().trim().min(2).max(191),
      datum:       z.string().datetime(),
      notiz:       z.string().trim().max(2000).optional(),
    }))
    .mutation(({ ctx, input }) => {
      const user = ctx.session!.user as SessionUser;
      return ctx.prisma.entsorgungAuftrag.create({
        data: {
          bereich:     input.bereich,
          bezeichnung: input.bezeichnung,
          datum:       new Date(input.datum),
          notiz:       input.notiz || null,
          erstelltVon: user.kuerzel,
        },
      });
    }),

  auftragAktualisieren: bearbeiten
    .input(z.object({
      id:          z.number().int().positive(),
      bezeichnung: z.string().trim().min(2).max(191).optional(),
      datum:       z.string().datetime().optional(),
      status:      z.nativeEnum(EntsorgungStatus).optional(),
      notiz:       z.string().trim().max(2000).nullable().optional(),
    }))
    .mutation(({ ctx, input }) => {
      const { id, datum, ...rest } = input;
      return ctx.prisma.entsorgungAuftrag.update({
        where: { id },
        data:  { ...rest, ...(datum ? { datum: new Date(datum) } : {}) },
      });
    }),

  // Löscht den Auftrag samt seiner Zeilen (onDelete: Cascade im Schema).
  auftragLoeschen: bearbeiten
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ ctx, input }) => ctx.prisma.entsorgungAuftrag.delete({ where: { id: input.id } })),

  // ── Positionen ──────────────────────────────────────────────────────────
  positionHinzufuegen: bearbeiten
    .input(z.object({
      auftragId:   z.number().int().positive(),
      nummer:      z.string().trim().min(1).max(32),
      abfalllager: z.string().trim().min(1).max(64),
      abfallartId: z.number().int().positive(),
      bruttoKg:    gewicht,
      nettoKg:     gewicht,
      versandart:  z.string().trim().min(1).max(32),
      unNummer:    z.string().trim().max(8).nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const user = ctx.session!.user as SessionUser;

      const art = await ctx.prisma.entsorgungAbfallart.findUnique({ where: { id: input.abfallartId } });
      if (!art) throw new Error("Abfallart nicht gefunden.");

      const nummer = nummerNormal(input.nummer);
      if (!nummer) throw new Error("Die Nummer enthält keine Ziffern.");

      const letzte = await ctx.prisma.entsorgungPosition.findFirst({
        where:   { auftragId: input.auftragId },
        orderBy: { position: "desc" },
        select:  { position: true },
      });

      return ctx.prisma.entsorgungPosition.create({
        data: {
          auftragId:   input.auftragId,
          nummer,
          abfalllager: input.abfalllager,
          abfallartId: art.id,
          // Schlüssel und Kurzform werden KOPIERT, nicht nachgeschlagen: Eine
          // spätere Stammdatenänderung darf einen verschickten Auftrag nicht
          // rückwirkend verändern.
          schluessel:  art.schluessel,
          kurzform:    art.kurzform,
          bruttoKg:    input.bruttoKg,
          nettoKg:     input.nettoKg,
          versandart:  input.versandart,
          unNummer:    input.unNummer || null,
          position:    (letzte?.position ?? 0) + 1,
          erfasstVon:  user.kuerzel,
        },
      });
    }),

  positionAktualisieren: bearbeiten
    .input(z.object({
      id:          z.number().int().positive(),
      nummer:      z.string().trim().min(1).max(32).optional(),
      abfalllager: z.string().trim().min(1).max(64).optional(),
      abfallartId: z.number().int().positive().optional(),
      bruttoKg:    gewicht.optional(),
      nettoKg:     gewicht.optional(),
      versandart:  z.string().trim().min(1).max(32).optional(),
      unNummer:    z.string().trim().max(8).nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, abfallartId, nummer, ...rest } = input;

      // Wird die Abfallart gewechselt, ziehen Schlüssel und Kurzform mit —
      // sonst stünde in der Zeile eine Art und daneben der alte Schlüssel.
      let ausArt = {};
      if (abfallartId) {
        const art = await ctx.prisma.entsorgungAbfallart.findUnique({ where: { id: abfallartId } });
        if (!art) throw new Error("Abfallart nicht gefunden.");
        ausArt = { abfallartId: art.id, schluessel: art.schluessel, kurzform: art.kurzform };
      }

      return ctx.prisma.entsorgungPosition.update({
        where: { id },
        data:  { ...rest, ...ausArt, ...(nummer ? { nummer: nummerNormal(nummer) } : {}) },
      });
    }),

  positionLoeschen: bearbeiten
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ ctx, input }) => ctx.prisma.entsorgungPosition.delete({ where: { id: input.id } })),
});
