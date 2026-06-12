// Geräte-Reise — Import-Job-Logik.
//
// Streamt eine hochgeladene ReForm-CSV (papaparse + Node-Stream, kein Voll-Load),
// pflegt je LogID den aktuellen Stand (LogIdStand, Upsert) und schreibt ab dem
// 2. Import Änderungen als LogIdBewegung. Reine Auswertung — KEIN Bestandseffekt.
//
// Performance: Zeilen werden in Chunks gesammelt und gebündelt geschrieben
// (createMany für neue, eine updateMany für „zuletzt gesehen", Einzel-Updates
// nur für tatsächlich geänderte Zeilen) — KEINE 132k einzelnen awaits.

import fs from "fs";
import Papa from "papaparse";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/core/db/prisma";
import {
  mappeZeile,
  feldGleich,
  darstellen,
  STAND_FELDER,
  SCHLUESSEL_FELDER,
  type GemappteZeile,
} from "./mapping";

const CHUNK_GROESSE = 1_000;

export async function runLogIdImport(tmpPath: string, importId: number): Promise<void> {
  try {
    const imp = await prisma.logIdImport.findUnique({ where: { id: importId } });
    const importiertAm = imp?.importiertAm ?? new Date();

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
        const geaendert = STAND_FELDER.some((k) => !feldGleich(ex[k as keyof typeof ex], felder[k]));
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
    {
      // 1) Je Abgang eine Bewegung schreiben — VOR dem Flag-Update (liest den
      //    letzten Verbleib + ausgeschieden=false). „von" = letzter Verbleib bzw.
      //    „im System", „nach" = „ausgeschieden".
      await prisma.$executeRaw`
        INSERT INTO \`LogIdBewegung\` (logId, feld, vonWert, nachWert, zeitpunkt, bearbeiter, importId, createdAt)
        SELECT logId, 'ausgeschieden', COALESCE(NULLIF(verbleib, ''), 'im System'), 'ausgeschieden', ${importiertAm}, NULL, ${importId}, NOW()
        FROM \`LogIdStand\`
        WHERE zuletztImportId < ${importId} AND ausgeschieden = false`;

      // 2) Flag setzen.
      const abgang = await prisma.logIdStand.updateMany({
        where: { zuletztImportId: { lt: importId }, ausgeschieden: false },
        data:  { ausgeschieden: true, ausgeschiedenAm: importiertAm },
      });
      anzahlAusgeschieden = abgang.count;
      bewegungen += abgang.count;

      // 3) Wieder aufgetauchte Geräte (in DIESEM Import gesehen) zurücksetzen.
      await prisma.logIdStand.updateMany({
        where: { zuletztImportId: importId, ausgeschieden: true },
        data:  { ausgeschieden: false, ausgeschiedenAm: null },
      });
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
