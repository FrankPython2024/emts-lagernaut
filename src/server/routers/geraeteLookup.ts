import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { BuchungsTyp } from "@prisma/client";
import { createTRPCRouter, protectedProcedure, adminProcedure } from "@/server/trpc";
import { prisma }                    from "@/core/db/prisma";
import { normalizeLogId, logIdClean } from "@/lib/format/logId";
import { queues }                    from "@/modules/jobs/worker";
import { STANDARD_TEILTYPEN }        from "@/lib/constants/teiltypen";
import { normalisiereHersteller,
         ERLAUBTE_HERSTELLER_LISTE } from "@/lib/geraete/herstellerFilter";
import { bereinigeBezeichnung }      from "@/lib/geraete/bezeichnungBereinigen";
import type { SessionUser }          from "@/core/types";

function logIdNormalize(logId: string): string {
  return logId.replace(/\./g, "").trim();
}

// Hersteller aus bereinigt-Feld extrahieren (erstes Wort)
function extractHersteller(bereinigt: string): string {
  return bereinigt.split(" ")[0] ?? "";
}

export const geraeteLookupRouter = createTRPCRouter({

  // Gerät per LogID suchen — für Techniker-Portal
  byLogId: protectedProcedure
    .input(z.object({ logId: z.string().min(1) }))
    .query(async ({ input }) => {
      const clean = logIdNormalize(input.logId);

      // Exakter Match auf logId ODER logIdClean
      const eintrag = await prisma.geraeteLookup.findFirst({
        where: {
          OR: [
            { logId:      input.logId },
            { logIdClean: clean },
          ],
        },
      });

      if (!eintrag) return { gefunden: false as const };

      return {
        gefunden:    true as const,
        logId:       eintrag.logId,
        bereinigt:   eintrag.bereinigt,
        hersteller:  extractHersteller(eintrag.bereinigt),
      };
    }),

  /**
   * Geräteakte zu einer LogID — beide Richtungen der Teile-Kette.
   *
   * ⚠️ Die beiden Richtungen sind UNTERSCHIEDLICH verlässlich, und das muss im
   * UI sichtbar bleiben:
   *
   *   `verbaut`  — belegt. Ein Techniker hat für GENAU dieses Gerät ein Teil
   *                angefragt, und darauf gibt es eine Ausgabe-Buchung. Die
   *                Verbindung ist seit `Buchung.anfrageId` hart gespeichert.
   *
   *   `geerntet` — belegt. EINGANG-Buchungen mit diesem Gerät als Spender.
   *
   *   `moeglicheZiele` — NUR KANDIDATEN, kein Beleg. Ein geerntetes Teil geht in
   *                den Bestand seines Artikels und ist dort von jedem anderen
   *                Stück desselben Artikels nicht mehr unterscheidbar. Wir können
   *                deshalb nur sagen: „Aus diesem Spender kamen Teile auf Artikel
   *                X, und Artikel X ging danach an diese Geräte." Wer daraus einen
   *                Einzelnachweis macht, behauptet mehr, als die Daten hergeben.
   *                Zeitfilter ab der ersten Ernte, damit wenigstens Ausgaben VOR
   *                der Einlagerung nicht als mögliches Ziel erscheinen.
   */
  akte: protectedProcedure
    .input(z.object({ logId: z.string().trim().min(1).max(60) }))
    .query(async ({ input }) => {
      // Mit und ohne Punkte suchen: der Handscanner liefert „212965142",
      // gespeichert ist meist „212.965.142".
      const varianten = [...new Set([
        input.logId.trim(),
        normalizeLogId(input.logId),
        logIdClean(input.logId),
      ])].filter((v) => v.length > 0);

      // ── Richtung A: Was wurde in dieses Gerät eingebaut? ────────────────────
      // Test-Anfragen bleiben draußen — sie erzeugen keine echte Ausgabe.
      const anfragen = await prisma.anfrage.findMany({
        where:  { logId: { in: varianten }, testModus: false },
        select: {
          id: true, datum: true, techniker: true, teil: true, menge: true,
          geraeteName: true, istSonderAnfrage: true, status: true,
          buchungen: {
            select: {
              id: true, datum: true, typ: true, menge: true, bezeichnung: true,
              mitarbeiter: true, herkunftLogId: true,
              artikel: {
                select: {
                  id: true, kategorie: true,
                  teilenummer: { select: { nummer: true } },
                },
              },
            },
            orderBy: { datum: "asc" },
          },
        },
        orderBy: { datum: "desc" },
        take:    200,
      });

      const verbaut = anfragen.flatMap((a) =>
        a.buchungen.map((b) => ({
          buchungId:   b.id,
          datum:       b.datum,
          typ:         b.typ,
          menge:       b.menge,
          bezeichnung: b.bezeichnung,
          kategorie:   b.artikel?.kategorie ?? null,
          teilenummer: b.artikel?.teilenummer?.nummer ?? null,
          ausgegebenVon: b.mitarbeiter,
          spenderLogId:  b.herkunftLogId,
          anfrageId:   a.id,
          techniker:   a.techniker,
          angefragtAm: a.datum,
        })),
      ).sort((x, y) => y.datum.getTime() - x.datum.getTime());

      // Anfragen ohne Buchung: angefragt, aber nie ein Teil bekommen. Gehört in
      // die Akte — „nichts eingebaut" ist auch eine Aussage über das Gerät.
      const offen = anfragen
        .filter((a) => a.buchungen.length === 0)
        .map((a) => ({
          anfrageId: a.id, datum: a.datum, teil: a.teil, menge: a.menge,
          techniker: a.techniker, status: a.status, istSonderAnfrage: a.istSonderAnfrage,
        }));

      // ── Richtung B: Was wurde aus diesem Gerät geerntet? ────────────────────
      const geerntet = await prisma.buchung.findMany({
        where:  { typ: BuchungsTyp.EINGANG, herkunftLogId: { in: varianten } },
        select: {
          id: true, datum: true, bezeichnung: true, menge: true,
          mitarbeiter: true, artikelId: true, herkunftArt: true,
          artikel: { select: { kategorie: true } },
        },
        orderBy: { datum: "desc" },
        take:    200,
      });

      // ── Richtung B2: Wohin KÖNNTEN diese Teile gegangen sein? ───────────────
      let moeglicheZiele: {
        datum: Date; bezeichnung: string; menge: number;
        zielLogId: string; zielGeraet: string | null; techniker: string; anfrageId: number;
      }[] = [];

      if (geerntet.length > 0) {
        const artikelIds = [...new Set(geerntet.map((g) => g.artikelId))];
        const abErnte    = geerntet.reduce(
          (min, g) => (g.datum < min ? g.datum : min),
          geerntet[0]!.datum,
        );

        const ausgaben = await prisma.buchung.findMany({
          where: {
            artikelId: { in: artikelIds },
            typ:       { in: [BuchungsTyp.AUSGANG, BuchungsTyp.DIREKT] },
            anfrageId: { not: null },
            datum:     { gte: abErnte },
          },
          select: {
            datum: true, bezeichnung: true, menge: true,
            anfrage: { select: { id: true, logId: true, geraeteName: true, techniker: true } },
          },
          orderBy: { datum: "desc" },
          take:    200,
        });

        moeglicheZiele = ausgaben
          .filter((b) => b.anfrage !== null && !varianten.includes(b.anfrage.logId))
          .map((b) => ({
            datum:       b.datum,
            bezeichnung: b.bezeichnung,
            menge:       b.menge,
            zielLogId:   b.anfrage!.logId,
            zielGeraet:  b.anfrage!.geraeteName,
            techniker:   b.anfrage!.techniker,
            anfrageId:   b.anfrage!.id,
          }));
      }

      return {
        verbaut,
        offen,
        geerntet: geerntet.map((g) => ({
          buchungId:   g.id,
          datum:       g.datum,
          bezeichnung: g.bezeichnung,
          kategorie:   g.artikel?.kategorie ?? null,
          menge:       g.menge,
          erfasstVon:  g.mitarbeiter,
          herkunftArt: g.herkunftArt,
        })),
        moeglicheZiele,
      };
    }),

  // Chunk-Import für Admin-Upload (papaparse im Browser)
  importChunk: adminProcedure
    .input(z.object({
      rows: z.array(z.object({
        logId:       z.string(),
        hersteller:  z.string(),
        bezeichnung: z.string(),
      })).max(500),
    }))
    .mutation(async ({ input }) => {
      let imported = 0;
      let updated  = 0;
      let skipped  = 0;
      let errors   = 0;
      const herstellerStats: Record<string, number> = {};

      for (const row of input.rows) {
        try {
          const logId      = row.logId.trim();
          const herstellerRaw = row.hersteller.trim();
          const bezRaw     = row.bezeichnung.trim();

          if (!logId || !bezRaw) { skipped++; continue; }

          // Hersteller-Filter: nur HP, Lenovo, Dell, Fujitsu
          const normHersteller = normalisiereHersteller(herstellerRaw);
          if (!normHersteller) { skipped++; continue; }

          // Neue Bereinigungslogik (behebt "Dell Precision 7530" → "Precision")
          const logIdClean = logIdNormalize(logId);
          const cleanModel = bereinigeBezeichnung(normHersteller, bezRaw);
          const bereinigt  = `${normHersteller} ${cleanModel}`;

          const existing = await prisma.geraeteLookup.findUnique({ where: { logId } });

          if (existing) {
            await prisma.geraeteLookup.update({
              where: { logId },
              data:  { logIdClean, bezeichnung: bezRaw, bereinigt },
            });
            updated++;
          } else {
            await prisma.geraeteLookup.create({
              data: { logId, logIdClean, bezeichnung: bezRaw, bereinigt },
            });
            imported++;
          }

          herstellerStats[normHersteller] = (herstellerStats[normHersteller] ?? 0) + 1;
        } catch {
          errors++;
        }
      }

      return { imported, updated, skipped, errors, herstellerStats };
    }),

  // Statistik für Admin-Dashboard
  getStats: adminProcedure
    .query(async () => {
      const [total, letzter] = await Promise.all([
        prisma.geraeteLookup.count(),
        prisma.geraeteLookup.findFirst({
          orderBy: { updatedAt: "desc" },
          select:  { updatedAt: true },
        }),
      ]);
      return { total, letzterImport: letzter?.updatedAt ?? null };
    }),

  // ── Reprocess: Analyse + Job ──────────────────────────────────────────────

  // Hersteller-Statistik der aktuellen DB
  getHerstellerStatistik: adminProcedure
    .query(async () => {
      const alle = await prisma.geraeteLookup.findMany({
        select: { bereinigt: true },
      });
      const counts: Record<string, number> = {};
      for (const { bereinigt } of alle) {
        const h = extractHersteller(bereinigt);
        counts[h] = (counts[h] ?? 0) + 1;
      }
      const erlaubt: Record<string, number>   = {};
      const verboten: Record<string, number>  = {};
      for (const [h, n] of Object.entries(counts)) {
        const norm = normalisiereHersteller(h);
        if (norm) erlaubt[norm]  = (erlaubt[norm]  ?? 0) + n;
        else      verboten[h]    = (verboten[h]     ?? 0) + n;
      }
      return {
        total:         alle.length,
        erlaubt,
        verboten,
        erlaubteGesamt: Object.values(erlaubt).reduce((s, v) => s + v, 0),
        verboteneGesamt: Object.values(verboten).reduce((s, v) => s + v, 0),
      };
    }),

  // Dry-Run: Was würde Reprocess ändern/löschen?
  analysiereBestehendeGeraete: adminProcedure
    .query(async () => {
      const alle = await prisma.geraeteLookup.findMany({
        select: { id: true, bereinigt: true, bezeichnung: true },
      });
      let zuUpdaten  = 0;
      let zuLoeschen = 0;
      let unveraendert = 0;
      const zuLoeschenPerHersteller: Record<string, number> = {};

      for (const g of alle) {
        const rawH  = extractHersteller(g.bereinigt);
        const normH = normalisiereHersteller(rawH);
        if (!normH) {
          zuLoeschen++;
          zuLoeschenPerHersteller[rawH] = (zuLoeschenPerHersteller[rawH] ?? 0) + 1;
          continue;
        }
        const clean = bereinigeBezeichnung(normH, g.bezeichnung);
        const neues = `${normH} ${clean}`;
        if (normH !== rawH || neues !== g.bereinigt) zuUpdaten++;
        else unveraendert++;
      }

      return {
        total: alle.length, zuUpdaten, zuLoeschen, unveraendert,
        zuLoeschenPerHersteller,
        erlaubteHersteller: ERLAUBTE_HERSTELLER_LISTE,
      };
    }),

  // Reprocess starten (BullMQ)
  startReprocessGeraete: adminProcedure
    .mutation(async ({ ctx }) => {
      const user = ctx.session!.user as SessionUser;
      const aktive = await queues.reprocessGeraete.getJobs(["active", "waiting"]);
      if (aktive.length > 0) {
        throw new TRPCError({ code: "CONFLICT", message: "Reprocess läuft bereits." });
      }
      const job = await queues.reprocessGeraete.add(
        "reprocess",
        { initiatedBy: user.kuerzel },
        { removeOnComplete: false, removeOnFail: false, attempts: 1 },
      );
      return { jobId: job.id! };
    }),

  // Reprocess Job-Status
  getReprocessStatus: adminProcedure
    .input(z.object({ jobId: z.string().min(1) }))
    .query(async ({ input }) => {
      const job = await queues.reprocessGeraete.getJob(input.jobId);
      if (!job) return null;
      const state    = await job.getState();
      const progress = job.progress as Record<string, unknown> | null;
      return {
        state,
        progress,
        result:       (job.returnvalue ?? null) as { updates: number; deletes: number; finalCount: number } | null,
        failedReason: job.failedReason ?? null,
      };
    }),

  // ── Artikel-Generator ──────────────────────────────────────────────────────

  // Vorschau: Modell-Anzahl + bereits existierende Artikel
  getArtikelGeneratorPreview: adminProcedure
    .query(async () => {
      const [lookups, existingArtikel] = await Promise.all([
        prisma.geraeteLookup.findMany({
          where:    { bereinigt: { not: "" } },
          select:   { bereinigt: true },
          distinct: ["bereinigt"],
        }),
        prisma.artikel.count(),
      ]);
      return {
        modelle:        lookups.length,
        existingArtikel,
        teile:          STANDARD_TEILTYPEN.length,
        erwartet:       lookups.length * STANDARD_TEILTYPEN.length,
      };
    }),

  // Generator starten — BullMQ Job einreihen
  generiereArtikelFuerAlleModelle: adminProcedure
    .mutation(async ({ ctx }) => {
      const user = ctx.session!.user as SessionUser;

      // Bereits laufenden Job prüfen
      const aktive = await queues.artikelGenerator.getJobs(["active", "waiting"]);
      if (aktive.length > 0) {
        throw new TRPCError({ code: "CONFLICT", message: "Artikel-Generator läuft bereits." });
      }

      const lookups = await prisma.geraeteLookup.findMany({
        where:    { bereinigt: { not: "" } },
        select:   { bereinigt: true },
        distinct: ["bereinigt"],
      });
      const modelle  = lookups.length;
      const teile    = STANDARD_TEILTYPEN.length;
      const erwartet = modelle * teile;

      const job = await queues.artikelGenerator.add(
        "generate-alle",
        { initiatedBy: user.kuerzel },
        { removeOnComplete: false, removeOnFail: false, attempts: 1 },
      );

      console.log(`[ArtikelGen] Job #${job.id} gestartet von ${user.kuerzel} — ${modelle} Modelle × ${teile} Teile`);
      return { jobId: job.id!, modelle, teile, erwartet };
    }),

  // Job-Status (für UI-Polling alle 2 Sekunden)
  getArtikelGeneratorStatus: adminProcedure
    .input(z.object({ jobId: z.string().min(1) }))
    .query(async ({ input }) => {
      const job = await queues.artikelGenerator.getJob(input.jobId);
      if (!job) return null;

      const state    = await job.getState();
      const progress = job.progress as Record<string, unknown> | number | null;

      return {
        state,
        progress,
        result:       (job.returnvalue ?? null) as {
          totalModels: number; artikelCreated: number; artikelSkipped: number
        } | null,
        failedReason: job.failedReason ?? null,
      };
    }),

});
