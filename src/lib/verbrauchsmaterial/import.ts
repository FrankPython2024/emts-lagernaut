// Client-seitiges Parsen der Verbrauchsmaterial-Bestandsliste (Excel).
// .xlsx via SheetJS, Tabellenblatt "Lager" (Fallback: erstes Blatt). Tolerante
// Spaltennamen-Erkennung (case-insensitive, "enthält"-Fallback) — analog zum
// Lagerwagen-Import. Reines Vorbereiten für die Vorschau; das Schreiben passiert
// serverseitig (tRPC).

/**
 * Eine Zeile aus der Bestandsliste.
 *
 * ⚠️ Alle Felder außer `name` sind OPTIONAL, und `undefined` heißt „stand nicht
 * in der Datei" — nicht „ist leer". Vorher lieferte der Parser bei fehlender
 * Spalte `0` bzw. `null`, und der Import schrieb das durch: Hieß die Spalte in
 * der nächsten Excel „Bestand aktuell" statt „Aktueller Bestand", standen
 * danach ALLE Bestände auf null. Ohne Rückfrage, ohne Hinweis.
 */
export type VMImportZeile = {
  name:              string;        // Pflicht — sonst übersprungen
  merkmale?:         string | null;
  kategorie?:        string | null;
  mindestbestand?:   number;        // >= 0
  aktuellerBestand?: number;        // >= 0
  aan?:              string | null;
  gebindegroesse?:   number | null;
  bemerkung?:        string | null;
};

export type VMImportResult = {
  zeilen:  VMImportZeile[];
  total:   number; // erkannte Zeilen (mit Name)
  skipped: number; // Zeilen ohne Artikelname
  /**
   * Spalten, die in der Datei nicht gefunden wurden. Die zugehörigen Werte
   * bleiben unangetastet — die Oberfläche muss das sagen, sonst wundert sich
   * jemand, warum sich nichts geändert hat.
   */
  fehlendeSpalten: string[];
};

const SHEET_NAME = "Lager";

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

// Ganzzahl aus beliebiger Zelle (auch "1.000", "12 Stk", "3,0"). Negatives und
// Unparsbares → 0.
// WICHTIG: Der Dezimalteil muss ABGESCHNITTEN werden, bevor Nicht-Ziffern fallen —
// sonst wird "3,0" zu "30" (verzehnfachter Bestand). Deutsche Konvention:
// Komma = Dezimaltrenner; Punkt = Tausendertrenner, ausser ihm folgen 1-2 Ziffern.
function toInt(v: unknown): number {
  const s = String(v ?? "").trim()
    .replace(/,\d*$/, "")        // "3,0" → "3" · "1.234,56" → "1.234"
    .replace(/\.\d{1,2}$/, "")   // "3.5" → "3"  ("1.000" bleibt: 3 Ziffern = Tausender)
    .replace(/[^\d-]/g, "");     // "1.000" → "1000" · "12 Stk" → "12"
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Wie toInt, aber leere/0-Zelle → null (für optionale Gebindegröße).
function toIntOrNull(v: unknown): number | null {
  const n = toInt(v);
  return n > 0 ? n : null;
}

function rowsToResult(rows: Record<string, unknown>[], fields: string[]): VMImportResult {
  const hName    = findHeader(fields, "Artikelname") ?? findHeader(fields, "Name");
  const hMerkmal = findHeader(fields, "Merkmale");
  const hMindest = findHeader(fields, "Mindestbestand");
  const hBestand = findHeader(fields, "Aktueller Bestand");
  const hKateg   = findHeader(fields, "Kategorie");
  const hAan     = findHeader(fields, "AAN");
  const hStueck  = findHeader(fields, "Stückzahl") ?? findHeader(fields, "Stueckzahl");
  const hBemerk  = findHeader(fields, "Bemerkung");

  const zeilen: VMImportZeile[] = [];
  let skipped = 0;

  for (const row of rows) {
    const name = hName ? clean(row[hName]) : null;
    if (!name) { skipped++; continue; } // Header-/Leerzeile ohne Artikelname

    // ⚠️ Fehlende Spalte = Feld gar nicht setzen. Ein `null`/`0` an dieser
    // Stelle würde den gepflegten Wert im Bestand überschreiben.
    zeilen.push({
      name,
      ...(hMerkmal && { merkmale:         clean(row[hMerkmal]) }),
      ...(hKateg   && { kategorie:        clean(row[hKateg]) }),
      ...(hMindest && { mindestbestand:   toInt(row[hMindest]) }),
      ...(hBestand && { aktuellerBestand: toInt(row[hBestand]) }),
      ...(hAan     && { aan:              clean(row[hAan]) }),
      ...(hStueck  && { gebindegroesse:   toIntOrNull(row[hStueck]) }),
      ...(hBemerk  && { bemerkung:        clean(row[hBemerk]) }),
      // Standort: in der Excel nicht enthalten → bleibt leer (im Admin pflegbar).
    });
  }

  const fehlendeSpalten = [
    hMerkmal ? null : "Merkmale",
    hKateg   ? null : "Kategorie",
    hMindest ? null : "Mindestbestand",
    hBestand ? null : "Aktueller Bestand",
    hAan     ? null : "AAN",
    hStueck  ? null : "Stückzahl",
    hBemerk  ? null : "Bemerkung",
  ].filter((s): s is string => s !== null);

  return { zeilen, total: zeilen.length, skipped, fehlendeSpalten };
}

export async function parseVerbrauchsmaterialDatei(file: File): Promise<VMImportResult> {
  // SheetJS nur bei Bedarf laden (Lazy-Chunk, nicht im Haupt-Bundle).
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const ws = wb.Sheets[SHEET_NAME] ?? wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error("Keine Tabelle gefunden.");
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "", raw: false });
  const fields = rows.length ? Object.keys(rows[0]) : [];
  return rowsToResult(rows, fields);
}
