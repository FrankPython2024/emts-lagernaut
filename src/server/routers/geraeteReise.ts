import { z } from "zod";
import { createTRPCRouter, permissionProcedure } from "@/server/trpc";
import { prisma } from "@/core/db/prisma";

// Geräte-Reise (LogID-Tracking).
// Gating über das Recht GERAETE_REISE_VIEW (Admin via SYSTEM_ADMIN-Wildcard).
// Reine Auswertung, kein Bestandseffekt.

export const geraeteReiseRouter = createTRPCRouter({
  // Letzte Importe inkl. Status/Zähler/Fortschritt. Wird im Admin-UI gepollt,
  // solange ein Import „läuft".
  listImports: permissionProcedure("GERAETE_REISE_VIEW").query(() =>
    prisma.logIdImport.findMany({
      orderBy: { importiertAm: "desc" },
      take:    50,
    }),
  ),

  // Ein Gerät verfolgen: exakter LogID-Treffer (PK) zuerst, sonst Treffer auf
  // Seriennummer. Bei genau einem Treffer → Stand + Bewegungs-Timeline; bei
  // mehreren Seriennummer-Treffern → kurze Auswahlliste; bei 0 → „nicht gefunden".
  geraet: permissionProcedure("GERAETE_REISE_VIEW")
    .input(z.object({ query: z.string().trim().min(1).max(200) }))
    .query(async ({ input }) => {
      const q = input.query;

      // 1) Exakter LogID-Treffer (Primary Key)
      let stand = await prisma.logIdStand.findUnique({ where: { logId: q } });

      // 2) sonst Seriennummer (kein Index — gelegentliche Suche über 132k Zeilen ok)
      if (!stand) {
        const treffer = await prisma.logIdStand.findMany({
          where:  { seriennummer: q },
          select: { logId: true, bezeichnung: true },
          take:   25,
        });
        if (treffer.length === 0) return { kind: "none" as const };
        if (treffer.length > 1)   return { kind: "treffer" as const, treffer };
        stand = await prisma.logIdStand.findUnique({ where: { logId: treffer[0]!.logId } });
        if (!stand) return { kind: "none" as const };
      }

      const bewegungen = await prisma.logIdBewegung.findMany({
        where:   { logId: stand.logId },
        orderBy: [{ zeitpunkt: "asc" }, { id: "asc" }],
      });

      return { kind: "found" as const, stand, bewegungen };
    }),

  // Aggregat-Blick über alle Geräte (= aktueller Snapshot, da LogIdStand je LogID
  // den Stand des letzten Imports hält). Alle Aggregationen laufen in der DB —
  // es werden KEINE 132k Zeilen in den Client geladen.
  dashboard: permissionProcedure("GERAETE_REISE_VIEW").query(async () => {
    const LADENHUETER_TAGE = 365;

    const [
      gesamt,
      ohneVerbleib,
      blockiert,
      ladenhueter,
      avgAgg,
      verbleibRaw,
      geraeteartRaw,
      lagerRaw,
      agingRaw,
      topLadenhueter,
      letzterImport,
    ] = await Promise.all([
      prisma.logIdStand.count(),
      prisma.logIdStand.count({ where: { OR: [{ verbleib: null }, { verbleib: "" }] } }),
      prisma.logIdStand.count({ where: { blockiert: true } }),
      prisma.logIdStand.count({ where: { verweildauerTage: { gt: LADENHUETER_TAGE } } }),
      prisma.logIdStand.aggregate({ _avg: { verweildauerTage: true } }),
      prisma.logIdStand.groupBy({ by: ["verbleib"],    _count: { _all: true } }),
      prisma.logIdStand.groupBy({ by: ["geraeteart"],  _count: { _all: true } }),
      prisma.logIdStand.groupBy({ by: ["lager"],       _count: { _all: true } }),
      prisma.$queryRaw<Array<{ bucket: string; anzahl: bigint }>>`
        SELECT bucket, COUNT(*) AS anzahl FROM (
          SELECT CASE
            WHEN verweildauerTage <= 30  THEN '0–30'
            WHEN verweildauerTage <= 90  THEN '31–90'
            WHEN verweildauerTage <= 180 THEN '91–180'
            WHEN verweildauerTage <= 365 THEN '181–365'
            ELSE '>365'
          END AS bucket
          FROM \`LogIdStand\`
          WHERE verweildauerTage IS NOT NULL
        ) t GROUP BY bucket`,
      prisma.logIdStand.findMany({
        where:   { verweildauerTage: { not: null } },
        orderBy: { verweildauerTage: "desc" },
        take:    20,
        select:  {
          logId: true, hersteller: true, bezeichnung: true,
          verweildauerTage: true, verbleib: true, stellplatz: true,
        },
      }),
      prisma.logIdImport.findFirst({
        where:   { status: "fertig" },
        orderBy: { importiertAm: "desc" },
        select:  { importiertAm: true },
      }),
    ]);

    // Verteilung verdichten: null/leer zusammenfassen, absteigend sortieren.
    function verdichte(
      rows: { _count: { _all: number } }[],
      keyOf: (r: never) => string | null,
      leerLabel: string,
      limit?: number,
    ) {
      const map = new Map<string, number>();
      for (const r of rows) {
        const roh = keyOf(r as never);
        const label = roh && roh.trim() !== "" ? roh : leerLabel;
        map.set(label, (map.get(label) ?? 0) + r._count._all);
      }
      const arr = [...map.entries()]
        .map(([label, anzahl]) => ({ label, anzahl }))
        .sort((a, b) => b.anzahl - a.anzahl);
      return limit ? arr.slice(0, limit) : arr;
    }

    const verbleibVerteilung = verdichte(
      verbleibRaw, (r: { verbleib: string | null }) => r.verbleib, "ohne Verbleib",
    ).map(({ label, anzahl }) => ({ verbleib: label, anzahl }));

    const geraeteartVerteilung = verdichte(
      geraeteartRaw, (r: { geraeteart: string | null }) => r.geraeteart, "ohne Angabe", 12,
    ).map(({ label, anzahl }) => ({ geraeteart: label, anzahl }));

    const lagerVerteilung = verdichte(
      lagerRaw, (r: { lager: string | null }) => r.lager, "ohne Angabe", 12,
    ).map(({ label, anzahl }) => ({ lager: label, anzahl }));

    // Aging-Buckets in fester Reihenfolge (DB-Reihenfolge ist nicht garantiert).
    const BUCKET_ORDER = ["0–30", "31–90", "91–180", "181–365", ">365"];
    const agingMap = new Map(agingRaw.map((r) => [r.bucket, Number(r.anzahl)]));
    const agingBuckets = BUCKET_ORDER.map((bucket) => ({ bucket, anzahl: agingMap.get(bucket) ?? 0 }));

    return {
      kennzahlen: {
        gesamt,
        ohneVerbleib,
        blockiert,
        ladenhueter,
        avgVerweildauer: Math.round(avgAgg._avg.verweildauerTage ?? 0),
      },
      verbleibVerteilung,
      geraeteartVerteilung,
      lagerVerteilung,
      agingBuckets,
      topLadenhueter,
      letzterImport: letzterImport?.importiertAm ?? null,
    };
  }),

  // Tiefere Auswertungen: Alter, Stillstand (ohne Bewegung), Stau je Verbleib-
  // Stufe, vollste Stellplätze. Alles DB-seitig (Promise.all), keine 132k Zeilen
  // im Client. Reine Auswertung, kein Bestandseffekt.
  auswertungen: permissionProcedure("GERAETE_REISE_VIEW").query(async () => {
    // Schwelle „hängt zu lange in einer Stufe" — bewusst als Konstante.
    const STAU_SCHWELLE_TAGE = 90;
    const stauCutoff = new Date(Date.now() - STAU_SCHWELLE_TAGE * 86_400_000);

    // Auswahl-Felder für die Geräte-Listen (für $queryRaw + Prisma identisch).
    const listSelect = {
      logId: true, hersteller: true, bezeichnung: true,
      verweildauerTage: true, verbleib: true, stellplatz: true,
    } as const;

    type GeraetZeile = {
      logId:            string;
      hersteller:       string | null;
      bezeichnung:      string | null;
      verweildauerTage: number | null;
      verbleib:         string | null;
      stellplatz:       string | null;
    };

    const [
      aeltesteGeraete,
      ohneBewegungCountRaw,
      ohneBewegungListe,
      stauRaw,
      stellplatzRaw,
    ] = await Promise.all([
      // Älteste Geräte (höchste Verweildauer)
      prisma.logIdStand.findMany({
        where:   { verweildauerTage: { not: null } },
        orderBy: { verweildauerTage: "desc" },
        take:    20,
        select:  listSelect,
      }),

      // Anzahl LogIDs ganz ohne Bewegung (NOT EXISTS — keine Prisma-Relation vorhanden)
      prisma.$queryRaw<Array<{ anzahl: bigint }>>`
        SELECT COUNT(*) AS anzahl
        FROM \`LogIdStand\` s
        WHERE NOT EXISTS (
          SELECT 1 FROM \`LogIdBewegung\` b WHERE b.logId = s.logId
        )`,

      // Die 20 ältesten ohne jede Bewegung (die aussagekräftige Liste)
      prisma.$queryRaw<GeraetZeile[]>`
        SELECT s.logId, s.hersteller, s.bezeichnung, s.verweildauerTage, s.verbleib, s.stellplatz
        FROM \`LogIdStand\` s
        WHERE NOT EXISTS (
          SELECT 1 FROM \`LogIdBewegung\` b WHERE b.logId = s.logId
        )
        AND s.verweildauerTage IS NOT NULL
        ORDER BY s.verweildauerTage DESC
        LIMIT 20`,

      // Stau je Verbleib-Stufe: gesamt, „hängt > Schwelle", Ø Tage in der Stufe.
      // null/leer wird in der DB zu '' verdichtet (→ „ohne Verbleib" im Client).
      prisma.$queryRaw<Array<{ verbleib: string; anzahl: bigint; anzahlLange: bigint; avgTage: number | string | null }>>`
        SELECT
          COALESCE(NULLIF(verbleib, ''), '') AS verbleib,
          COUNT(*) AS anzahl,
          SUM(CASE WHEN inVerbleibSeit IS NOT NULL AND inVerbleibSeit < ${stauCutoff} THEN 1 ELSE 0 END) AS anzahlLange,
          ROUND(AVG(CASE WHEN inVerbleibSeit IS NOT NULL THEN DATEDIFF(NOW(), inVerbleibSeit) END)) AS avgTage
        FROM \`LogIdStand\`
        GROUP BY COALESCE(NULLIF(verbleib, ''), '')
        ORDER BY anzahlLange DESC`,

      // Vollste Stellplätze
      prisma.logIdStand.groupBy({
        by:      ["stellplatz"],
        _count:  { _all: true },
        where:   { AND: [{ stellplatz: { not: null } }, { stellplatz: { not: "" } }] },
      }),
    ]);

    const stauNachStufe = stauRaw.map((r) => ({
      verbleib:     r.verbleib === "" ? "ohne Verbleib" : r.verbleib,
      anzahl:       Number(r.anzahl),
      anzahlLange:  Number(r.anzahlLange),
      avgTageInStufe: r.avgTage == null ? 0 : Math.round(Number(r.avgTage)),
    }));

    const vollsteStellplaetze = stellplatzRaw
      .map((r) => ({ stellplatz: r.stellplatz ?? "", anzahl: r._count._all }))
      .filter((r) => r.stellplatz.trim() !== "")
      .sort((a, b) => b.anzahl - a.anzahl)
      .slice(0, 15);

    return {
      schwelleTage:    STAU_SCHWELLE_TAGE,
      aeltesteGeraete,
      aeltestesGeraet: aeltesteGeraete[0] ?? null,
      ohneBewegung: {
        gesamt: Number(ohneBewegungCountRaw[0]?.anzahl ?? 0),
        liste:  ohneBewegungListe,
      },
      stauNachStufe,
      groessterStau:   stauNachStufe[0] ?? null,
      vollsteStellplaetze,
    };
  }),

  // Drilldown-Liste: alle Geräte einer Stufe / eines Stellplatzes / ohne Verbleib,
  // paginiert. Filterfelder (verbleib/stellplatz/verweildauerTage) sind indiziert.
  // Reine Auswertung, kein Bestandseffekt.
  geraeteListe: permissionProcedure("GERAETE_REISE_VIEW")
    .input(z.object({
      verbleib:     z.string().optional(),
      stellplatz:   z.string().optional(),
      ohneVerbleib: z.boolean().optional(),
      seite:        z.number().int().min(1).default(1),
      proSeite:     z.number().int().min(1).max(200).default(50),
    }))
    .query(async ({ input }) => {
      const where =
        input.ohneVerbleib ? { OR: [{ verbleib: null }, { verbleib: "" }] }
        : input.verbleib    ? { verbleib: input.verbleib }
        : input.stellplatz  ? { stellplatz: input.stellplatz }
        : {};

      const [gesamt, zeilen] = await Promise.all([
        prisma.logIdStand.count({ where }),
        prisma.logIdStand.findMany({
          where,
          orderBy: { verweildauerTage: "desc" },
          skip:    (input.seite - 1) * input.proSeite,
          take:    input.proSeite,
          select:  {
            logId: true, hersteller: true, bezeichnung: true,
            verweildauerTage: true, verbleib: true, stellplatz: true,
            inVerbleibSeit: true,
          },
        }),
      ]);

      return { gesamt, zeilen };
    }),
});
