import { z } from "zod";
import { createTRPCRouter, permissionProcedure } from "@/server/trpc";
import { prisma } from "@/core/db/prisma";
import { runMobilImport } from "@/modules/mobil/import";
import { MOBIL_TEILTYPEN } from "@/lib/mobil/parser";

// Mobil-Ersatzteile (Smartphone/Tablet-Teile mit LogID).
// Lesen: MOBIL_VIEW, Import/Verwalten: MOBIL_MANAGE (ADMIN via SYSTEM_ADMIN-Wildcard).
// Eigenes Modul — KEIN Effekt auf das Laptop-Lager/Buchungen.
const view   = permissionProcedure("MOBIL_VIEW");
const manage = permissionProcedure("MOBIL_MANAGE");

// Einkaufswert (Prisma.Decimal | null) → plain number | null (superjson serialisiert
// Decimal nicht sinnvoll). Der Client formatiert selbst.
function ekZahl(v: unknown): number | null {
  if (v == null) return null;
  return typeof v === "number" ? v : Number(v);
}

export const mobilRouter = createTRPCRouter({

  // CSV-Import (ReForm/AfB-Export als Text). Schreibt je LogID eine MobilTeil-Zeile,
  // Sicheres als ERKANNT, Unsicheres als REVIEW. Idempotent (upsert je logId),
  // MANUELL zugeordnete Teile bleiben in der Zuordnung unangetastet.
  importieren: manage
    .input(z.object({
      csvText:   z.string().min(1, "Leere CSV"),
      dateiname: z.string().max(255).optional(),
      dryRun:    z.boolean().optional(), // true → nur Bericht, schreibt NICHTS
    }))
    .mutation(async ({ input }) => {
      return runMobilImport(input.csvText, { dryRun: input.dryRun });
    }),

  // Kurz-Übersicht (Kennzahlen) — kein Anzeige-Interface, nur Zähler.
  stats: view.query(async () => {
    const [gesamt, erkannt, review, manuell, modelle, teiltypen] = await Promise.all([
      prisma.mobilTeil.count(),
      prisma.mobilTeil.count({ where: { zuordnungStatus: "ERKANNT" } }),
      prisma.mobilTeil.count({ where: { zuordnungStatus: "REVIEW" } }),
      prisma.mobilTeil.count({ where: { zuordnungStatus: "MANUELL" } }),
      prisma.mobilModell.count(),
      prisma.mobilTeiltyp.count(),
    ]);
    return { gesamt, erkannt, review, manuell, modelle, teiltypen };
  }),

  // ── Browsing (read-only) ─────────────────────────────────────────────────────

  // Hersteller, die Teile haben: je Hersteller Anzahl Modelle + Anzahl PHYSISCHER
  // Teile (DISTINCT MobilTeil über die Kompatibilitäts-Verknüpfung — ein Teil, das
  // zu mehreren Modellen passt, zählt pro Hersteller nur einmal).
  hersteller: view.query(async () => {
    const rows = await prisma.$queryRaw<Array<{ hersteller: string; modelle: bigint; teile: bigint }>>`
      SELECT m.hersteller AS hersteller,
             COUNT(DISTINCT m.id)        AS modelle,
             COUNT(DISTINCT tm.teilId)   AS teile
      FROM \`MobilModell\` m
      JOIN \`MobilTeilModell\` tm ON tm.modellId = m.id
      GROUP BY m.hersteller
      ORDER BY teile DESC, m.hersteller ASC`;
    return rows.map((r) => ({
      hersteller: r.hersteller,
      modelle:    Number(r.modelle),
      teile:      Number(r.teile),
    }));
  }),

  // Modelle eines Herstellers (nur mit Teilen), je mit Gesamt-Stückzahl
  // (DISTINCT MobilTeil über die Verknüpfung — physische Teile, nicht doppelt).
  // Sortiert „nach Modellnummer" (numerisch-natürlich).
  modelle: view
    .input(z.object({ hersteller: z.string().trim().min(1) }))
    .query(async ({ input }) => {
      const rows = await prisma.$queryRaw<Array<{ id: number; modell: string; stueck: bigint }>>`
        SELECT m.id AS id, m.modell AS modell, COUNT(DISTINCT tm.teilId) AS stueck
        FROM \`MobilModell\` m
        JOIN \`MobilTeilModell\` tm ON tm.modellId = m.id
        WHERE m.hersteller = ${input.hersteller}
        GROUP BY m.id, m.modell`;
      return rows
        .map((r) => ({ id: r.id, modell: r.modell, stueck: Number(r.stueck) }))
        .sort((a, b) => a.modell.localeCompare(b.modell, "de", { numeric: true }));
    }),

  // Teile eines Modells, gruppiert nach Teiltyp: Gesamt-Stückzahl + Aufschlüsselung
  // je Colli. Stückzahl = COUNT der MobilTeil (1 LogID = 1 Stück); ein Teil ist
  // einem Modell über die Verknüpfung genau einmal zugeordnet → kein Doppelzählen.
  teileProModell: view
    .input(z.object({ modellId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const rows = await prisma.$queryRaw<Array<{ teiltyp: string | null; colli: string | null; anzahl: bigint }>>`
        SELECT tt.name AS teiltyp, t.colli AS colli, COUNT(*) AS anzahl
        FROM \`MobilTeilModell\` tm
        JOIN \`MobilTeil\` t      ON t.id = tm.teilId
        LEFT JOIN \`MobilTeiltyp\` tt ON tt.id = t.teiltypId
        WHERE tm.modellId = ${input.modellId}
        GROUP BY tt.name, t.colli`;

      // Soll-Mengen (Mindestbestand) + Teiltyp-Namen→Id-Auflösung laden, damit jede
      // Gruppe ihr Soll bekommt (Teiltyp-Referenz konsistent zu setMindestbestand).
      const [mindest, teiltypAlle] = await Promise.all([
        prisma.mobilMindestbestand.findMany({
          where:  { modellId: input.modellId },
          select: { teiltypId: true, sollMenge: true },
        }),
        prisma.mobilTeiltyp.findMany({ select: { id: true, name: true } }),
      ]);
      const teiltypIdByName = new Map(teiltypAlle.map((t) => [t.name, t.id]));
      const sollByTeiltypId = new Map(mindest.map((m) => [m.teiltypId, m.sollMenge]));
      // null = kein Mindestbestand (ungesetzt ODER soll=0 = Hinweis aus).
      const sollFuer = (name: string): number | null => {
        const id = teiltypIdByName.get(name);
        const s  = id != null ? sollByTeiltypId.get(id) : undefined;
        return s != null && s > 0 ? s : null;
      };

      // Nach Teiltyp gruppieren (Collis je Teiltyp, Anzahl summieren).
      const map = new Map<string, { teiltyp: string; stueck: number; collis: { colli: string; anzahl: number }[] }>();
      for (const r of rows) {
        const teiltyp = r.teiltyp ?? "ohne Teiltyp";
        const anzahl  = Number(r.anzahl);
        const g = map.get(teiltyp) ?? { teiltyp, stueck: 0, collis: [] };
        g.stueck += anzahl;
        g.collis.push({ colli: r.colli ?? "ohne Colli", anzahl });
        map.set(teiltyp, g);
      }

      // Konsistente Teiltyp-Reihenfolge (Akku, Display, …), Unbekanntes ans Ende.
      const ord = (name: string) => {
        const i = (MOBIL_TEILTYPEN as readonly string[]).indexOf(name);
        return i === -1 ? MOBIL_TEILTYPEN.length : i;
      };
      const teiltypen = [...map.values()]
        .sort((a, b) => ord(a.teiltyp) - ord(b.teiltyp) || a.teiltyp.localeCompare(b.teiltyp, "de"))
        .map((g) => ({
          teiltyp: g.teiltyp,
          stueck:  g.stueck,
          soll:    sollFuer(g.teiltyp), // Ist = stueck, Soll = sollFuer (null = nicht gesetzt)
          collis:  g.collis.sort((a, b) => b.anzahl - a.anzahl || a.colli.localeCompare(b.colli, "de", { numeric: true })),
        }));

      const gesamt = teiltypen.reduce((s, g) => s + g.stueck, 0);
      return { gesamt, teiltypen };
    }),

  // Mindestbestand je Modell+Teiltyp setzen (Upsert über @@unique modellId+teiltypId).
  // sollMenge 0 = kein Mindestbestand (Hinweis aus). Teiltyp per Name (konsistent zu
  // teileProModell); existiert er noch nicht, wird er angelegt (get-or-create).
  setMindestbestand: manage
    .input(z.object({
      modellId:  z.number().int().positive(),
      teiltyp:   z.string().trim().min(1),
      sollMenge: z.number().int().min(0).max(1_000_000),
    }))
    .mutation(async ({ input }) => {
      const tt = await prisma.mobilTeiltyp.upsert({
        where:  { name: input.teiltyp },
        update: {},
        create: { name: input.teiltyp },
      });
      await prisma.mobilMindestbestand.upsert({
        where:  { modellId_teiltypId: { modellId: input.modellId, teiltypId: tt.id } },
        update: { sollMenge: input.sollMenge },
        create: { modellId: input.modellId, teiltypId: tt.id, sollMenge: input.sollMenge },
      });
      return { ok: true, sollMenge: input.sollMenge };
    }),

  // Alle Modell+Teiltyp-Gruppen unter Mindestbestand (Ist < Soll, nur Soll>0).
  // DB-seitig: je Soll-Eintrag wird die Ist-Menge (DISTINCT Teil über die
  // Kompatibilitäts-Verknüpfung) per Subquery gezählt — kein Voll-Load.
  mobilUnterMindestbestand: view.query(async () => {
    // Derived table (Ist je Soll-Eintrag), dann im äußeren WHERE filtern — kein
    // HAVING ohne GROUP BY (robust unter ONLY_FULL_GROUP_BY).
    const rows = await prisma.$queryRaw<Array<{
      hersteller: string; modell: string; teiltyp: string; ist: bigint; soll: number;
    }>>`
      SELECT x.hersteller, x.modell, x.teiltyp, x.ist, x.soll
      FROM (
        SELECT m.hersteller AS hersteller, m.modell AS modell, tt.name AS teiltyp,
               ( SELECT COUNT(*) FROM \`MobilTeilModell\` tm
                 JOIN \`MobilTeil\` t ON t.id = tm.teilId
                 WHERE tm.modellId = mb.modellId AND t.teiltypId = mb.teiltypId ) AS ist,
               mb.sollMenge AS soll
        FROM \`MobilMindestbestand\` mb
        JOIN \`MobilModell\`   m  ON m.id  = mb.modellId
        JOIN \`MobilTeiltyp\`  tt ON tt.id = mb.teiltypId
        WHERE mb.sollMenge > 0
      ) x
      WHERE x.ist < x.soll
      ORDER BY (x.soll - x.ist) DESC`;

    const gruppen = rows.map((r) => {
      const ist = Number(r.ist);
      return { hersteller: r.hersteller, modell: r.modell, teiltyp: r.teiltyp, ist, soll: r.soll, fehlt: r.soll - ist };
    });
    return { anzahl: gruppen.length, gruppen };
  }),

  // LogIDs einer Modell+Teiltyp-Gruppe: je Teil logId + colli + stellplatz +
  // Bezeichnung + EK, plus die WEITEREN kompatiblen Modelle (Mehrfach-Modell-Hinweis,
  // ohne das aktuelle Modell). Sortiert nach colli (leere zuletzt), dann logId.
  logIdsProTeiltyp: view
    .input(z.object({
      modellId: z.number().int().positive(),
      teiltyp:  z.string().trim().min(1),
    }))
    .query(async ({ input }) => {
      const teile = await prisma.mobilTeil.findMany({
        where: {
          teiltyp: { name: input.teiltyp },
          modelle: { some: { modellId: input.modellId } },
        },
        select: {
          logId: true, colli: true, stellplatz: true, originalBezeichnung: true,
          ek: true, aan: true, lieferant: true,
          modelle: { select: { modell: { select: { id: true, modell: true } } } },
        },
      });

      const rows = teile.map((t) => ({
        logId:       t.logId,
        colli:       t.colli,
        stellplatz:  t.stellplatz,
        bezeichnung: t.originalBezeichnung,
        ek:          ekZahl(t.ek),
        aan:         t.aan,
        lieferant:   t.lieferant,
        auch:        t.modelle
          .map((mm) => mm.modell)
          .filter((m) => m.id !== input.modellId)
          .map((m) => m.modell)
          .sort((a, b) => a.localeCompare(b, "de", { numeric: true })),
      }));

      rows.sort((a, b) =>
        (a.colli ?? "￿").localeCompare(b.colli ?? "￿", "de", { numeric: true }) ||
        a.logId.localeCompare(b.logId, "de", { numeric: true }),
      );
      return rows;
    }),
});
