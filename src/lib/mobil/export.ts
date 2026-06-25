// ── Mobil-Ersatzteile — Export-Helfer (Browser, client-only) ─────────────────
//
// Zwischenablage + CSV/Excel-Download für die LogIDs einer Modell+Teiltyp-Gruppe.
// Reine Browser-Logik, KEIN Server-/Prisma-Import. xlsx wird per dynamischem
// import nur bei Bedarf geladen (nicht im Initial-Bundle).

export type MobilExportZeile = {
  logId:       string;
  colli:       string | null;
  stellplatz:  string | null;
  bezeichnung: string;
  ek:          number | null;
};

const SPALTEN = ["LogID", "Colli", "Stellplatz", "Bezeichnung", "EK"] as const;

// EK für DE-Excel: Dezimal-Komma, 2 Nachkommastellen; leer bleibt leer.
function ekText(ek: number | null): string {
  return ek == null ? "" : ek.toFixed(2).replace(".", ",");
}

// Eine Matrix-Zeile (Strings) — für CSV und Excel identisch.
function zeileAlsArray(z: MobilExportZeile): string[] {
  return [z.logId, z.colli ?? "", z.stellplatz ?? "", z.bezeichnung, ekText(z.ek)];
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

// Echte .xlsx via SheetJS (dynamisch geladen).
export async function ladeXlsx(dateiname: string, zeilen: MobilExportZeile[]): Promise<void> {
  const XLSX = await import("xlsx");
  const matrix = [[...SPALTEN], ...zeilen.map(zeileAlsArray)];
  const ws = XLSX.utils.aoa_to_sheet(matrix);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Teile");
  XLSX.writeFile(wb, dateiname);
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
