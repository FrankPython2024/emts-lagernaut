// ── Mobil-Ersatzteile — Export-Helfer (Browser, client-only) ─────────────────
//
// Zwischenablage + CSV/Excel-Download für die LogIDs einer Modell+Teiltyp-Gruppe.
// Reine Browser-Logik, KEIN Server-/Prisma-Import. xlsx wird per dynamischem
// import nur bei Bedarf geladen (nicht im Initial-Bundle).

export type MobilExportZeile = {
  logId:       string;
  colli:       string | null;
  stellplatz:  string | null;
  farbe:       string | null;
  aan:         string | null;
  ek:          number | null;
  lieferant:   string | null;
  bezeichnung: string;
};

const SPALTEN = ["LogID", "Colli", "Stellplatz", "Farbe", "AAN", "EK", "Lieferant", "Bezeichnung"] as const;

// EK für DE-Excel: Dezimal-Komma, 2 Nachkommastellen; leer bleibt leer.
function ekText(ek: number | null): string {
  return ek == null ? "" : ek.toFixed(2).replace(".", ",");
}

// Eine Matrix-Zeile (Strings) — für CSV und Excel identisch. Reihenfolge = SPALTEN.
function zeileAlsArray(z: MobilExportZeile): string[] {
  return [z.logId, z.colli ?? "", z.stellplatz ?? "", z.farbe ?? "", z.aan ?? "", ekText(z.ek), z.lieferant ?? "", z.bezeichnung];
}

// CSV-Feld quoten, falls ; " oder Zeilenumbruch enthalten.
function csvFeld(v: string): string {
  return /[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

// CSV: UTF-8-BOM (DE-Excel), ;-getrennt, CRLF, mit Header.
export function baueCsv(zeilen: MobilExportZeile[]): string {
  const matrix = [[...SPALTEN], ...zeilen.map(zeileAlsArray)];
  return "﻿" + matrix.map((z) => z.map(csvFeld).join(";")).join("\r\n");
}

// Zwischenablage: NUR die LogIDs, eine pro Zeile — kein Header, keine weiteren
// Spalten. (CSV/XLSX behalten alle Spalten; nur die Zwischenablage ist reduziert.)
export function baueZwischenablage(zeilen: MobilExportZeile[]): string {
  return zeilen.map((z) => z.logId).join("\n");
}

// Dateiname robust: Teile verbinden, Sonderzeichen/Leerzeichen → "_".
export function sichererDateiname(teile: string[], ext: string): string {
  const base = teile
    .map((t) => t.trim())
    .filter(Boolean)
    .join("_")
    .replace(/[^\w.-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return `${base || "export"}.${ext}`;
}

function ladeBlob(dateiname: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = dateiname;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ladeCsv(dateiname: string, csv: string): void {
  ladeBlob(dateiname, new Blob([csv], { type: "text/csv;charset=utf-8;" }));
}

// SheetJS wird lazy geladen (nicht im Initial-Bundle), aber VOR der Klick-Geste
// vorgeladen (xlsxVorladen beim Modal-Öffnen). So ist ladeXlsx beim Klick rein
// SYNCHRON — kein `await import(...)`, das die User-Geste kosten und den Download
// still blockieren würde.
let xlsxModul: typeof import("xlsx") | null = null;

// Idempotent: lädt SheetJS einmalig in den Cache. Beim Öffnen des Export-Modals
// aufrufen, damit die Lib beim XLSX-Klick bereits da ist.
export async function xlsxVorladen(): Promise<void> {
  if (!xlsxModul) xlsxModul = await import("xlsx");
}

// Echte .xlsx via SheetJS — SYNCHRON. Setzt voraus, dass xlsxVorladen() bereits lief.
// Download über denselben Blob-Weg wie CSV (XLSX.writeFile kann Gesten-/Bundle-
// Probleme haben), damit der Klick zuverlässig herunterlädt.
export function ladeXlsx(dateiname: string, zeilen: MobilExportZeile[]): void {
  if (!xlsxModul) {
    throw new Error("Excel-Bibliothek noch nicht geladen — bitte kurz warten und erneut klicken.");
  }
  const XLSX = xlsxModul;
  const matrix = [[...SPALTEN], ...zeilen.map(zeileAlsArray)];
  const ws = XLSX.utils.aoa_to_sheet(matrix);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Teile");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  ladeBlob(dateiname, new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
}

// Text in die Zwischenablage. Bevorzugt Clipboard-API (HTTPS), Fallback über ein
// verstecktes Textarea (HTTP-Kontext / ältere Browser).
export async function kopiereText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* Fallback unten */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
