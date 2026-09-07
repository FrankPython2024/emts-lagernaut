// Client-seitiger CSV-Import für die Technik-Rückläufer (mobiler Lagerwagen).
//
// Gleiches Grundgerüst wie `csvImport.ts`, liest aber zusätzlich die beiden
// Spalten, nach denen aufgeteilt wird: „Zustand aktuell" und
// „AfB-Prozessorgeneration".
//
// ⚠️ Der ReForm-Export enthält ZEILENUMBRÜCHE INNERHALB von Feldern — die
// Spalte „Bemerkung" trägt mehrzeilige Fehlerbeschreibungen. Wer die Datei
// zeilenweise liest, zerreißt genau diese Datensätze und bekommt Bruchstücke in
// die LogID-Spalte. Im Export vom 07.09.2026 waren das 2 von 62 Geräten, und
// eine naive Zählung meldete 64 statt 62. papaparse behandelt das korrekt —
// deshalb hier kein selbstgebauter Parser.

import Papa from "papaparse";
import { normalizeLogId } from "@/lib/pickup/logId";
import type { TechnikZeile } from "@/lib/pickup/technikGruppen";

export type TechnikImportResult = {
  zeilen:     TechnikZeile[];
  total:      number; // übernommene Zeilen (nach Dedupe)
  skipped:    number; // Zeilen ohne LogId
  duplicates: number; // entfernte Duplikate (gleicher normalisierter LogId)
  /** Spalten, die nicht gefunden wurden — Hinweis auf das falsche Export-Format. */
  fehlendeSpalten: string[];
};

/**
 * Header case-insensitiv und getrimmt suchen.
 *
 * ⚠️ Nur EXAKTE Treffer. Der „enthält"-Rückfall aus `csvImport.ts` wäre hier
 * gefährlich: Der Export hat sowohl „Zustand getestet" als auch „Zustand
 * aktuell". Ein unscharfer Treffer auf „Zustand" würde die falsche Spalte
 * erwischen — und zwar still, mit plausibel aussehendem Ergebnis.
 */
function findeSpalte(fields: string[], name: string): string | null {
  const ziel = name.trim().toLowerCase();
  return fields.find((f) => f.trim().toLowerCase() === ziel) ?? null;
}

function sauber(v: string | undefined): string | null {
  const t = (v ?? "").trim();
  return t.length ? t : null;
}

export const SPALTE_LOGID      = "LogId";
export const SPALTE_ZUSTAND    = "Zustand aktuell";
export const SPALTE_GENERATION = "AfB-Prozessorgeneration";

export function parseTechnikCsv(file: File): Promise<TechnikImportResult> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header:         true,
      skipEmptyLines: true,
      delimiter:      ";",
      complete(res) {
        const fields = res.meta.fields ?? [];
        const hLog   = findeSpalte(fields, SPALTE_LOGID);
        const hZus   = findeSpalte(fields, SPALTE_ZUSTAND);
        const hGen   = findeSpalte(fields, SPALTE_GENERATION);
        const hColli = findeSpalte(fields, "Colli");
        const hStell = findeSpalte(fields, "Stellplatz");
        const hBez   = findeSpalte(fields, "Bezeichnung");

        // Ohne diese drei ist die Datei nicht der erwartete Export. Die Meldung
        // nennt die Spalte beim Namen, damit man nicht raten muss.
        const fehlendeSpalten = [
          hLog ? null : SPALTE_LOGID,
          hZus ? null : SPALTE_ZUSTAND,
          hGen ? null : SPALTE_GENERATION,
        ].filter((s): s is string => s !== null);

        const seen = new Set<string>();
        const zeilen: TechnikZeile[] = [];
        let skipped = 0;
        let duplicates = 0;

        for (const row of res.data) {
          const logId = hLog ? normalizeLogId(row[hLog] ?? "") : "";
          if (!logId)          { skipped++;    continue; }
          if (seen.has(logId)) { duplicates++; continue; }
          seen.add(logId);
          zeilen.push({
            logId,
            colli:       hColli ? sauber(row[hColli]) : null,
            stellplatz:  hStell ? sauber(row[hStell]) : null,
            bezeichnung: hBez   ? sauber(row[hBez])   : null,
            zustand:     hZus   ? sauber(row[hZus])   : null,
            generation:  hGen   ? sauber(row[hGen])   : null,
          });
        }

        resolve({ zeilen, total: zeilen.length, skipped, duplicates, fehlendeSpalten });
      },
      error(err) { reject(err); },
    });
  });
}
