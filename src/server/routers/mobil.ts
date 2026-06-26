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

// $queryRaw liefert COUNT(*) als BigInt und SUM(Decimal) als String — beides hier
// robust nach number (für JSON/superjson + Client-Formatierung).
function num(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === "bigint" ? Number(v) : Number(v as number | string);
  return Number.isFinite(n) ? n : 0;
}

// Konsistente Teiltyp-Reihenfolge (Akku, Display, …) für Diagramme; Unbekanntes ans Ende.
function teiltypRang(name: string): number {
  const i = (MOBIL_TEILTYPEN as readonly string[]).indexOf(name);
  return i === -1 ? MOBIL_TEILTYPEN.length : i;
}

// ── Geteilte Auswertungs-Helfer (DB-seitig aggregiert, KEIN Voll-Load) ──────────

// Gruppen unter Mindestbestand (Ist < Soll, nur Soll>0). Zentrale Logik, die sowohl
// mobilUnterMindestbestand als auch statUnterMindestbestand/statKpis nutzen.
// Ist-Menge = aktive Teile (ausgeschieden=false) DISTINCT über die Verknüpfung.
async function ladeUnterMindestbestand() {
  const rows = await prisma.$queryRaw<Array<{
    hersteller: string; modell: string; teiltyp: string; ist: bigint; soll: number;
  }>>`
    SELECT x.hersteller, x.modell, x.teiltyp, x.ist, x.soll
    FROM (
      SELECT m.hersteller AS hersteller, m.modell AS modell, tt.name AS teiltyp,
             ( SELECT COUNT(*) FROM \`MobilTeilModell\` tm
               JOIN \`MobilTeil\` t ON t.id = tm.teilId
               WHERE tm.modellId = mb.modellId AND t.teiltypId = mb.teiltypId
                 AND t.ausgeschieden = false ) AS ist,
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
}

// Gesamt-Einkaufswert aller AKTIVEN Teile (für KPIs + Lagerwert).
async function ladeLagerwertGesamt(): Promise<number> {
  const [row] = await prisma.$queryRaw<Array<{ ekSumme: unknown }>>`
    SELECT COALESCE(SUM(ek), 0) AS ekSumme FROM \`MobilTeil\` WHERE ausgeschieden = false`;
  return num(row?.ekSumme);
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
  // Bestandszahlen (gesamt/erkannt/review/manuell) zählen NUR aktive Teile
  // (ausgeschieden=false); ausgelieferte Teile sind aus dem Bestand raus.
  // modelle/teiltypen sind Katalog-Zähler (Definitionen), kein Bestand.
  stats: view.query(async () => {
    const [gesamt, erkannt, review, manuell, modelle, teiltypen] = await Promise.all([
      prisma.mobilTeil.count({ where: { ausgeschieden: false } }),
      prisma.mobilTeil.count({ where: { ausgeschieden: false, zuordnungStatus: "ERKANNT" } }),
      prisma.mobilTeil.count({ where: { ausgeschieden: false, zuordnungStatus: "REVIEW" } }),
      prisma.mobilTeil.count({ where: { ausgeschieden: false, zuordnungStatus: "MANUELL" } }),
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
    // Nur AKTIVE Teile (t.ausgeschieden = false) zählen — der Inner-Join auf
    // MobilTeil schließt ausgeschiedene (ausgelieferte) Teile aus dem Bestand aus.
    const rows = await prisma.$queryRaw<Array<{ hersteller: string; modelle: bigint; teile: bigint }>>`
      SELECT m.hersteller AS hersteller,
             COUNT(DISTINCT m.id)        AS modelle,
             COUNT(DISTINCT tm.teilId)   AS teile
      FROM \`MobilModell\` m
      JOIN \`MobilTeilModell\` tm ON tm.modellId = m.id
      JOIN \`MobilTeil\` t        ON t.id = tm.teilId AND t.ausgeschieden = false
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
      // Nur AKTIVE Teile zählen (Inner-Join auf MobilTeil mit ausgeschieden=false);
      // Modelle ohne aktiven Bestand fallen damit aus der Liste.
      const rows = await prisma.$queryRaw<Array<{ id: number; modell: string; stueck: bigint }>>`
        SELECT m.id AS id, m.modell AS modell, COUNT(DISTINCT tm.teilId) AS stueck
        FROM \`MobilModell\` m
        JOIN \`MobilTeilModell\` tm ON tm.modellId = m.id
        JOIN \`MobilTeil\` t        ON t.id = tm.teilId AND t.ausgeschieden = false
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
        WHERE tm.modellId = ${input.modellId} AND t.ausgeschieden = false
        GROUP BY tt.name, t.colli`;

      // Soll-Mengen (Mindestbestand) + Teiltyp-Namen→Id-Auflösung laden, damit jede
      // Gruppe ihr Soll bekommt (Teiltyp-Referenz konsistent zu setMindestbestand).
      const [mindest, teiltypAlle, ausgeschieden] = await Promise.all([
        prisma.mobilMindestbestand.findMany({
          where:  { modellId: input.modellId },
          select: { teiltypId: true, sollMenge: true },
        }),
        prisma.mobilTeiltyp.findMany({ select: { id: true, name: true } }),
        // Reiner Hinweis (NICHT im Bestand): wie viele Teile dieses Modells sind
        // ausgeschieden (ausgeliefert)? Zählt nicht in stueck/gesamt.
        prisma.mobilTeil.count({
          where: { ausgeschieden: true, modelle: { some: { modellId: input.modellId } } },
        }),
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
      return { gesamt, teiltypen, ausgeschieden };
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
  mobilUnterMindestbestand: view.query(() => ladeUnterMindestbestand()),

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
          ausgeschieden: false, // nur aktiver Bestand (ausgelieferte Teile raus)
          teiltyp: { name: input.teiltyp },
          modelle: { some: { modellId: input.modellId } },
        },
        select: {
          logId: true, colli: true, stellplatz: true, originalBezeichnung: true,
          ek: true, aan: true, lieferant: true, farbe: true,
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
        farbe:       t.farbe,
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

  // ── Statistik (read-only, MOBIL_VIEW; DB-seitig aggregiert) ──────────────────
  // Datenehrlichkeit: ALLE Bestands-Auswertungen zählen nur AKTIVE Teile
  // (ausgeschieden=false). Ausgeschiedene Teile erscheinen ausschließlich in
  // statAusgeschieden („was wurde ausgeliefert/gebraucht").

  // Kennzahlen-Reihe oben auf der Statistik-Seite.
  statKpis: view.query(async () => {
    const [aktiveTeile, modelle, lagerwert, ausgeschieden, unter] = await Promise.all([
      prisma.mobilTeil.count({ where: { ausgeschieden: false } }),
      prisma.mobilModell.count(),
      ladeLagerwertGesamt(),
      prisma.mobilTeil.count({ where: { ausgeschieden: true } }),
      ladeUnterMindestbestand(),
    ]);
    return { aktiveTeile, modelle, lagerwert, ausgeschieden, unterMindestbestand: unter.anzahl };
  }),

  // Aktive Teile je Hersteller (Anzahl + EK-Summe). Zuordnung über das PRIMÄRE
  // Modell (t.modellId) → genau eine Hersteller-Zeile je Teil, kein EK-Doppelzählen.
  // REVIEW-Teile ohne Modell sind hier nicht zugeordnet (siehe statLagerwert-Rest).
  statBestandProHersteller: view.query(async () => {
    const rows = await prisma.$queryRaw<Array<{ hersteller: string; anzahl: bigint; ekSumme: unknown }>>`
      SELECT m.hersteller AS hersteller, COUNT(*) AS anzahl, COALESCE(SUM(t.ek), 0) AS ekSumme
      FROM \`MobilTeil\` t
      JOIN \`MobilModell\` m ON m.id = t.modellId
      WHERE t.ausgeschieden = false
      GROUP BY m.hersteller
      ORDER BY anzahl DESC, m.hersteller ASC`;
    return rows.map((r) => ({ hersteller: r.hersteller, anzahl: num(r.anzahl), ekSumme: num(r.ekSumme) }));
  }),

  // Top-N Modelle nach aktivem Bestand. COUNT(DISTINCT teilId) über die
  // Kompatibilitäts-Verknüpfung (konsistent zur stueck-Semantik der Browsing-Seite);
  // EK-Summe je Modell zählt jedes kompatible Teil genau einmal (@@unique teil+modell).
  statTopModelle: view
    .input(z.object({ limit: z.number().int().min(1).max(50).default(10) }).optional())
    .query(async ({ input }) => {
      const limit = input?.limit ?? 10;
      const rows = await prisma.$queryRaw<Array<{
        id: number; hersteller: string; modell: string; stueck: bigint; ekSumme: unknown;
      }>>`
        SELECT m.id AS id, m.hersteller AS hersteller, m.modell AS modell,
               COUNT(DISTINCT tm.teilId) AS stueck, COALESCE(SUM(t.ek), 0) AS ekSumme
        FROM \`MobilModell\` m
        JOIN \`MobilTeilModell\` tm ON tm.modellId = m.id
        JOIN \`MobilTeil\` t        ON t.id = tm.teilId AND t.ausgeschieden = false
        GROUP BY m.id, m.hersteller, m.modell
        ORDER BY stueck DESC, ekSumme DESC
        LIMIT ${limit}`;
      return rows.map((r) => ({
        id: r.id, hersteller: r.hersteller, modell: r.modell,
        stueck: num(r.stueck), ekSumme: num(r.ekSumme),
      }));
    }),

  // Aktive Teile je Teiltyp (Akku/Display/Displaymodul/Digitizer/…). Direkt über
  // t.teiltypId (ein Teil = ein Teiltyp, keine Verknüpfung nötig). In Teiltyp-
  // Reihenfolge sortiert. Teile ohne Teiltyp (REVIEW) sind nicht enthalten.
  statTeiltypVerteilung: view.query(async () => {
    const rows = await prisma.$queryRaw<Array<{ teiltyp: string; anzahl: bigint }>>`
      SELECT tt.name AS teiltyp, COUNT(*) AS anzahl
      FROM \`MobilTeil\` t
      JOIN \`MobilTeiltyp\` tt ON tt.id = t.teiltypId
      WHERE t.ausgeschieden = false
      GROUP BY tt.name`;
    return rows
      .map((r) => ({ teiltyp: r.teiltyp, anzahl: num(r.anzahl) }))
      .sort((a, b) => teiltypRang(a.teiltyp) - teiltypRang(b.teiltyp) || a.teiltyp.localeCompare(b.teiltyp, "de"));
  }),

  // Gesamt-Lagerwert (EK) aller aktiven Teile + Aufschlüsselung je Hersteller.
  // „Ohne Zuordnung" = aktive Teile ohne primäres Modell (REVIEW), damit die
  // Summe der Aufschlüsselung dem Gesamtwert entspricht (Datenehrlichkeit).
  statLagerwert: view.query(async () => {
    const [gesamt, proHersteller] = await Promise.all([
      ladeLagerwertGesamt(),
      prisma.$queryRaw<Array<{ hersteller: string; ekSumme: unknown }>>`
        SELECT m.hersteller AS hersteller, COALESCE(SUM(t.ek), 0) AS ekSumme
        FROM \`MobilTeil\` t
        JOIN \`MobilModell\` m ON m.id = t.modellId
        WHERE t.ausgeschieden = false
        GROUP BY m.hersteller
        ORDER BY ekSumme DESC`,
    ]);
    const aufschluesselung = proHersteller.map((r) => ({ hersteller: r.hersteller, ekSumme: num(r.ekSumme) }));
    const zugeordnet = aufschluesselung.reduce((s, r) => s + r.ekSumme, 0);
    const ohneZuordnung = Math.max(0, gesamt - zugeordnet);
    if (ohneZuordnung > 0.005) aufschluesselung.push({ hersteller: "Ohne Zuordnung", ekSumme: ohneZuordnung });
    return { gesamt, proHersteller: aufschluesselung };
  }),

  // Ausgeschiedene (ausgelieferte/gebrauchte) Teile — Gesamtzahl seit Tracking-Beginn,
  // je Teiltyp und je Modell (Top-N). KEIN Zeitverlauf, sondern kumulierte Mengen.
  statAusgeschieden: view
    .input(z.object({ limit: z.number().int().min(1).max(50).default(10) }).optional())
    .query(async ({ input }) => {
      const limit = input?.limit ?? 10;
      const [gesamt, teiltypRows, modellRows] = await Promise.all([
        prisma.mobilTeil.count({ where: { ausgeschieden: true } }),
        prisma.$queryRaw<Array<{ teiltyp: string; anzahl: bigint }>>`
          SELECT tt.name AS teiltyp, COUNT(*) AS anzahl
          FROM \`MobilTeil\` t
          JOIN \`MobilTeiltyp\` tt ON tt.id = t.teiltypId
          WHERE t.ausgeschieden = true
          GROUP BY tt.name`,
        prisma.$queryRaw<Array<{ hersteller: string; modell: string; anzahl: bigint }>>`
          SELECT m.hersteller AS hersteller, m.modell AS modell, COUNT(*) AS anzahl
          FROM \`MobilTeil\` t
          JOIN \`MobilModell\` m ON m.id = t.modellId
          WHERE t.ausgeschieden = true
          GROUP BY m.hersteller, m.modell
          ORDER BY anzahl DESC
          LIMIT ${limit}`,
      ]);
      const jeTeiltyp = teiltypRows
        .map((r) => ({ teiltyp: r.teiltyp, anzahl: num(r.anzahl) }))
        .sort((a, b) => teiltypRang(a.teiltyp) - teiltypRang(b.teiltyp) || a.teiltyp.localeCompare(b.teiltyp, "de"));
      const jeModell = modellRows.map((r) => ({ hersteller: r.hersteller, modell: r.modell, anzahl: num(r.anzahl) }));
      return { gesamt, jeTeiltyp, jeModell };
    }),

  // Gruppen unter Mindestbestand — bündelt die bestehende Logik (Wiederverwendung).
  statUnterMindestbestand: view.query(() => ladeUnterMindestbestand()),

  // Bestandsverlauf über Import-Zeitpunkte. Quelle: die zuletztGesehenImport-Marker
  // (es gibt keine separate Import-Lauf-Historie). Je distinktem Import-Zeitstempel
  // die Anzahl Teile, deren LETZTE Sichtung dieser Import war — der jüngste Punkt
  // entspricht damit dem aktuellen aktiven Bestand. Die Historie baut sich erst über
  // kommende Importe auf: bei < 2 Zeitpunkten genugDaten=false + leeres Array, damit
  // die UI den Hinweis statt eines kaputten Diagramms zeigt.
  statVerlauf: view.query(async () => {
    const rows = await prisma.$queryRaw<Array<{ zeitpunkt: Date; anzahl: bigint }>>`
      SELECT zuletztGesehenImport AS zeitpunkt, COUNT(*) AS anzahl
      FROM \`MobilTeil\`
      WHERE zuletztGesehenImport IS NOT NULL
      GROUP BY zuletztGesehenImport
      ORDER BY zuletztGesehenImport ASC`;
    const punkte = rows.map((r) => ({ zeitpunkt: r.zeitpunkt, erfasst: num(r.anzahl) }));
    return { genugDaten: punkte.length >= 2, zeitpunkte: punkte.length, punkte };
  }),
});
