// Geräte-Reise / Lagerfuchs — Import-Job-Logik.
//
// Streamt eine hochgeladene ReForm-CSV (papaparse + Node-Stream, kein Voll-Load).
// Der Import-Typ wird automatisch erkannt:
//   • LAGERFUCHS — regulärer Voll-Snapshot → LogIdStand (Diff + Bewegungen).
//   • FEHLTEILE  — Liste mit Verbleib="Fehlteile" → eigene Tabelle FehlteilStand
//                  (KEINE Diff-/Bewegungs-Logik, reiner Upsert).
// Reine Auswertung — KEIN Bestandseffekt.

import fs from "fs";
import Papa from "papaparse";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/core/db/prisma";
import {
  mappeZeile,
  mappeFehlteil,
  istFehlteilZeile,
  logIdRoh,
  feldGleich,
  darstellen,
  STAND_FELDER,
  SCHLUESSEL_FELDER,
  type GemappteZeile,
  type GemappteFehlteilZeile,
  type StandFelder,
} from "./mapping";

const CHUNK_GROESSE = 1_000;

// ── Typ-sichere Feld-Gleichheit für die Update-Erkennung ────────────────────────
// Die meisten Felder vergleicht feldGleich generisch. Zwei Felder brauchen eine
// Normalisierung, damit der ERSTE Import nach der Schema-Änderung jede Zeile genau
// einmal aktualisiert (null → Wert), danach aber KEIN Dauer-Churn entsteht:
//   • ek          — DB liefert Prisma.Decimal, CSV ein number → beide auf 2 Nach-
//                    kommastellen normalisieren; null/leer beidseitig = gleich.
//   • lagernummer — String-Vergleich mit null/leer-Normalisierung.

// Decimal | number | string | null → number (2 NK) | null.
function ekAlsZahl(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isNaN(n) ? null : Math.round(n * 100) / 100;
}

// string | null → getrimmt; null/leer → null.
function strNorm(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}

// Feldweise Gleichheit für die Stand-Änderungserkennung (kein Bewegungs-Effekt).
function standFeldGleich(feld: keyof StandFelder, a: unknown, b: unknown): boolean {
  if (feld === "ek")          return ekAlsZahl(a) === ekAlsZahl(b);
  if (feld === "lagernummer") return strNorm(a) === strNorm(b);
  return feldGleich(a, b);
}

// Schwellen für die Typ-Erkennung (Anteil Zeilen mit Verbleib="Fehlteile").
const FEHLTEILE_MIN = 0.95; // ab hier sicher Fehlteile
const LAGERFUCHS_MAX = 0.05; // bis hier sicher Lagerfuchs (regulär: 0)

type Typ = "LAGERFUCHS" | "FEHLTEILE";

// ── Orchestrierung: Typ erkennen → routen ──────────────────────────────────────
export async function runLogIdImport(tmpPath: string, importId: number): Promise<{ typ: Typ; zeilen: number }> {
  try {
    const imp = await prisma.logIdImport.findUnique({ where: { id: importId } });
    const importiertAm = imp?.importiertAm ?? new Date();

    // Pass 1 — Typ autoritativ bestimmen (NICHTS schreiben).
    const { typ } = await erkenneTyp(tmpPath);
    await prisma.logIdImport.update({ where: { id: importId }, data: { typ } });

    if (typ === "FEHLTEILE") {
      const zeilen = await runFehlteilImport(tmpPath, importId, importiertAm);
      await prisma.logIdImport.update({
        where: { id: importId },
        data: {
          status:             "fertig",
          anzahlZeilen:       zeilen,
          verarbeitet:        zeilen,
          anzahlNeu:          0,
          anzahlAktualisiert: 0,
          anzahlBewegungen:   0,
          anzahlAusgeschieden: 0,
        },
      });
      return { typ, zeilen };
    }

    // LAGERFUCHS — bestehende Logik (Diff/Bewegungen), unverändert.
    const zeilen = await runLagerfuchsImport(tmpPath, importId, importiertAm);
    return { typ, zeilen };
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    await prisma.logIdImport
      .update({ where: { id: importId }, data: { status: "fehler", fehlerText: text } })
      .catch(() => {});
    throw e;
  } finally {
    // Temp-Datei in jedem Fall entfernen.
    await fs.promises.unlink(tmpPath).catch(() => {});
  }
}

// ── Typ-Erkennung (Pass 1, rein lesend) ─────────────────────────────────────────
async function erkenneTyp(tmpPath: string): Promise<{ typ: Typ; gesamt: number; anteil: number }> {
  let gesamt = 0;
  let fehlteil = 0;
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(tmpPath, { encoding: "utf8" });
    Papa.parse<Record<string, string>>(stream, {
      header:         true,
      delimiter:      ";",
      skipEmptyLines: true,
      // UTF-8-BOM am ersten Header entfernen — sonst heißt die erste Spalte
      // "﻿LogId", die LogId-Spalte ist unauffindbar und JEDE Zeile fällt raus.
      transformHeader: (h: string) => h.replace(/^﻿/, "").trim(),
      step: (result) => {
        if (!logIdRoh(result.data)) return; // nur echte Datenzeilen
        gesamt += 1;
        if (istFehlteilZeile(result.data)) fehlteil += 1;
      },
      complete: () => resolve(),
      error: (err: Error) => reject(err),
    });
  });

  const anteil = gesamt > 0 ? fehlteil / gesamt : 0;
  if (anteil >= FEHLTEILE_MIN)  return { typ: "FEHLTEILE",  gesamt, anteil };
  if (anteil <= LAGERFUCHS_MAX) return { typ: "LAGERFUCHS", gesamt, anteil };
  throw new Error(
    `Import-Typ nicht eindeutig erkennbar (Fehlteile-Anteil ${Math.round(anteil * 100)} %). ` +
    `Erwartet: regulärer Lagerfuchs-Export (0 %) ODER reine Fehlteile-Liste (100 %). Es wurde nichts geschrieben.`,
  );
}

// ── FEHLTEILE — Upsert in FehlteilStand (keine Diff-/Bewegungs-Logik) ───────────
async function runFehlteilImport(tmpPath: string, importId: number, importiertAm: Date): Promise<number> {
  let zeilen = 0;

  async function verarbeiteChunk(rows: GemappteFehlteilZeile[]): Promise<void> {
    if (rows.length === 0) return;
    const ids = rows.map((r) => r.logId);
    const vorhandene = await prisma.fehlteilStand.findMany({ where: { logId: { in: ids } }, select: { logId: true } });
    const exist = new Set(vorhandene.map((v) => v.logId));

    const neu: Prisma.FehlteilStandCreateManyInput[] = [];
    const updates: { logId: string; data: Prisma.FehlteilStandUpdateInput }[] = [];
    const gesehen = new Set<string>();

    for (const { logId, felder } of rows) {
      if (gesehen.has(logId)) continue; // Doppel in derselben Datei → erster gewinnt
      gesehen.add(logId);
      if (exist.has(logId)) {
        updates.push({ logId, data: { ...felder, zuletztGesehen: importiertAm, zuletztImportId: importId } });
      } else {
        neu.push({ logId, ...felder, zuletztGesehen: importiertAm, zuletztImportId: importId });
      }
    }

    await prisma.$transaction(async (tx) => {
      if (neu.length > 0) await tx.fehlteilStand.createMany({ data: neu, skipDuplicates: true });
      for (const u of updates) await tx.fehlteilStand.update({ where: { logId: u.logId }, data: u.data });
    }, { timeout: 120_000 });

    zeilen += rows.length;
    await prisma.logIdImport.update({ where: { id: importId }, data: { verarbeitet: zeilen } });
  }

  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(tmpPath, { encoding: "utf8" });
    let puffer: GemappteFehlteilZeile[] = [];
    let abgebrochen = false;

    Papa.parse<Record<string, string>>(stream, {
      header:         true,
      delimiter:      ";",
      skipEmptyLines: true,
      // UTF-8-BOM am ersten Header entfernen — sonst heißt die erste Spalte
      // "﻿LogId", die LogId-Spalte ist unauffindbar und JEDE Zeile fällt raus.
      transformHeader: (h: string) => h.replace(/^﻿/, "").trim(),
      step: (result, parser) => {
        const gemappt = mappeFehlteil(result.data);
        if (gemappt) puffer.push(gemappt);
        if (puffer.length >= CHUNK_GROESSE) {
          parser.pause();
          const batch = puffer;
          puffer = [];
          verarbeiteChunk(batch)
            .then(() => { if (!abgebrochen) parser.resume(); })
            .catch((e) => { abgebrochen = true; parser.abort(); reject(e); });
        }
      },
      complete: () => {
        const rest = puffer;
        puffer = [];
        (rest.length > 0 ? verarbeiteChunk(rest) : Promise.resolve())
          .then(() => resolve())
          .catch(reject);
      },
      error: (err: Error) => reject(err),
    });
  });

  return zeilen;
}

// ── LAGERFUCHS — Voll-Snapshot in LogIdStand (Diff + Bewegungen) ────────────────
// Performance: Zeilen werden in Chunks gesammelt und gebündelt geschrieben
// (createMany für neue, eine updateMany für „zuletzt gesehen", Einzel-Updates
// nur für tatsächlich geänderte Zeilen) — KEINE 132k einzelnen awaits.
async function runLagerfuchsImport(tmpPath: string, importId: number, importiertAm: Date): Promise<number> {
  let zeilen = 0;
  let neu = 0;
  let aktualisiert = 0;
  let bewegungen = 0;

  // ── Chunk-Verarbeitung ────────────────────────────────────────────────────
  async function verarbeiteChunk(rows: GemappteZeile[]): Promise<void> {
    zeilen += rows.length;
    if (rows.length === 0) return;

    const ids = rows.map((r) => r.logId);
    const vorhandene = await prisma.logIdStand.findMany({ where: { logId: { in: ids } } });
    const vorhandenMap = new Map(vorhandene.map((v) => [v.logId, v]));

    const neuData:        Prisma.LogIdStandCreateManyInput[]   = [];
    const aenderungen:    { logId: string; data: Prisma.LogIdStandUpdateInput }[] = [];
    const geaenderteIds = new Set<string>();
    const bewegungData:   Prisma.LogIdBewegungCreateManyInput[] = [];

    for (const { logId, felder } of rows) {
      const ex = vorhandenMap.get(logId);

      if (!ex) {
        neuData.push({
          logId, ...felder,
          erstmalsGesehen: importiertAm,
          zuletztGesehen:  importiertAm,
          zuletztImportId: importId,
        });
        continue;
      }

      // Bewegungen für die Schlüsselfelder
      for (const kf of SCHLUESSEL_FELDER) {
        const von  = ex[kf as keyof typeof ex];
        const nach = felder[kf];
        if (!feldGleich(von, nach)) {
          const istVerbleib = kf === "verbleib";
          const zeitpunkt = istVerbleib
            ? (felder.inVerbleibSeit ?? felder.letzteAenderungAm ?? importiertAm)
            : (felder.letzteAenderungAm ?? importiertAm);
          bewegungData.push({
            logId, feld: kf,
            vonWert:    darstellen(von),
            nachWert:   darstellen(nach),
            zeitpunkt,
            bearbeiter: istVerbleib ? (felder.inVerbleibDurch ?? null) : null,
            importId,
          });
        }
      }

      // Stand-Änderung: sobald irgendein gemapptes Feld abweicht, die komplette
      // Feldgruppe aktualisieren (Stand bleibt vollständig aktuell).
      const geaendert = STAND_FELDER.some((k) => !standFeldGleich(k, ex[k as keyof typeof ex], felder[k]));
      if (geaendert) {
        geaenderteIds.add(logId);
        aenderungen.push({
          logId,
          data: { ...felder, zuletztGesehen: importiertAm, zuletztImportId: importId },
        });
      }
    }

    // „zuletzt gesehen" für unveränderte Bestandszeilen — eine einzige Query.
    const unveraendertIds = ids.filter((id) => vorhandenMap.has(id) && !geaenderteIds.has(id));

    await prisma.$transaction(async (tx) => {
      if (neuData.length > 0) {
        await tx.logIdStand.createMany({ data: neuData, skipDuplicates: true });
      }
      if (unveraendertIds.length > 0) {
        await tx.logIdStand.updateMany({
          where: { logId: { in: unveraendertIds } },
          data:  { zuletztGesehen: importiertAm, zuletztImportId: importId },
        });
      }
      for (const a of aenderungen) {
        await tx.logIdStand.update({ where: { logId: a.logId }, data: a.data });
      }
      if (bewegungData.length > 0) {
        await tx.logIdBewegung.createMany({ data: bewegungData });
      }
    }, { timeout: 120_000 });

    neu          += neuData.length;
    aktualisiert += aenderungen.length;
    bewegungen   += bewegungData.length;

    // Fortschritt periodisch festhalten.
    await prisma.logIdImport.update({ where: { id: importId }, data: { verarbeitet: zeilen } });
  }

  // ── Streamendes Parsen ──────────────────────────────────────────────────────
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(tmpPath, { encoding: "utf8" });
    let puffer: GemappteZeile[] = [];
    let abgebrochen = false;

    Papa.parse<Record<string, string>>(stream, {
      header:         true,
      delimiter:      ";",
      skipEmptyLines: true,
      // UTF-8-BOM am ersten Header entfernen — sonst heißt die erste Spalte
      // "﻿LogId", die LogId-Spalte ist unauffindbar und JEDE Zeile fällt raus.
      transformHeader: (h: string) => h.replace(/^﻿/, "").trim(),
      step: (result, parser) => {
        const gemappt = mappeZeile(result.data);
        if (gemappt) puffer.push(gemappt);
        if (puffer.length >= CHUNK_GROESSE) {
          parser.pause();
          const batch = puffer;
          puffer = [];
          verarbeiteChunk(batch)
            .then(() => { if (!abgebrochen) parser.resume(); })
            .catch((e) => { abgebrochen = true; parser.abort(); reject(e); });
        }
      },
      complete: () => {
        const rest = puffer;
        puffer = [];
        (rest.length > 0 ? verarbeiteChunk(rest) : Promise.resolve())
          .then(() => resolve())
          .catch(reject);
      },
      error: (err: Error) => reject(err),
    });
  });

  // ── Abgangs-Erkennung (greift ab dem 2. Import) ──────────────────────────────
  // LogIDs, die in DIESEM Voll-Snapshot fehlen (zuletztImportId < importId) und
  // noch nicht ausgeschieden, haben das System verlassen. Set-basiert.
  let anzahlAusgeschieden = 0;

  // SICHERUNG gegen Total-Ausscheidung durch einen leeren/kaputten/geschrumpften
  // Snapshot (leere Datei, falscher Delimiter, BOM, abgebrochener/gefilterter Export):
  // Nur ausscheiden, wenn dieser Import plausibel viele LogIDs gesehen hat (>= 50 %
  // des bisherigen aktiven Bestands). Sonst wird die Abgangs-Erkennung übersprungen,
  // damit nicht der komplette Bestand faelschlich als „ausgeschieden" markiert wird.
  const wuerdenAusscheiden = await prisma.logIdStand.count({
    where: { zuletztImportId: { lt: importId }, ausgeschieden: false },
  });
  const aktivGesamt = zeilen + wuerdenAusscheiden;
  const snapshotPlausibel = zeilen > 0 && (aktivGesamt === 0 || zeilen >= 0.5 * aktivGesamt);

  if (snapshotPlausibel) {
    // Alle vier Schritte in EINER Transaktion: sonst kann ein Abbruch zwischen
    // Bewegungs-INSERT und Flag-Update einen halben Zustand hinterlassen
    // (Bewegung geschrieben, Gerät aber noch „im System" — oder umgekehrt).
    const [, abgang] = await prisma.$transaction([
      // 1) Je Abgang eine Bewegung schreiben — VOR dem Flag-Update (liest den
      //    letzten Verbleib + ausgeschieden=false). „von" = letzter Verbleib bzw.
      //    „im System", „nach" = „ausgeschieden".
      prisma.$executeRaw`
        INSERT INTO \`LogIdBewegung\` (logId, feld, vonWert, nachWert, zeitpunkt, bearbeiter, importId, createdAt)
        SELECT logId, 'ausgeschieden', COALESCE(NULLIF(verbleib, ''), 'im System'), 'ausgeschieden', ${importiertAm}, NULL, ${importId}, NOW()
        FROM \`LogIdStand\`
        WHERE zuletztImportId < ${importId} AND ausgeschieden = false`,

      // 2) Flag setzen.
      prisma.logIdStand.updateMany({
        where: { zuletztImportId: { lt: importId }, ausgeschieden: false },
        data:  { ausgeschieden: true, ausgeschiedenAm: importiertAm },
      }),

      // 3) Wieder-Eingang ebenfalls als Bewegung protokollieren — VOR dem Reset,
      //    sonst fehlt die Rückkehr in der Geräte-Historie komplett.
      prisma.$executeRaw`
        INSERT INTO \`LogIdBewegung\` (logId, feld, vonWert, nachWert, zeitpunkt, bearbeiter, importId, createdAt)
        SELECT logId, 'ausgeschieden', 'ausgeschieden', COALESCE(NULLIF(verbleib, ''), 'im System'), ${importiertAm}, NULL, ${importId}, NOW()
        FROM \`LogIdStand\`
        WHERE zuletztImportId = ${importId} AND ausgeschieden = true`,

      // 4) Wieder aufgetauchte Geräte (in DIESEM Import gesehen) zurücksetzen.
      prisma.logIdStand.updateMany({
        where: { zuletztImportId: importId, ausgeschieden: true },
        data:  { ausgeschieden: false, ausgeschiedenAm: null },
      }),
    ]);
    anzahlAusgeschieden = abgang.count;
    bewegungen += abgang.count;
  } else if (wuerdenAusscheiden > 0) {
    console.warn(`[geraete-reise] Abgangs-Erkennung ÜBERSPRUNGEN: nur ${zeilen} von ~${aktivGesamt} LogIDs im Snapshot (verdaechtig klein/leer) — kein Ausscheiden, Bestand geschuetzt.`);
  }

  await prisma.logIdImport.update({
    where: { id: importId },
    data: {
      status:              "fertig",
      anzahlZeilen:        zeilen,
      anzahlNeu:           neu,
      anzahlAktualisiert:  aktualisiert,
      anzahlBewegungen:    bewegungen,
      anzahlAusgeschieden,
      verarbeitet:         zeilen,
    },
  });

  return zeilen;
}
