// Besondere Stellplätze mit Bedeutung — Pflege unter /admin/stellplaetze.
// Regeln: src/lib/lager/stellplaetze.ts.
//
// Lesen der Liste (für die Schilder) darf jeder Angemeldete — auch der Picker am
// Zebra braucht „ETL-0-4-0 = Abholwagen / QS". Die Übersicht mit Gerätezahlen
// braucht LAGERPLATZ_VIEW, Ändern LAGERPLATZ_EDIT (beides vorhanden, kein seed).

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure, permissionProcedure } from "@/server/trpc";
import { prisma } from "@/core/db/prisma";
import type { SessionUser } from "@/core/types";
import { STANDARD_STELLPLAETZE, normStellplatz } from "@/lib/lager/stellplaetze";

const ansehen = permissionProcedure("LAGERPLATZ_VIEW");
const pflegen = permissionProcedure("LAGERPLATZ_EDIT");

const AUSWAHL = { id: true, code: true, kurz: true, text: true, ausserhalb: true, geaendertVon: true, updatedAt: true } as const;

/** Liste lesen; leere Tabelle einmalig mit dem Aushang befüllen. */
async function ladeListe() {
  if ((await prisma.stellplatzBedeutung.count()) === 0) {
    await prisma.stellplatzBedeutung.createMany({
      data: STANDARD_STELLPLAETZE.map((b) => ({ ...b, geaendertVon: "Aushang 30.09.2026" })),
      skipDuplicates: true,
    });
  }
  const liste = await prisma.stellplatzBedeutung.findMany({ select: AUSWAHL });
  return liste.sort((a, b) => a.code.localeCompare(b.code, "de", { numeric: true }));
}

const eingabe = z.object({
  id:         z.number().int().positive().optional(),
  code:       z.string().trim().min(1).max(80),
  kurz:       z.string().trim().min(1, "Kurzform fehlt").max(40),
  text:       z.string().trim().min(1, "Beschreibung fehlt").max(300),
  ausserhalb: z.boolean(),
});

export const stellplatzInfoRouter = createTRPCRouter({
  /** Für die Schilder überall — kurz und ohne Zahlen. */
  liste: protectedProcedure.query(async () =>
    (await ladeListe()).map(({ code, kurz, text, ausserhalb }) => ({ code, kurz, text, ausserhalb })),
  ),

  /**
   * Für die Pflegeseite: Einträge mit Gerätezahl laut Lagerfuchs, dazu
   * Vorschläge — ETL-0-…-Plätze mit Geräten, aber ohne Eintrag (z. B. ETL-0-0-0).
   */
  uebersicht: ansehen.query(async () => {
    const [liste, plaetze] = await Promise.all([
      ladeListe(),
      prisma.logIdStand.groupBy({ by: ["stellplatz"], where: { ausgeschieden: false, stellplatz: { not: null } }, _count: true }),
    ]);
    const anzahl = new Map<string, number>();
    for (const p of plaetze) {
      const code = normStellplatz(p.stellplatz);
      if (code) anzahl.set(code, (anzahl.get(code) ?? 0) + p._count);
    }
    const bekannt = new Set(liste.map((b) => b.code));
    const vorschlaege = [...anzahl.entries()]
      .filter(([code]) => !bekannt.has(code) && /^ETL-0-\d+-\d+$/.test(code))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([code, geraete]) => ({ code, geraete }));
    return {
      eintraege: liste.map((b) => ({ ...b, geraete: anzahl.get(b.code) ?? 0 })),
      vorschlaege,
    };
  }),

  speichern: pflegen.input(eingabe).mutation(async ({ input, ctx }) => {
    const user = ctx.session.user as SessionUser;
    const code = normStellplatz(input.code);
    if (!code) throw new TRPCError({ code: "BAD_REQUEST", message: "Stellplatz fehlt." });
    const doppelt = await prisma.stellplatzBedeutung.findUnique({ where: { code }, select: { id: true } });
    if (doppelt && doppelt.id !== input.id) {
      throw new TRPCError({ code: "CONFLICT", message: `Für ${code} gibt es schon einen Eintrag.` });
    }
    const daten = { code, kurz: input.kurz, text: input.text, ausserhalb: input.ausserhalb, geaendertVon: user.kuerzel || user.name };
    if (input.id) {
      const r = await prisma.stellplatzBedeutung.updateMany({ where: { id: input.id }, data: daten });
      if (r.count === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Eintrag gibt es nicht mehr." });
      return { id: input.id, code };
    }
    const neu = await prisma.stellplatzBedeutung.create({ data: daten, select: { id: true } });
    return { id: neu.id, code };
  }),

  loeschen: pflegen.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input }) => {
    await prisma.stellplatzBedeutung.deleteMany({ where: { id: input.id } });
    return { ok: true };
  }),
});
