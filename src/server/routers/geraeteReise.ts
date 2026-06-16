import { z } from "zod";
import { createTRPCRouter, permissionProcedure } from "@/server/trpc";
import { prisma } from "@/core/db/prisma";
import { buildGeraeteWhere, stellplatzBereich } from "@/modules/geraete-reise/filter";

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
      prisma.logIdStand.count({ where: { ausgeschieden: false } }),
      prisma.logIdStand.count({ where: { AND: [{ ausgeschieden: false }, { OR: [{ verbleib: null }, { verbleib: "" }] }] } }),
      prisma.logIdStand.count({ where: { ausgeschieden: false, blockiert: true } }),
      prisma.logIdStand.count({ where: { ausgeschieden: false, verweildauerTage: { gt: LADENHUETER_TAGE } } }),
      prisma.logIdStand.aggregate({ _avg: { verweildauerTage: true }, where: { ausgeschieden: false } }),
      prisma.logIdStand.groupBy({ by: ["verbleib"],    _count: { _all: true }, where: { ausgeschieden: false } }),
      prisma.logIdStand.groupBy({ by: ["geraeteart"],  _count: { _all: true }, where: { ausgeschieden: false } }),
      prisma.logIdStand.groupBy({ by: ["lager"],       _count: { _all: true }, where: { ausgeschieden: false } }),
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
          WHERE verweildauerTage IS NOT NULL AND ausgeschieden = false
        ) t GROUP BY bucket`,
      prisma.logIdStand.findMany({
        where:   { verweildauerTage: { not: null }, ausgeschieden: false },
        orderBy: { verweildauerTage: "desc" },
        take:    20,
        select:  {
          logId: true, hersteller: true, bezeichnung: true,
          verweildauerTage: true, verbleib: true, stellplatz: true, colli: true,
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
      verweildauerTage: true, verbleib: true, stellplatz: true, colli: true,
    } as const;

    type GeraetZeile = {
      logId:            string;
      hersteller:       string | null;
      bezeichnung:      string | null;
      verweildauerTage: number | null;
      verbleib:         string | null;
      stellplatz:       string | null;
      colli:            string | null;
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
        where:   { verweildauerTage: { not: null }, ausgeschieden: false },
        orderBy: { verweildauerTage: "desc" },
        take:    20,
        select:  listSelect,
      }),

      // Anzahl LogIDs ganz ohne Bewegung (NOT EXISTS — keine Prisma-Relation vorhanden)
      prisma.$queryRaw<Array<{ anzahl: bigint }>>`
        SELECT COUNT(*) AS anzahl
        FROM \`LogIdStand\` s
        WHERE s.ausgeschieden = false AND NOT EXISTS (
          SELECT 1 FROM \`LogIdBewegung\` b WHERE b.logId = s.logId
        )`,

      // Die 20 ältesten ohne jede Bewegung (die aussagekräftige Liste)
      prisma.$queryRaw<GeraetZeile[]>`
        SELECT s.logId, s.hersteller, s.bezeichnung, s.verweildauerTage, s.verbleib, s.stellplatz, s.colli
        FROM \`LogIdStand\` s
        WHERE s.ausgeschieden = false AND NOT EXISTS (
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
        WHERE ausgeschieden = false
        GROUP BY COALESCE(NULLIF(verbleib, ''), '')
        ORDER BY anzahlLange DESC`,

      // Vollste Stellplätze
      prisma.logIdStand.groupBy({
        by:      ["stellplatz"],
        _count:  { _all: true },
        where:   { AND: [{ ausgeschieden: false }, { stellplatz: { not: null } }, { stellplatz: { not: "" } }] },
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
      verbleib:           z.string().optional(),
      stellplatz:         z.string().optional(),
      stellplatzPrefix:   z.string().optional(),
      stellplatzContains: z.string().optional(),
      stellplaetze:       z.array(z.string()).optional(),
      bereich:            z.string().optional(),
      ohneVerbleib:       z.boolean().optional(),
      geraeteart:         z.string().optional(),
      hersteller:       z.string().optional(),
      lager:            z.string().optional(),
      lagernummer:      z.string().optional(),
      alterVon:         z.number().int().optional(),
      alterBis:         z.number().int().optional(),
      ausgeschieden:    z.boolean().optional(),
      seite:            z.number().int().min(1).default(1),
      proSeite:         z.number().int().min(1).max(200).default(50),
    }))
    .query(async ({ input }) => {
      // Zentraler where-Builder (identisch zum Export-Endpoint).
      const where = buildGeraeteWhere(input);

      const [gesamt, zeilen] = await Promise.all([
        prisma.logIdStand.count({ where }),
        prisma.logIdStand.findMany({
          where,
          orderBy: { verweildauerTage: "desc" },
          skip:    (input.seite - 1) * input.proSeite,
          take:    input.proSeite,
          select:  {
            logId: true, hersteller: true, bezeichnung: true,
            verweildauerTage: true, verbleib: true, stellplatz: true, colli: true,
            inVerbleibSeit: true, ausgeschiedenAm: true,
          },
        }),
      ]);

      return { gesamt, zeilen };
    }),

  // Inhalt eines Collis: alle (nicht ausgeschiedenen) Geräte mit exakt dieser
  // Colli-Nummer. Für das Colli-Detail-Popup (welche Geräte liegen zusammen?).
  // Reine Auswertung, kein Bestandseffekt.
  colliInhalt: permissionProcedure("GERAETE_REISE_VIEW")
    .input(z.object({ colli: z.string().trim().min(1).max(191) }))
    .query(async ({ input }) => {
      const geraete = await prisma.logIdStand.findMany({
        where:   { colli: input.colli, ausgeschieden: false },
        orderBy: { logId: "asc" },
        select:  {
          logId: true, hersteller: true, bezeichnung: true, geraeteart: true,
          stellplatz: true, verbleib: true, grading: true, aktuellerZustand: true,
        },
      });
      return { colli: input.colli, anzahl: geraete.length, geraete };
    }),

  // Detailanalyse einer Geräteart: Kennzahlen + Hersteller-/Verbleib-Verteilung
  // + Alters-Buckets. Alles DB-seitig (where geraeteart = X), Promise.all.
  // Reine Auswertung, kein Bestandseffekt.
  geraeteartDetail: permissionProcedure("GERAETE_REISE_VIEW")
    .input(z.object({ geraeteart: z.string().min(1).max(191) }))
    .query(async ({ input }) => {
      const art = input.geraeteart;
      const LADENHUETER_TAGE = 365;

      const [
        anzahl,
        avgAgg,
        ohneVerbleib,
        blockiert,
        ladenhueter,
        herstellerRaw,
        verbleibRaw,
        agingRaw,
      ] = await Promise.all([
        prisma.logIdStand.count({ where: { geraeteart: art, ausgeschieden: false } }),
        prisma.logIdStand.aggregate({ _avg: { verweildauerTage: true }, where: { geraeteart: art, ausgeschieden: false } }),
        prisma.logIdStand.count({ where: { AND: [{ geraeteart: art }, { ausgeschieden: false }, { OR: [{ verbleib: null }, { verbleib: "" }] }] } }),
        prisma.logIdStand.count({ where: { geraeteart: art, ausgeschieden: false, blockiert: true } }),
        prisma.logIdStand.count({ where: { geraeteart: art, ausgeschieden: false, verweildauerTage: { gt: LADENHUETER_TAGE } } }),
        prisma.logIdStand.groupBy({ by: ["hersteller"], _count: { _all: true }, where: { geraeteart: art, ausgeschieden: false } }),
        prisma.logIdStand.groupBy({ by: ["verbleib"],   _count: { _all: true }, where: { geraeteart: art, ausgeschieden: false } }),
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
            WHERE verweildauerTage IS NOT NULL AND ausgeschieden = false AND geraeteart = ${art}
          ) t GROUP BY bucket`,
      ]);

      // null/leer zusammenfassen, absteigend sortieren.
      function verdichte(rows: { _count: { _all: number } }[], keyOf: (r: never) => string | null, leerLabel: string) {
        const map = new Map<string, number>();
        for (const r of rows) {
          const roh = keyOf(r as never);
          const label = roh && roh.trim() !== "" ? roh : leerLabel;
          map.set(label, (map.get(label) ?? 0) + r._count._all);
        }
        return [...map.entries()].map(([label, anzahl]) => ({ label, anzahl })).sort((a, b) => b.anzahl - a.anzahl);
      }

      // Hersteller: Top 12, Rest → „Sonstige".
      const herstellerAlle = verdichte(herstellerRaw, (r: { hersteller: string | null }) => r.hersteller, "ohne Angabe");
      let herstellerVerteilung: { hersteller: string; anzahl: number }[];
      if (herstellerAlle.length > 12) {
        const rest = herstellerAlle.slice(12).reduce((s, x) => s + x.anzahl, 0);
        herstellerVerteilung = [
          ...herstellerAlle.slice(0, 12).map((x) => ({ hersteller: x.label, anzahl: x.anzahl })),
          { hersteller: "Sonstige", anzahl: rest },
        ];
      } else {
        herstellerVerteilung = herstellerAlle.map((x) => ({ hersteller: x.label, anzahl: x.anzahl }));
      }

      const verbleibVerteilung = verdichte(verbleibRaw, (r: { verbleib: string | null }) => r.verbleib, "ohne Verbleib")
        .map((x) => ({ verbleib: x.label, anzahl: x.anzahl }));

      const BUCKET_ORDER = ["0–30", "31–90", "91–180", "181–365", ">365"];
      const agingMap = new Map(agingRaw.map((r) => [r.bucket, Number(r.anzahl)]));
      const agingBuckets = BUCKET_ORDER.map((bucket) => ({ bucket, anzahl: agingMap.get(bucket) ?? 0 }));

      return {
        geraeteart: art,
        kennzahlen: {
          anzahl,
          avgVerweildauer: Math.round(avgAgg._avg.verweildauerTage ?? 0),
          ohneVerbleib,
          blockiert,
          ladenhueter,
        },
        herstellerVerteilung,
        verbleibVerteilung,
        agingBuckets,
      };
    }),

  // Standort-Analyse: dieselbe tiefe Analyse wie geraeteartDetail, aber scoped
  // auf Lagernummer und/oder Stellplatz-Präfix. Nutzt den zentralen where-Builder
  // (ausgeschieden=false wie die übrigen Auswertungen). Reine Auswertung.
  standortAnalyse: permissionProcedure("GERAETE_REISE_VIEW")
    .input(z.object({
      lagernummer:      z.string().min(1).max(191).optional(),
      stellplatzPrefix: z.string().min(1).max(191).optional(),
    }).refine((d) => d.lagernummer || d.stellplatzPrefix, {
      message: "Lagernummer oder Stellplatz angeben.",
    }))
    .query(async ({ input }) => {
      const LADENHUETER_TAGE = 365;
      // Scope (ausgeschieden=false + lagernummer/stellplatzPrefix) über den
      // zentralen Builder — identisch zur Drilldown-Liste.
      const scope = buildGeraeteWhere({
        lagernummer:      input.lagernummer,
        stellplatzPrefix: input.stellplatzPrefix,
        ausgeschieden:    false,
      });
      const mit = (extra: object) => ({ AND: [scope, extra] });

      const AGING_RANGES: { bucket: string; range: object }[] = [
        { bucket: "0–30",    range: { gte: 0,   lte: 30 } },
        { bucket: "31–90",   range: { gte: 31,  lte: 90 } },
        { bucket: "91–180",  range: { gte: 91,  lte: 180 } },
        { bucket: "181–365", range: { gte: 181, lte: 365 } },
        { bucket: ">365",    range: { gt: 365 } },
      ];

      // Aging-Counts separat sammeln (Spread in Promise.all würde die Tuple-
      // Typisierung der übrigen Ergebnisse aushebeln) — bleibt trotzdem parallel.
      const [
        [anzahl, avgAgg, ohneVerbleib, blockiert, ladenhueter, herstellerRaw, verbleibRaw],
        agingCounts,
      ] = await Promise.all([
        Promise.all([
          prisma.logIdStand.count({ where: scope }),
          prisma.logIdStand.aggregate({ _avg: { verweildauerTage: true }, where: scope }),
          prisma.logIdStand.count({ where: mit({ OR: [{ verbleib: null }, { verbleib: "" }] }) }),
          prisma.logIdStand.count({ where: mit({ blockiert: true }) }),
          prisma.logIdStand.count({ where: mit({ verweildauerTage: { gt: LADENHUETER_TAGE } }) }),
          prisma.logIdStand.groupBy({ by: ["hersteller"], _count: { _all: true }, where: scope }),
          prisma.logIdStand.groupBy({ by: ["verbleib"],   _count: { _all: true }, where: scope }),
        ]),
        Promise.all(AGING_RANGES.map((b) => prisma.logIdStand.count({ where: mit({ verweildauerTage: b.range }) }))),
      ]);

      function verdichte(rows: { _count: { _all: number } }[], keyOf: (r: never) => string | null, leerLabel: string) {
        const map = new Map<string, number>();
        for (const r of rows) {
          const roh = keyOf(r as never);
          const label = roh && roh.trim() !== "" ? roh : leerLabel;
          map.set(label, (map.get(label) ?? 0) + r._count._all);
        }
        return [...map.entries()].map(([label, anzahl]) => ({ label, anzahl })).sort((a, b) => b.anzahl - a.anzahl);
      }

      // Hersteller: Top 12, Rest → „Sonstige".
      const herstellerAlle = verdichte(herstellerRaw, (r: { hersteller: string | null }) => r.hersteller, "ohne Angabe");
      let herstellerVerteilung: { hersteller: string; anzahl: number }[];
      if (herstellerAlle.length > 12) {
        const rest = herstellerAlle.slice(12).reduce((s, x) => s + x.anzahl, 0);
        herstellerVerteilung = [
          ...herstellerAlle.slice(0, 12).map((x) => ({ hersteller: x.label, anzahl: x.anzahl })),
          { hersteller: "Sonstige", anzahl: rest },
        ];
      } else {
        herstellerVerteilung = herstellerAlle.map((x) => ({ hersteller: x.label, anzahl: x.anzahl }));
      }

      const verbleibVerteilung = verdichte(verbleibRaw, (r: { verbleib: string | null }) => r.verbleib, "ohne Verbleib")
        .map((x) => ({ verbleib: x.label, anzahl: x.anzahl }));

      const agingBuckets = AGING_RANGES.map((b, i) => ({ bucket: b.bucket, anzahl: agingCounts[i] ?? 0 }));

      return {
        lagernummer:      input.lagernummer ?? null,
        stellplatzPrefix: input.stellplatzPrefix ?? null,
        kennzahlen: {
          anzahl,
          avgVerweildauer: Math.round(avgAgg._avg.verweildauerTage ?? 0),
          ohneVerbleib,
          blockiert,
          ladenhueter,
        },
        herstellerVerteilung,
        verbleibVerteilung,
        agingBuckets,
      };
    }),

  // Stellplatz-Bereiche: distinct Stellplatz + Anzahl, serverseitig nach Bereich
  // (führende nicht-numerische Segmente) gruppiert. Optionaler Freitext (Teil-
  // treffer auf Stellplatz) + optionale Lagernummer. Zentraler Filter, ausgeschieden=false.
  stellplatzBereiche: permissionProcedure("GERAETE_REISE_VIEW")
    .input(z.object({
      suche:       z.string().max(191).optional(),
      lagernummer: z.string().max(191).optional(),
    }).optional())
    .query(async ({ input }) => {
      const where = buildGeraeteWhere({
        stellplatzContains: input?.suche?.trim() || undefined,
        lagernummer:        input?.lagernummer?.trim() || undefined,
        ausgeschieden:      false,
      });

      const rows = await prisma.logIdStand.groupBy({
        by:     ["stellplatz"],
        _count: { _all: true },
        where:  { AND: [where, { stellplatz: { not: null } }, { stellplatz: { not: "" } }] },
      });

      const map = new Map<string, { bereich: string; anzahl: number; stellplaetze: { stellplatz: string; anzahl: number }[] }>();
      for (const r of rows) {
        const sp = r.stellplatz;
        if (!sp) continue;
        const n = r._count._all;
        const b = stellplatzBereich(sp);
        let e = map.get(b);
        if (!e) { e = { bereich: b, anzahl: 0, stellplaetze: [] }; map.set(b, e); }
        e.anzahl += n;
        e.stellplaetze.push({ stellplatz: sp, anzahl: n });
      }
      const bereiche = [...map.values()].sort((a, b) => b.anzahl - a.anzahl || a.bereich.localeCompare(b.bereich, "de", { numeric: true }));
      for (const e of bereiche) {
        e.stellplaetze.sort((a, b) => b.anzahl - a.anzahl || a.stellplatz.localeCompare(b.stellplatz, "de", { numeric: true }));
      }
      return { bereiche, stellplaetzeGesamt: rows.length };
    }),

  // Distinct, NICHT-null Lagernummern (für das optionale Dropdown). Leer, solange
  // noch kein Import die Lagernummer befüllt hat.
  lagernummern: permissionProcedure("GERAETE_REISE_VIEW").query(async () => {
    const rows = await prisma.logIdStand.groupBy({
      by:     ["lagernummer"],
      _count: { _all: true },
      where:  { AND: [{ ausgeschieden: false }, { lagernummer: { not: null } }, { lagernummer: { not: "" } }] },
    });
    return rows
      .map((r) => ({ lagernummer: r.lagernummer as string, anzahl: r._count._all }))
      .sort((a, b) => a.lagernummer.localeCompare(b.lagernummer, "de", { numeric: true }));
  }),

  // Übersicht der ausgeschiedenen Geräte (das System verlassen). Kennzahlen,
  // Verteilung nach letztem Verbleib (Abgang-Grund-Hinweis), letzte Stellplätze
  // + die zuletzt ausgeschiedenen Geräte. Reine Auswertung, kein Bestandseffekt.
  ausgeschiedeneUebersicht: permissionProcedure("GERAETE_REISE_VIEW").query(async () => {
    const [gesamt, letzterImport, verbleibRaw, stellplatzRaw, liste] = await Promise.all([
      prisma.logIdStand.count({ where: { ausgeschieden: true } }),
      prisma.logIdImport.findFirst({
        where:   { status: "fertig" },
        orderBy: { importiertAm: "desc" },
        select:  { importiertAm: true, anzahlAusgeschieden: true },
      }),
      prisma.logIdStand.groupBy({ by: ["verbleib"], _count: { _all: true }, where: { ausgeschieden: true } }),
      prisma.logIdStand.groupBy({
        by:     ["stellplatz"],
        _count: { _all: true },
        where:  { AND: [{ ausgeschieden: true }, { stellplatz: { not: null } }, { stellplatz: { not: "" } }] },
      }),
      prisma.logIdStand.findMany({
        where:   { ausgeschieden: true },
        orderBy: { ausgeschiedenAm: "desc" },
        take:    100,
        select:  {
          logId: true, hersteller: true, bezeichnung: true,
          stellplatz: true, colli: true, verbleib: true, ausgeschiedenAm: true,
        },
      }),
    ]);

    function verdichte(rows: { _count: { _all: number } }[], keyOf: (r: never) => string | null, leerLabel: string) {
      const map = new Map<string, number>();
      for (const r of rows) {
        const roh = keyOf(r as never);
        const label = roh && roh.trim() !== "" ? roh : leerLabel;
        map.set(label, (map.get(label) ?? 0) + r._count._all);
      }
      return [...map.entries()].map(([label, anzahl]) => ({ label, anzahl })).sort((a, b) => b.anzahl - a.anzahl);
    }

    const verbleibVerteilung = verdichte(verbleibRaw, (r: { verbleib: string | null }) => r.verbleib, "ohne Verbleib")
      .map((x) => ({ verbleib: x.label, anzahl: x.anzahl }));

    const topStellplaetze = verdichte(stellplatzRaw, (r: { stellplatz: string | null }) => r.stellplatz, "ohne Angabe")
      .slice(0, 15)
      .map((x) => ({ stellplatz: x.label, anzahl: x.anzahl }));

    return {
      kennzahlen: {
        gesamt,
        neuImLetztenImport: letzterImport?.anzahlAusgeschieden ?? 0,
      },
      letzterImport: letzterImport?.importiertAm ?? null,
      verbleibVerteilung,
      topStellplaetze,
      liste,
    };
  }),
});
