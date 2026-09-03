import { z } from "zod";
import { SchrottStatus } from "@prisma/client";
import { createTRPCRouter, permissionProcedure } from "@/server/trpc";
import type { SessionUser } from "@/core/types";

// ── Schrottabholung ──────────────────────────────────────────────────────────
//
// Ein Auftrag ist eine Tabelle, jede Zeile ein Colli. Am Ende geht die Tabelle
// als E-Mail an den Entsorger.
//
// Zwei Rechte: Ansehen tut jeder im Betrieb, Erfassen und Stammdatenpflege
// gehört in weniger Hände — ein Auftrag ist ein Abfallnachweis.
const sehen    = permissionProcedure("SCHROTT_VIEW");
const bearbeiten = permissionProcedure("SCHROTT_MANAGE");

/**
 * Ein Colli belegt einen LKW-Stellplatz, mehr als 33 passen nicht drauf.
 *
 * ⚠️ Bewusst nur eine WARNUNG, keine Sperre. Wer weiß, dass im Einzelfall
 * anders verladen wird, soll nicht ausgebremst werden — die Zahl steht in der
 * Oberfläche, die Entscheidung trifft der Mensch.
 */
export const MAX_STELLPLAETZE = 33;

/**
 * Colli-Nummer vereinheitlichen: nur Ziffern.
 *
 * Der Handscanner und die Tastatur liefern dieselbe Nummer unterschiedlich
 * („3.202.971" und „3202971"). In der Auftragstabelle muss sie einheitlich
 * stehen, sonst sieht der Entsorger zwei Schreibweisen in einer Spalte.
 */
export function colliNummerNormal(roh: string): string {
  return roh.replace(/\D/g, "");
}

const gewicht = z.number().int().min(0).max(100_000);

export const schrottRouter = createTRPCRouter({
  // ── Stammdaten: Abfallarten ─────────────────────────────────────────────
  abfallarten: sehen
    .input(z.object({ auchInaktive: z.boolean().default(false) }).optional())
    .query(({ ctx, input }) =>
      ctx.prisma.schrottAbfallart.findMany({
        where:   input?.auchInaktive ? undefined : { aktiv: true },
        orderBy: [{ sortierung: "asc" }, { bezeichnung: "asc" }],
      })),

  abfallartAnlegen: bearbeiten
    .input(z.object({
      bezeichnung: z.string().trim().min(2).max(191),
      kurzform:    z.string().trim().min(1).max(40),
      schluessel:  z.string().trim().min(4).max(16),
      taraKg:      z.number().int().min(0).max(5000).nullable(),
      sortierung:  z.number().int().min(0).max(9999).default(500),
    }))
    .mutation(({ ctx, input }) =>
      ctx.prisma.schrottAbfallart.create({
        data: {
          ...input,
          // Schlüssel immer ohne Leerzeichen speichern: „16 02 16" und
          // „160216" sind dieselbe Nummer und dürfen nicht zweimal entstehen.
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
      return ctx.prisma.schrottAbfallart.update({
        where: { id },
        data:  { ...rest, ...(schluessel ? { schluessel: schluessel.replace(/\s+/g, "") } : {}) },
      });
    }),

  // ── Aufträge ────────────────────────────────────────────────────────────
  auftraege: sehen
    .input(z.object({ status: z.nativeEnum(SchrottStatus).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const liste = await ctx.prisma.schrottAuftrag.findMany({
        where:   input?.status ? { status: input.status } : undefined,
        orderBy: [{ datum: "desc" }, { id: "desc" }],
        take:    100,
        include: { _count: { select: { collis: true } } },
      });

      // Gewichte je Auftrag in EINER Abfrage, nicht je Zeile.
      const summen = await ctx.prisma.schrottColli.groupBy({
        by:     ["auftragId"],
        where:  { auftragId: { in: liste.map((a) => a.id) } },
        _sum:   { bruttoKg: true, nettoKg: true },
      });
      const proAuftrag = new Map(summen.map((s) => [s.auftragId, s._sum]));

      return liste.map((a) => ({
        ...a,
        collis:  a._count.collis,
        brutto:  proAuftrag.get(a.id)?.bruttoKg ?? 0,
        netto:   proAuftrag.get(a.id)?.nettoKg  ?? 0,
      }));
    }),

  auftrag: sehen
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const auftrag = await ctx.prisma.schrottAuftrag.findUnique({
        where:   { id: input.id },
        include: { collis: { orderBy: [{ position: "asc" }, { id: "asc" }] } },
      });
      if (!auftrag) return null;

      const brutto = auftrag.collis.reduce((s, c) => s + c.bruttoKg, 0);
      const netto  = auftrag.collis.reduce((s, c) => s + c.nettoKg, 0);
      return { ...auftrag, brutto, netto, stellplaetze: auftrag.collis.length };
    }),

  auftragAnlegen: bearbeiten
    .input(z.object({
      bezeichnung: z.string().trim().min(2).max(191),
      datum:       z.string().datetime(),
      notiz:       z.string().trim().max(2000).optional(),
    }))
    .mutation(({ ctx, input }) => {
      const user = ctx.session!.user as SessionUser;
      return ctx.prisma.schrottAuftrag.create({
        data: {
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
      status:      z.nativeEnum(SchrottStatus).optional(),
      notiz:       z.string().trim().max(2000).nullable().optional(),
    }))
    .mutation(({ ctx, input }) => {
      const { id, datum, ...rest } = input;
      return ctx.prisma.schrottAuftrag.update({
        where: { id },
        data:  { ...rest, ...(datum ? { datum: new Date(datum) } : {}) },
      });
    }),

  // Löscht den Auftrag samt seiner Zeilen (onDelete: Cascade im Schema).
  auftragLoeschen: bearbeiten
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ ctx, input }) => ctx.prisma.schrottAuftrag.delete({ where: { id: input.id } })),

  // ── Collis ──────────────────────────────────────────────────────────────
  colliHinzufuegen: bearbeiten
    .input(z.object({
      auftragId:   z.number().int().positive(),
      colliNummer: z.string().trim().min(1).max(32),
      abfalllager: z.string().trim().min(1).max(64),
      abfallartId: z.number().int().positive(),
      bruttoKg:    gewicht,
      nettoKg:     gewicht,
      versandart:  z.string().trim().min(1).max(32),
    }))
    .mutation(async ({ ctx, input }) => {
      const user = ctx.session!.user as SessionUser;

      const art = await ctx.prisma.schrottAbfallart.findUnique({ where: { id: input.abfallartId } });
      if (!art) throw new Error("Abfallart nicht gefunden.");

      const nummer = colliNummerNormal(input.colliNummer);
      if (!nummer) throw new Error("Colli-Nummer enthält keine Ziffern.");

      const letzte = await ctx.prisma.schrottColli.findFirst({
        where:   { auftragId: input.auftragId },
        orderBy: { position: "desc" },
        select:  { position: true },
      });

      return ctx.prisma.schrottColli.create({
        data: {
          auftragId:   input.auftragId,
          colliNummer: nummer,
          abfalllager: input.abfalllager,
          abfallartId: art.id,
          // Schlüssel und Kurzform werden KOPIERT, nicht nachgeschlagen:
          // Eine spätere Stammdatenänderung darf einen verschickten Auftrag
          // nicht rückwirkend verändern.
          schluessel:  art.schluessel,
          kurzform:    art.kurzform,
          bruttoKg:    input.bruttoKg,
          nettoKg:     input.nettoKg,
          versandart:  input.versandart,
          position:    (letzte?.position ?? 0) + 1,
          erfasstVon:  user.kuerzel,
        },
      });
    }),

  colliAktualisieren: bearbeiten
    .input(z.object({
      id:          z.number().int().positive(),
      colliNummer: z.string().trim().min(1).max(32).optional(),
      abfalllager: z.string().trim().min(1).max(64).optional(),
      abfallartId: z.number().int().positive().optional(),
      bruttoKg:    gewicht.optional(),
      nettoKg:     gewicht.optional(),
      versandart:  z.string().trim().min(1).max(32).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, abfallartId, colliNummer, ...rest } = input;

      // Wird die Abfallart gewechselt, ziehen Schlüssel und Kurzform mit —
      // sonst stünde in der Zeile eine Art und daneben der alte Schlüssel.
      let ausArt = {};
      if (abfallartId) {
        const art = await ctx.prisma.schrottAbfallart.findUnique({ where: { id: abfallartId } });
        if (!art) throw new Error("Abfallart nicht gefunden.");
        ausArt = { abfallartId: art.id, schluessel: art.schluessel, kurzform: art.kurzform };
      }

      return ctx.prisma.schrottColli.update({
        where: { id },
        data:  {
          ...rest,
          ...ausArt,
          ...(colliNummer ? { colliNummer: colliNummerNormal(colliNummer) } : {}),
        },
      });
    }),

  colliLoeschen: bearbeiten
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ ctx, input }) => ctx.prisma.schrottColli.delete({ where: { id: input.id } })),
});
