import { z } from "zod";
import { createTRPCRouter, permissionProcedure } from "@/server/trpc";

// ── Kategorie-Preise (Laptop-Ersatzteile) ───────────────────────────────────
// Laptop-Artikel haben keinen eigenen Preis. Hier wird ein Stückpreis je
// Artikel-Kategorie gepflegt (Tabelle KategoriePreis). Die Kategorie-Liste
// kommt LIVE aus der Artikel-Tabelle, damit sie immer der echten DB entspricht.
//
// Lesen:  ARTIKEL_VIEW   ·  Schreiben: ARTIKEL_EDIT
// (bewusst keine neuen Permissions → kein seed-rbac-Lauf nötig)

// Prisma.Decimal → plain number (superjson serialisiert Decimal nicht sinnvoll).
function num(v: unknown): number {
  return typeof v === "number" ? v : Number(v);
}

export const preiseRouter = createTRPCRouter({

  // Alle Artikel-Kategorien (live) mit Artikel-Anzahl + ggf. hinterlegtem Preis.
  // Sortiert nach Anzahl absteigend (die großen Kategorien zuerst).
  kategorienMitPreis: permissionProcedure("ARTIKEL_VIEW").query(async ({ ctx }) => {
    const [gruppen, preise] = await Promise.all([
      ctx.prisma.artikel.groupBy({
        by:      ["kategorie"],
        _count:  { _all: true },
      }),
      ctx.prisma.kategoriePreis.findMany(),
    ]);

    const preisMap = new Map(preise.map((p) => [p.kategorie, num(p.preis)]));

    return gruppen
      .filter((g) => g.kategorie != null && g.kategorie.trim() !== "")
      .map((g) => ({
        kategorie: g.kategorie,
        anzahl:    g._count._all,
        preis:     preisMap.get(g.kategorie) ?? null,
      }))
      .sort((a, b) => b.anzahl - a.anzahl || a.kategorie.localeCompare(b.kategorie, "de"));
  }),

  // Preise setzen/ändern/entfernen. preis = null → Eintrag löschen (kein Preis).
  // Idempotenter Upsert je Kategorie in einer Transaktion.
  setzePreise: permissionProcedure("ARTIKEL_EDIT")
    .input(z.object({
      eintraege: z.array(z.object({
        kategorie: z.string().min(1).max(191),
        preis:     z.number().min(0).max(1_000_000).nullable(),
      })).max(500),
    }))
    .mutation(async ({ ctx, input }) => {
      let gespeichert = 0;
      let geloescht   = 0;

      await ctx.prisma.$transaction(async (tx) => {
        for (const e of input.eintraege) {
          const kategorie = e.kategorie.trim();
          if (!kategorie) continue;

          if (e.preis == null) {
            const res = await tx.kategoriePreis.deleteMany({ where: { kategorie } });
            geloescht += res.count;
          } else {
            await tx.kategoriePreis.upsert({
              where:  { kategorie },
              update: { preis: e.preis },
              create: { kategorie, preis: e.preis },
            });
            gespeichert++;
          }
        }
      });

      return { gespeichert, geloescht };
    }),
});
