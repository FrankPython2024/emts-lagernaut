// Client-seitiger CSV-Parser fürs Pickup-Modul. Nutzt papaparse (bereits im
// Projekt, robust: Quotes, ";"-Trenner, BOM, CRLF). AfB-Geräte-Export-Format.

import Papa from "papaparse";
import { normalizeLogId } from "@/lib/pickup/logId";

export type PickupImportPosition = {
  logId:       string;        // normalisiert (reine Ziffern)
  colli:       string | null; // Roh-String (z.B. "3.175.257") — zum Gruppieren
  stellplatz:  string | null;
  bezeichnung: string | null;
};

export type PickupImportResult = {
  positionen: PickupImportPosition[];
  total:      number; // erkannte Positionen (nach Dedupe)
  skipped:    number; // Zeilen ohne LogId
  duplicates: number; // entfernte Duplikate (gleicher normalisierter LogId)
};

// Header case-insensitive + getrimmt matchen: exakter Name zuerst, sonst
// "enthält"-Fallback. Gibt den tatsächlichen Header-Key zurück (oder null).
function findHeader(fields: string[], name: string): string | null {
  const target = name.trim().toLowerCase();
  const exact = fields.find((f) => f.trim().toLowerCase() === target);
  if (exact) return exact;
  const contains = fields.find((f) => f.trim().toLowerCase().includes(target));
  return contains ?? null;
}

function clean(v: string | undefined): string | null {
  const t = (v ?? "").trim();
  return t.length ? t : null;
}

export function parsePickupCsv(file: File): Promise<PickupImportResult> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header:         true,
      skipEmptyLines: true,
      delimiter:      ";",
      complete(res) {
        const fields = res.meta.fields ?? [];
        const hLog   = findHeader(fields, "LogId");
        const hColli = findHeader(fields, "Colli");
        const hStell = findHeader(fields, "Stellplatz");
        const hBez   = findHeader(fields, "Bezeichnung");

        const seen = new Set<string>();
        const positionen: PickupImportPosition[] = [];
        let skipped    = 0;
        let duplicates = 0;

        for (const row of res.data) {
          const logId = hLog ? normalizeLogId(row[hLog]) : "";
          if (!logId)          { skipped++;    continue; } // Zeile ohne LogId
          if (seen.has(logId)) { duplicates++; continue; } // Duplikat
          seen.add(logId);
          positionen.push({
            logId,
            colli:       hColli ? clean(row[hColli]) : null,
            stellplatz:  hStell ? clean(row[hStell]) : null,
            bezeichnung: hBez   ? clean(row[hBez])   : null,
          });
        }

        resolve({ positionen, total: positionen.length, skipped, duplicates });
      },
      error(err) { reject(err); },
    });
  });
}
