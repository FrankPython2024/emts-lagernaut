import { z } from "zod";
import { BestellanfrageStatus } from "@prisma/client";
import { createTRPCRouter, permissionProcedure } from "@/server/trpc";
import type { SessionUser } from "@/core/types";

// ── Bestellanfragen Eigenbedarf ──────────────────────────────────────────────
// Löst die wöchentliche Excel-Liste ab. Drei getrennte Rechte, damit die
// Bereichs-/Standortleitung mitlesen und Bedarf melden kann, ohne dass sie
// Positionen verschickt oder Zustände ändert:
//   BESTELLANFRAGE_VIEW   — Liste einsehen
//   BESTELLANFRAGE_CREATE — Bedarf erfassen
//   BESTELLANFRAGE_MANAGE — Status ändern, verschicken, löschen
// ⚠️ Braucht einen seed-rbac-Lauf nach dem Deploy.
const lesen     = permissionProcedure("BESTELLANFRAGE_VIEW");
const erfassen  = permissionProcedure("BESTELLANFRAGE_CREATE");
const verwalten = permissionProcedure("BESTELLANFRAGE_MANAGE");

export const bestellanfragenRouter = createTRPCRouter({

  liste: lesen
    .input(z.object({
      status: z.nativeEnum(BestellanfrageStatus).nullable().optional(),
      suche:  z.string().max(100).optional(),
      limit:  z.number().int().min(1).max(500).default(200),
    }).optional())
    .query(({ ctx, input }) => {
      const suche = input?.suche?.trim();
      return ctx.prisma.bestellanfrage.findMany({
        where: {
          ...(input?.status ? { status: input.status } : {}),
          ...(suche ? {
            OR: [
              { beschreibung:   { contains: suche } },
              { hersteller:     { contains: suche } },
              { verwendungsort: { contains: suche } },
            ],
          } : {}),
        },
        orderBy: [{ status: "asc" }, { angefordertAm: "desc" }],
        take:    input?.limit ?? 200,
      });
    }),

  zaehler: lesen.query(async ({ ctx }) => {
    const rows = await ctx.prisma.bestellanfrage.groupBy({
      by: ["status"], _count: { _all: true },
    });
    const m = Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
    // Schlüssel = Enum-Werte, damit die Oberfläche direkt darüber laufen kann.
    return {
      OFFEN:           m.OFFEN           ?? 0,
      BESTELLT:        m.BESTELLT        ?? 0,
      GELIEFERT:       m.GELIEFERT       ?? 0,
      NICHT_GENEHMIGT: m.NICHT_GENEHMIGT ?? 0,
      STORNIERT:       m.STORNIERT       ?? 0,
    };
  }),

  anlegen: erfassen
    .input(z.object({
      anzahl:         z.number().int().min(1).max(10_000),
      hersteller:     z.string().max(191).optional(),
      beschreibung:   z.string().min(2).max(2000).trim(),
      link:           z.string().max(2000).optional(),
      verwendungsort: z.string().max(191).optional(),
      notiz:          z.string().max(500).optional(),
    }))
    .mutation(({ ctx, input }) => {
      const user = ctx.session!.user as SessionUser;
      return ctx.prisma.bestellanfrage.create({
        data: {
          anzahl:         input.anzahl,
          hersteller:     input.hersteller?.trim()     || null,
          beschreibung:   input.beschreibung,
          link:           input.link?.trim()           || null,
          verwendungsort: input.verwendungsort?.trim() || null,
          notiz:          input.notiz?.trim()          || null,
          angefordertVon: user.kuerzel || user.name || "?",
        },
      });
    }),

  aendern: verwalten
    .input(z.object({
      id:             z.number().int().positive(),
      anzahl:         z.number().int().min(1).max(10_000).optional(),
      hersteller:     z.string().max(191).nullish(),
      beschreibung:   z.string().min(2).max(2000).trim().optional(),
      link:           z.string().max(2000).nullish(),
      verwendungsort: z.string().max(191).nullish(),
      notiz:          z.string().max(500).nullish(),
      status:         z.nativeEnum(BestellanfrageStatus).optional(),
    }))
    .mutation(({ ctx, input }) => {
      const { id, status, ...rest } = input;
      return ctx.prisma.bestellanfrage.update({
        where: { id },
        data: {
          ...rest,
          ...(status ? {
            status,
            // Zeitstempel mitführen, damit später nachvollziehbar bleibt, wann
            // was passiert ist — ohne dass jemand ein Datum tippen muss.
            ...(status === "GELIEFERT" ? { geliefertAm: new Date() } : {}),
            ...(status === "OFFEN"     ? { versendetAm: null, geliefertAm: null } : {}),
          } : {}),
        },
      });
    }),

  loeschen: verwalten
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ ctx, input }) =>
      ctx.prisma.bestellanfrage.delete({ where: { id: input.id } }),
    ),

  // ── Wochenversand ──────────────────────────────────────────────────────────
  // Setzt alle offenen Positionen auf BESTELLT und stempelt das Versanddatum.
  // Bewusst ERST aufrufen, wenn die Mail wirklich raus ist: Der Kopiertext wird
  // vorher aus `liste` erzeugt. So verschiebt ein versehentlicher Klick nichts,
  // solange nichts verschickt wurde.
  alsVersendetMarkieren: verwalten
    .input(z.object({ ids: z.array(z.number().int().positive()).min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      const r = await ctx.prisma.bestellanfrage.updateMany({
        where: { id: { in: input.ids }, status: BestellanfrageStatus.OFFEN },
        data:  { status: BestellanfrageStatus.BESTELLT, versendetAm: new Date() },
      });
      return { markiert: r.count };
    }),
});
