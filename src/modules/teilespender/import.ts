// Verwertungs-Export → VerwertungsGeraet (Import-Job).
//
// Streamt die hochgeladene CSV (papaparse + Node-Stream, kein Voll-Load) und
// führt einen Voll-Snapshot mit Abgangs-Erkennung: Was in dieser Datei fehlt,
// hat das Verwertungslager verlassen (verkauft, verschrottet, umgebucht) und
// erscheint in der Teilesuche nicht mehr.
//
// ⚠️ KEIN Bestandseffekt. Diese Geräte zählen auf keinen Artikel ein — Bestand
// entsteht erst, wenn ein Teil tatsächlich ausgebaut und eingelagert wird.

import fs from "fs";
import Papa from "papaparse";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/core/db/prisma";
import { bewerte, zerlegeDefekte } from "@/lib/teilespender/defekte";
import {
  mappeSpenderZeile,
  fehlendeSpalten,
  feldGleich,
  SPENDER_FELDER,
  type GemappteSpenderZeile,
  type SpenderFelder,
} from "./mapping";

const CHUNK_GROESSE = 1_000;

/**
 * Untergrenze für die Abgangs-Erkennung.
 *
 * Schutz gegen einen leeren, abgebrochenen oder versehentlich gefilterten
 * Export: Nur wenn dieser Import mindestens die Hälfte des bisherigen Bestands
 * gesehen hat, darf er Geräte ausscheiden. Sonst würde eine halb geladene Datei
 * das ganze Verwertungslager als „weg" markieren — und die Teilesuche fände am
 * nächsten Morgen nichts mehr.
 */
const MIN_SNAPSHOT_ANTEIL = 0.5;

/** Decimal | number | string | null → number (2 NK) | null. */
function ekAlsZahl(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isNaN(n) ? null : Math.round(n * 100) / 100;
}

function spenderFeldGleich(feld: keyof SpenderFelder, a: unknown, b: unknown): boolean {
  if (feld === "ek") return ekAlsZahl(a) === ekAlsZahl(b);
  return feldGleich(a, b);
}

export async function runTeilespenderImport(
  tmpPath: string,
  importId: number,
): Promise<{ zeilen: number }> {
  try {
    const imp = await prisma.verwertungsImport.findUnique({ where: { id: importId } });
    const importiertAm = imp?.importiertAm ?? new Date();

    // ── Durchgang 1: Kopfzeile prüfen, BEVOR irgendetwas geschrieben wird ────
    // Eine umbenannte Spalte liefert sonst überall undefined — der Import liefe
    // sauber durch, und ab da gälte jedes Gerät als defektfrei.
    await pruefeKopfzeile(tmpPath);

    // ── Durchgang 2: schreiben ──────────────────────────────────────────────
    const ergebnis = await schreibeSnapshot(tmpPath, importId, importiertAm);

    await prisma.verwertungsImport.update({
      where: { id: importId },
      data: {
        status: "fertig",
        anzahlZeilen: ergebnis.zeilen,
        anzahlNeu: ergebnis.neu,
        anzahlAktualisiert: ergebnis.aktualisiert,
        anzahlAusgeschieden: ergebnis.ausgeschieden,
        unbekannteBegriffe:
          ergebnis.unbekannt.length > 0 ? ergebnis.unbekannt.join("\n") : null,
      },
    });

    return { zeilen: ergebnis.zeilen };
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    await prisma.verwertungsImport
      .update({ where: { id: importId }, data: { status: "fehler", fehlerText: text } })
      .catch(() => {});
    throw e;
  } finally {
    await fs.promises.unlink(tmpPath).catch(() => {});
  }
}

/** Liest nur die Kopfzeile und wirft, wenn eine Pflichtspalte fehlt. */
async function pruefeKopfzeile(tmpPath: string): Promise<void> {
  const header = await new Promise<string[]>((resolve, reject) => {
    const stream = fs.createReadStream(tmpPath, { encoding: "utf8" });
    let fertig = false;
    Papa.parse<string[]>(stream, {
      delimiter: ";",
      skipEmptyLines: true,
      step: (result, parser) => {
        if (fertig) return;
        fertig = true;
        parser.abort();
        resolve((result.data as string[]).map((h) => h.replace(/^﻿/, "").trim()));
      },
      complete: () => {
        if (!fertig) resolve([]);
      },
      error: (err: Error) => reject(err),
    });
  });

  if (header.length === 0) throw new Error("Die Datei ist leer. Es wurde nichts geschrieben.");

  const fehlt = fehlendeSpalten(header);
  if (fehlt.length > 0) {
    throw new Error(
      `Das sieht nicht nach dem Verwertungs-Export aus — diese Spalten fehlen: ${fehlt.join(", ")}. ` +
        `Es wurde nichts geschrieben. Gebraucht wird der ReForm-Export mit den Spalten „Defekte“ und ` +
        `„Refurbishment nicht möglich“; der reguläre Lagerfuchs-Export gehört auf die Seite „Geräte-Reise“.`,
    );
  }
}

type SnapshotErgebnis = {
  zeilen: number;
  neu: number;
  aktualisiert: number;
  ausgeschieden: number;
  unbekannt: string[];
};

async function schreibeSnapshot(
  tmpPath: string,
  importId: number,
  importiertAm: Date,
): Promise<SnapshotErgebnis> {
  let zeilen = 0;
  let neu = 0;
  let aktualisiert = 0;
  // Defekt-Begriffe, die die Zuordnungstabelle nicht kennt. Sie werden gezählt
  // und im Import-Protokoll gemeldet, statt still zu verschwinden.
  const unbekannt = new Map<string, number>();

  async function verarbeiteChunk(rows: GemappteSpenderZeile[]): Promise<void> {
    zeilen += rows.length;
    if (rows.length === 0) return;

    for (const r of rows) {
      for (const d of zerlegeDefekte(r.felder.defekteRoh)) {
        if (bewerte(d).unbekannt) unbekannt.set(d, (unbekannt.get(d) ?? 0) + 1);
      }
    }

    const ids = rows.map((r) => r.logId);
    const vorhandene = await prisma.verwertungsGeraet.findMany({ where: { logId: { in: ids } } });
    const vorhandenMap = new Map(vorhandene.map((v) => [v.logId, v]));

    const neuData: Prisma.VerwertungsGeraetCreateManyInput[] = [];
    const aenderungen: { logId: string; data: Prisma.VerwertungsGeraetUpdateInput }[] = [];
    const geaenderteIds = new Set<string>();

    for (const { logId, felder } of rows) {
      const ex = vorhandenMap.get(logId);
      if (!ex) {
        neuData.push({
          logId,
          ...felder,
          erstmalsGesehen: importiertAm,
          zuletztGesehen: importiertAm,
          zuletztImportId: importId,
        });
        continue;
      }
      const geaendert = SPENDER_FELDER.some(
        (k) => !spenderFeldGleich(k, ex[k as keyof typeof ex], felder[k]),
      );
      if (geaendert) {
        geaenderteIds.add(logId);
        aenderungen.push({
          logId,
          data: {
            ...felder,
            zuletztGesehen: importiertAm,
            zuletztImportId: importId,
            // Ein Gerät, das wieder auftaucht, ist zurück im Rennen.
            ausgeschieden: false,
            ausgeschiedenAm: null,
          },
        });
      }
    }

    const unveraendertIds = ids.filter((id) => vorhandenMap.has(id) && !geaenderteIds.has(id));

    await prisma.$transaction(
      async (tx) => {
        if (neuData.length > 0) {
          await tx.verwertungsGeraet.createMany({ data: neuData, skipDuplicates: true });
        }
        if (unveraendertIds.length > 0) {
          await tx.verwertungsGeraet.updateMany({
            where: { logId: { in: unveraendertIds } },
            data: {
              zuletztGesehen: importiertAm,
              zuletztImportId: importId,
              ausgeschieden: false,
              ausgeschiedenAm: null,
            },
          });
        }
        for (const a of aenderungen) {
          await tx.verwertungsGeraet.update({ where: { logId: a.logId }, data: a.data });
        }
      },
      { timeout: 120_000 },
    );

    neu += neuData.length;
    aktualisiert += aenderungen.length;

    await prisma.verwertungsImport
      .update({ where: { id: importId }, data: { anzahlZeilen: zeilen } })
      .catch(() => {});
  }

  // ── Streamen ──────────────────────────────────────────────────────────────
  let puffer: GemappteSpenderZeile[] = [];
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(tmpPath, { encoding: "utf8" });
    Papa.parse<Record<string, string>>(stream, {
      header: true,
      delimiter: ";",
      skipEmptyLines: true,
      // UTF-8-BOM am ersten Header entfernen — sonst heißt die erste Spalte
      // "﻿LogId" und JEDE Zeile fällt raus.
      transformHeader: (h: string) => h.replace(/^﻿/, "").trim(),
      step: (result, parser) => {
        const z = mappeSpenderZeile(result.data);
        if (!z) return;
        puffer.push(z);
        if (puffer.length >= CHUNK_GROESSE) {
          const chunk = puffer;
          puffer = [];
          parser.pause();
          verarbeiteChunk(chunk)
            .then(() => parser.resume())
            .catch(reject);
        }
      },
      complete: () => {
        verarbeiteChunk(puffer).then(resolve).catch(reject);
      },
      error: (err: Error) => reject(err),
    });
  });

  // ── Abgangs-Erkennung ─────────────────────────────────────────────────────
  let ausgeschieden = 0;
  const wuerdenAusscheiden = await prisma.verwertungsGeraet.count({
    where: { zuletztImportId: { lt: importId }, ausgeschieden: false },
  });
  const aktivGesamt = zeilen + wuerdenAusscheiden;
  const plausibel = zeilen > 0 && (aktivGesamt === 0 || zeilen >= MIN_SNAPSHOT_ANTEIL * aktivGesamt);

  if (plausibel) {
    const abgang = await prisma.verwertungsGeraet.updateMany({
      where: { zuletztImportId: { lt: importId }, ausgeschieden: false },
      data: { ausgeschieden: true, ausgeschiedenAm: importiertAm },
    });
    ausgeschieden = abgang.count;
  } else if (wuerdenAusscheiden > 0) {
    console.warn(
      `[teilespender] Abgangs-Erkennung ÜBERSPRUNGEN: nur ${zeilen} von ~${aktivGesamt} Geräten im ` +
        `Snapshot (verdächtig klein) — nichts ausgeschieden, Bestand geschützt.`,
    );
  }

  const unbekanntListe = [...unbekannt.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([begriff, anzahl]) => `${anzahl}× ${begriff}`);

  return { zeilen, neu, aktualisiert, ausgeschieden, unbekannt: unbekanntListe };
}
