// Client-seitiges Parsen der ReForm-"Stellplatz"-Übersicht (mobile Lagerwagen).
// Akzeptiert .xlsx (SheetJS, Sheet "Stellplatz") und .csv (papaparse, ";").
// Liefert normalisierte Untercolli→Hauptcolli-Zuordnungen + Statistik für die
// Vorschau. Das eigentliche Schreiben passiert serverseitig (tRPC), das hier ist
// reine Vorbereitung — KEIN DB, KEIN Bestandseffekt.

import Papa from "papaparse";
import { nurZiffern } from "@/lib/format/ziffern";

export type LagerwagenZeile = {
  untercolli:  string;        // normalisiert (nurZiffern), z.B. "2237208"
  hauptcolli:  string;        // normalisiert (nurZiffern), z.B. "2237000"
  stellplatz:  string | null;
  lagernummer: string | null;
};

export type LagerwagenImportResult = {
  zeilen:      LagerwagenZeile[]; // dedupliziert nach untercolli
  wagen:       number;            // distinct hauptcolli
  untercollis: number;            // = zeilen.length
  skipped:     number;            // Zeilen ohne Nummer/Hauptcolli
  duplicates:  number;            // doppelte Untercollis entfernt
};

const SHEET_NAME = "Stellplatz";

// Header case-insensitive matchen: exakt zuerst, sonst "enthält"-Fallback.
function findHeader(fields: string[], name: string): string | null {
  const target = name.trim().toLowerCase();
  const exact = fields.find((f) => f.trim().toLowerCase() === target);
  if (exact) return exact;
  const contains = fields.find((f) => f.trim().toLowerCase().includes(target));
  return contains ?? null;
}

function clean(v: unknown): string | null {
  const t = String(v ?? "").trim();
  return t.length ? t : null;
}

// Gemeinsame Auswertung — egal ob aus xlsx oder csv (beide liefern Zeilen als
// Record + Header-Liste). Toleranter Spaltennamen-Match: Nummer/Hauptcolli/
// Stellplatz/Lagernummer.
function rowsToResult(rows: Record<string, string>[], fields: string[]): LagerwagenImportResult {
  const hNummer = findHeader(fields, "Nummer");
  const hHaupt  = findHeader(fields, "Hauptcolli");
  const hStell  = findHeader(fields, "Stellplatz");
  const hLager  = findHeader(fields, "Lagernummer");

  const seen = new Set<string>();
  const zeilen: LagerwagenZeile[] = [];
  let skipped = 0, duplicates = 0;

  for (const row of rows) {
    const untercolli = hNummer ? nurZiffern(row[hNummer]) : "";
    const hauptcolli = hHaupt  ? nurZiffern(row[hHaupt])  : "";
    if (!untercolli || !hauptcolli) { skipped++; continue; }
    if (seen.has(untercolli))       { duplicates++; continue; }
    seen.add(untercolli);

    zeilen.push({
      untercolli,
      hauptcolli,
      stellplatz:  hStell ? clean(row[hStell]) : null,
      lagernummer: hLager ? clean(row[hLager]) : null,
    });
  }

  const wagen = new Set(zeilen.map((z) => z.hauptcolli)).size;
  return { zeilen, wagen, untercollis: zeilen.length, skipped, duplicates };
}

function parseCsv(file: File): Promise<LagerwagenImportResult> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header:         true,
      skipEmptyLines: true,
      delimiter:      ";",
      complete: (res) => resolve(rowsToResult(res.data, res.meta.fields ?? [])),
      error:    (err) => reject(err),
    });
  });
}

async function parseXlsx(file: File): Promise<LagerwagenImportResult> {
  // SheetJS nur bei Bedarf laden (Lazy-Chunk, nicht im Haupt-Bundle).
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const ws = wb.Sheets[SHEET_NAME] ?? wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error("Keine Tabelle gefunden.");
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: "", raw: false });
  const fields = rows.length ? Object.keys(rows[0]) : [];
  return rowsToResult(rows, fields);
}

export function parseLagerwagenDatei(file: File): Promise<LagerwagenImportResult> {
  return file.name.toLowerCase().endsWith(".csv") ? parseCsv(file) : parseXlsx(file);
}
