// Client-seitiger CSV-Parser für die STELLPLATZ-PRÜFUNG (Colli-Suche).
// Reine Browser-Session, KEIN DB, KEIN Bestandseffekt.
//
// Quelle: Stellplatz-Export (AfB). Trennzeichen ";", UTF-8, Felder in "
// gequotet, 24 Spalten. Relevant: Nummer (Colli-Nummer), Art (Colli-Typ),
// Stellplatz, Anzahl Teile, Bearbeitungsstatus. Eine Zeile = ein Colli.
// Nutzt papaparse (bereits im Projekt; robust gegen Quotes/BOM/CRLF) — analog
// zum bestehenden parsePickupCsv.

import Papa from "papaparse";
import { nurZiffern } from "@/lib/format/ziffern";

export type ColliZeile = {
  nummer:       string;        // roh, getrimmt (z.B. "3.183.906")
  nummerDigits: string;        // nur Ziffern (z.B. "3183906") — toleranter Vergleich
  art:          string | null; // Colli-Typ (Karton / Teil lose / Monitor-Karton …)
  stellplatz:   string;        // z.B. "ETL-0-0-0"
  anzahlTeile:  string | null; // Anzeige (roh)
  status:       string | null; // Bearbeitungsstatus
};

export type ColliStellplatz = {
  stellplatz: string;
  collis:     ColliZeile[];
};

export type ColliPruefungResult = {
  stellplaetze: ColliStellplatz[];
  total:        number; // Collis gesamt (nach Dedupe)
  skipped:      number; // Zeilen ohne Nummer
  duplicates:   number; // doppelte Nummern entfernt
};

/**
 * Colli-Nummer auf reine Ziffern normalisieren — damit Scanner mit ODER ohne
 * Punkte passen ("3.183.906" und "3183906" sind gleich). Eine abschließende
 * "000"-Gruppe bleibt erhalten; Excel/CSV-Float-Artefakte ("3183906.0") werden
 * entfernt (gemeinsame Basis: nurZiffern).
 */
export function normalizeColliNummer(raw: unknown): string {
  return nurZiffern(raw);
}

// Header case-insensitive matchen: exakt zuerst, sonst "enthält"-Fallback.
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

export function parseColliPruefungCsv(file: File): Promise<ColliPruefungResult> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header:         true,
      skipEmptyLines: true,
      delimiter:      ";",
      complete(res) {
        const fields  = res.meta.fields ?? [];
        const hNummer = findHeader(fields, "Nummer");
        const hArt    = findHeader(fields, "Art");
        const hStell  = findHeader(fields, "Stellplatz");
        const hAnzahl = findHeader(fields, "Anzahl Teile");
        const hStatus = findHeader(fields, "Bearbeitungsstatus");

        const seen = new Set<string>();
        const byStellplatz = new Map<string, ColliZeile[]>();
        let total = 0, skipped = 0, duplicates = 0;

        for (const row of res.data) {
          const nummer = hNummer ? (clean(row[hNummer]) ?? "") : "";
          if (!nummer) { skipped++; continue; } // Zeile ohne Colli-Nummer

          const digits = normalizeColliNummer(nummer);
          const dedupeKey = digits || nummer.toLowerCase();
          if (seen.has(dedupeKey)) { duplicates++; continue; }
          seen.add(dedupeKey);

          const stellplatz = (hStell ? clean(row[hStell]) : null) ?? "—";
          const zeile: ColliZeile = {
            nummer,
            nummerDigits: digits,
            art:          hArt    ? clean(row[hArt])    : null,
            stellplatz,
            anzahlTeile:  hAnzahl ? clean(row[hAnzahl]) : null,
            status:       hStatus ? clean(row[hStatus]) : null,
          };
          const arr = byStellplatz.get(stellplatz);
          if (arr) arr.push(zeile); else byStellplatz.set(stellplatz, [zeile]);
          total++;
        }

        const stellplaetze: ColliStellplatz[] = [...byStellplatz.entries()]
          .map(([stellplatz, collis]) => ({ stellplatz, collis }))
          .sort((a, b) => a.stellplatz.localeCompare(b.stellplatz, "de", { numeric: true }));

        resolve({ stellplaetze, total, skipped, duplicates });
      },
      error(err) { reject(err); },
    });
  });
}

// Eindeutiger Schlüssel eines Collis (für die "gefunden"-Menge): Ziffern, sonst roh.
export function colliKey(c: { nummerDigits: string; nummer: string }): string {
  return c.nummerDigits || c.nummer.toLowerCase();
}
