// ── Mobil-Ersatzteile — Export-Helfer (Browser, client-only) ─────────────────
//
// Nur noch die ZWISCHENABLAGE (LogIDs). CSV/XLSX laufen server-seitig über
// `/api/mobil/export` (Content-Disposition) — kein programmatischer Client-Blob-
// Download mehr (der startete in manchen Browsern/WebViews still nicht).

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

// Zwischenablage: NUR die LogIDs, eine pro Zeile — kein Header, keine weiteren Spalten.
export function baueZwischenablage(zeilen: MobilExportZeile[]): string {
  return zeilen.map((z) => z.logId).join("\n");
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
