import { z } from "zod";
import { createTRPCRouter, permissionProcedure } from "@/server/trpc";
import { prisma } from "@/core/db/prisma";
import { normalizeLogId, logIdClean } from "@/lib/format/logId";

// ── Gleiches Gerät finden ────────────────────────────────────────────────────
//
// Für den Versand: Eine LogID scannen und sehen, ob dasselbe Gerät mit
// demselben Grading noch einmal im Lager liegt — mit Stellplatz und Colli.
//
// ⚠️ Eigener Datenbestand (VersandGeraet), bewusst getrennt vom Lagerfuchs.
// Der Bereich importiert seine CSV selbst; ein Import hier löst die
// Abgangs-Erkennung des Lagerfuchs nicht aus und umgekehrt.
//
// Zwei Rechte, weil es zwei verschiedene Dinge sind: Suchen tut der Versand
// täglich, Importieren ersetzt den kompletten Bestand.
const suchen     = permissionProcedure("GLEICHE_GERAETE_VIEW");
const importieren = permissionProcedure("GLEICHE_GERAETE_IMPORT");

/** Eine CSV-Zeile, wie sie der Browser nach dem Zerlegen schickt. */
const zeileSchema = z.object({
  logId:       z.string().trim().min(1).max(32),
  hersteller:  z.string().trim().max(64).nullish(),
  bezeichnung: z.string().trim().max(255).nullish(),
  geraeteart:  z.string().trim().max(64).nullish(),
  grading:     z.string().trim().max(8).nullish(),
  stellplatz:  z.string().trim().max(64).nullish(),
  colli:       z.string().trim().max(32).nullish(),
  lager:       z.string().trim().max(64).nullish(),
  verbleib:    z.string().trim().max(64).nullish(),
});

const leer = (v: string | null | undefined) => (v && v.length > 0 ? v : null);

/**
 * Nur Stellplätze im Kommissionierlager.
 *
 * ⚠️ Ein Gerät, das woanders steht, nützt dem Versand nichts — es ist nicht
 * greifbar. Ohne diesen Filter stünden Geräte in der Liste, zu denen niemand
 * hinlaufen kann, und die Trefferzahl wäre größer als das, was tatsächlich
 * verfügbar ist. Die Suche selbst ist davon nicht betroffen: Gescannt werden
 * darf jedes Gerät, egal wo es liegt.
 */
const NUR_KOMMISSIONIERUNG = { stellplatz: { contains: "KOM" } };

export const gleicheGeraeteRouter = createTRPCRouter({
  /** Wie alt ist der Bestand, und wie viel steht drin? */
  status: suchen.query(async () => {
    const [anzahl, neuestes] = await Promise.all([
      prisma.versandGeraet.count(),
      prisma.versandGeraet.findFirst({
        orderBy: { importiertAm: "desc" },
        select:  { importiertAm: true },
      }),
    ]);
    return { anzahl, importiertAm: neuestes?.importiertAm ?? null };
  }),

  /**
   * Suche zu einer LogID.
   *
   * ⚠️ Die Eingabe wird IMMER normalisiert. Der Handscanner liefert
   * „212965142" ohne Punkte, gespeichert ist „212.965.142" — ohne diese
   * Umwandlung findet ein Scan grundsätzlich nichts. `normalizeLogId` ist
   * dafür die einzige Quelle im Projekt.
   */
  suche: suchen
    .input(z.object({ logId: z.string().trim().min(1).max(60) }))
    .query(async ({ input }) => {
      const norm  = normalizeLogId(input.logId);
      const clean = logIdClean(input.logId);

      const stand = await prisma.versandGeraet.findFirst({
        where: { OR: [{ logId: norm }, { logIdClean: clean }, { logId: input.logId }] },
      });
      if (!stand) return { kind: "none" as const, gesucht: norm };

      if (!stand.bezeichnung || !stand.grading) {
        return { kind: "unvollstaendig" as const, stand };
      }

      const gemeinsam = {
        bezeichnung: stand.bezeichnung,
        grading:     stand.grading,
        logId:       { not: stand.logId },
        ...NUR_KOMMISSIONIERUNG,
      };

      // ⚠️ Obergrenze mit Ansage. Die größte Gruppe im Export vom 01.09.2026
      // hatte 724 Geräte auf 454 Stellplätzen — ungebremst wäre das keine
      // Liste mehr, mit der jemand ins Lager geht.
      const GRENZE = 500;
      const ANDERE_GRENZE = 200;
      const [gesamt, treffer, andereZaehler, andereZeilen] = await Promise.all([
        prisma.versandGeraet.count({ where: gemeinsam }),
        prisma.versandGeraet.findMany({
          where:   gemeinsam,
          select:  { logId: true, stellplatz: true, colli: true, lager: true, verbleib: true },
          orderBy: [{ stellplatz: "asc" }, { logId: "asc" }],
          take:    GRENZE,
        }),
        // ⚠️ Andere Gradings kommen NICHT in die Hauptliste. Ein Gerät mit
        // Grading C ist kein Ersatz für eines mit B — wer es trotzdem nimmt,
        // trifft eine bewusste Entscheidung. Deshalb eigener Block mit
        // eigener Liste, statt sie unter die Treffer zu mischen.
        prisma.versandGeraet.groupBy({
          by:     ["grading"],
          where:  { bezeichnung: stand.bezeichnung, logId: { not: stand.logId }, ...NUR_KOMMISSIONIERUNG },
          _count: { _all: true },
        }),
        prisma.versandGeraet.findMany({
          where: {
            bezeichnung: stand.bezeichnung,
            grading:     { not: stand.grading },
            logId:       { not: stand.logId },
            ...NUR_KOMMISSIONIERUNG,
          },
          select:  { logId: true, grading: true, stellplatz: true, colli: true, lager: true, verbleib: true },
          orderBy: [{ grading: "asc" }, { stellplatz: "asc" }],
          take:    ANDERE_GRENZE,
        }),
      ]);

      return {
        kind:     "found" as const,
        stand,
        gesamt,
        treffer,
        gekuerzt: gesamt > treffer.length,
        // Je anderem Grading: die echte Gesamtzahl plus die geladenen Zeilen.
        andereGradings: andereZaehler
          .filter((g) => g.grading && g.grading !== stand.grading)
          .map((g) => ({
            grading: g.grading as string,
            anzahl:  g._count._all,
            treffer: andereZeilen.filter((z) => z.grading === g.grading),
          }))
          .sort((a, b) => b.anzahl - a.anzahl),
      };
    }),

  /**
   * Ein Stück der hochgeladenen CSV entgegennehmen.
   *
   * Der Browser zerlegt die Datei und schickt sie in Paketen — 28.000 Zeilen
   * in einem Rutsch wären ein sehr langer Aufruf ohne jede Rückmeldung.
   *
   * ⚠️ `ersteLieferung` leert die Tabelle. Ein Import ersetzt den Bestand
   * vollständig; die Datei IST der Stand. Wird der Vorgang mittendrin
   * abgebrochen, steht entsprechend nur ein Teil da — deshalb meldet die
   * Oberfläche den Fortschritt und die Zeilenzahl am Ende.
   */
  importStueck: importieren
    .input(z.object({
      zeilen:         z.array(zeileSchema).max(2000),
      ersteLieferung: z.boolean(),
      importiertAm:   z.string().datetime(),
    }))
    .mutation(async ({ input }) => {
      if (input.ersteLieferung) await prisma.versandGeraet.deleteMany({});

      const stand = new Date(input.importiertAm);
      const daten = input.zeilen.map((z) => ({
        logId:        normalizeLogId(z.logId),
        logIdClean:   logIdClean(z.logId),
        hersteller:   leer(z.hersteller),
        bezeichnung:  leer(z.bezeichnung),
        geraeteart:   leer(z.geraeteart),
        grading:      leer(z.grading),
        stellplatz:   leer(z.stellplatz),
        colli:        leer(z.colli),
        lager:        leer(z.lager),
        verbleib:     leer(z.verbleib),
        importiertAm: stand,
      })).filter((z) => z.logId.length > 0);

      // skipDuplicates: Eine LogID doppelt in der Datei ist kein Grund, den
      // ganzen Import abzubrechen.
      const r = await prisma.versandGeraet.createMany({ data: daten, skipDuplicates: true });
      return { geschrieben: r.count, uebersprungen: daten.length - r.count };
    }),
});
