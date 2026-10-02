// Platz-Schilder für ORGATEX ET300 — Pflege unter /admin/platz-schilder.
// Regeln (Liste lesen, Bereiche, Bogen-Raster): src/lib/lager/platzSchilder.ts.
//
// Eigene Liste, frei eingegeben (Frank, 02.10.2026): kein Bezug zu den ETL-Fächern
// oder LagerplatzConfig. Der QR-Code enthält genau `code`.
// Ansehen/Drucken LAGERPLATZ_VIEW, ändern LAGERPLATZ_EDIT (vorhanden, kein seed).

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, permissionProcedure } from "@/server/trpc";
import { prisma } from "@/core/db/prisma";
import type { SessionUser } from "@/core/types";
import { MAX_BESCHREIBUNG, MAX_CODE } from "@/lib/lager/platzSchilder";

const ansehen = permissionProcedure("LAGERPLATZ_VIEW");
const pflegen = permissionProcedure("LAGERPLATZ_EDIT");

const code = z.string().trim().min(1, "Platz fehlt").max(MAX_CODE);
const beschreibung = z.string().trim().max(MAX_BESCHREIBUNG).nullable();
const ids = z.array(z.number().int().positive()).min(1).max(2000);

export const platzSchilderRouter = createTRPCRouter({
  liste: ansehen.query(async () => {
    const liste = await prisma.platzSchild.findMany({
      select: { id: true, code: true, beschreibung: true, gedrucktAm: true, erstelltVon: true, createdAt: true },
    });
    return liste.sort((a, b) => a.code.localeCompare(b.code, "de", { numeric: true }));
  }),

  /**
   * Liste übernehmen. Schon vorhandene Plätze bleiben, wie sie sind — nur eine neu
   * mitgegebene Beschreibung wird übernommen. Liefert die Ids ALLER eingegebenen,
   * damit die Seite sie gleich zum Drucken auswählen kann.
   */
  anlegen: pflegen
    .input(z.object({ plaetze: z.array(z.object({ code, beschreibung })).min(1).max(2000) }))
    .mutation(async ({ input, ctx }) => {
      const user = ctx.session.user as SessionUser;
      const von = user.kuerzel || user.name;
      // MySQL vergleicht ohne Groß/Klein — „hl-07-01" und „HL-07-01" sind derselbe Platz.
      const vorhanden = await prisma.platzSchild.findMany({
        where: { code: { in: input.plaetze.map((p) => p.code) } },
        select: { id: true, code: true, beschreibung: true },
      });
      const nachCode = new Map(vorhanden.map((v) => [v.code.toUpperCase(), v]));
      const alleIds: number[] = [];
      let neu = 0, geaendert = 0;
      await prisma.$transaction(async (tx) => {
        for (const p of input.plaetze) {
          const alt = nachCode.get(p.code.toUpperCase());
          if (alt) {
            if (p.beschreibung && p.beschreibung !== alt.beschreibung) {
              await tx.platzSchild.update({ where: { id: alt.id }, data: { beschreibung: p.beschreibung } });
              geaendert++;
            }
            alleIds.push(alt.id);
            continue;
          }
          const n = await tx.platzSchild.create({ data: { code: p.code, beschreibung: p.beschreibung, erstelltVon: von }, select: { id: true } });
          nachCode.set(p.code.toUpperCase(), { id: n.id, code: p.code, beschreibung: p.beschreibung });
          alleIds.push(n.id);
          neu++;
        }
      }, { timeout: 30_000 });
      return { ids: alleIds, neu, geaendert, schonDa: input.plaetze.length - neu };
    }),

  aendern: pflegen
    .input(z.object({ id: z.number().int().positive(), code, beschreibung }))
    .mutation(async ({ input }) => {
      const doppelt = await prisma.platzSchild.findFirst({ where: { code: input.code, NOT: { id: input.id } }, select: { id: true } });
      if (doppelt) throw new TRPCError({ code: "CONFLICT", message: `„${input.code}" gibt es schon.` });
      const r = await prisma.platzSchild.updateMany({
        where: { id: input.id },
        data: { code: input.code, beschreibung: input.beschreibung || null },
      });
      if (r.count === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Eintrag gibt es nicht mehr." });
      return { ok: true };
    }),

  loeschen: pflegen.input(z.object({ ids })).mutation(async ({ input }) => {
    const r = await prisma.platzSchild.deleteMany({ where: { id: { in: input.ids } } });
    return { anzahl: r.count };
  }),

  /** Nach dem Druck — nur zur Übersicht „schon gedruckt", ändert sonst nichts. */
  gedrucktMarkieren: ansehen.input(z.object({ ids })).mutation(async ({ input }) => {
    await prisma.platzSchild.updateMany({ where: { id: { in: input.ids } }, data: { gedrucktAm: new Date() } });
    return { ok: true };
  }),
});
