// ── Pickup-Scan: Auswertung auf dem Gerät + Warteschlange fürs Speichern ──────
//
// Warum auf dem Gerät (Paket 1 „Kein Scan geht verloren", 24.09.2026):
// Vorher entschied der SERVER über jeden Scan, und die Seite wartete darauf.
//   • Lief die Anfrage noch (schwaches WLAN), wurde der nächste Scan still
//     verworfen (`if (!scan.isPending)`); seine Ziffern klebten an die alten
//     („nicht erkannt"), danach erschien der grüne Haken des VORIGEN Geräts.
//   • Scheiterte das Speichern, gab es weder Ton noch Meldung — Feld trotzdem leer.
//   • Die Colli-Prüfung meldete bei Netzfehler denselben Ton wie „nichts
//     Gesuchtes hier" — der Picker ließ einen vollen Karton stehen — und zeigte
//     bis zu 30 s alte Treffer (Query-Cache).
// Alle drei Urteile hängen AUSSCHLIESSLICH an den Positionen des Auftrags
// (siehe `pickup.scan` / `pickup.colliPruefen` im Router), und die hat das Gerät
// geladen. Also entscheidet das Gerät sofort; der Server bekommt nur noch die
// Funde zum Speichern, über eine Warteschlange mit Wiederholung.
//
// ⚠️ Die Weiche hier muss der Server-Regel gleichen. Wer `pickup.scan` oder
// `pickup.colliPruefen` ändert, ändert diese Datei mit (Test: `npm run test:scan`).

import { nurZiffern } from "@/lib/format/ziffern";

// Scan-Art an der Ziffernlänge: LogIDs sind einheitlich 9-stellig, Collis 6–7.
export const LOGID_LEN = 9;
export const COLLI_MIN = 6;
export const COLLI_MAX = 7;

export type ScanPositionBasis = {
  logId: string;
  colli: string | null;
  status: string;
  bezeichnung: string | null;
};

export type ScanUrteil<P extends ScanPositionBasis> =
  | { art: "logid"; result: "GEFUNDEN" | "SCHON" | "FREMD"; logId: string; position: P | null }
  | { art: "colli"; colliNummer: string; colliBekannt: boolean; treffer: { logId: string; bezeichnung: string | null }[] }
  | { art: "vorabscan"; hauptcolli: string }
  | { art: "unbekannt"; wert: string };

function positionZu<P extends ScanPositionBasis>(positionen: P[], ziffern: string): ScanUrteil<P> {
  const pos = positionen.find((p) => nurZiffern(p.logId) === ziffern) ?? null;
  if (!pos) return { art: "logid", result: "FREMD", logId: ziffern, position: null };
  return { art: "logid", result: pos.status === "GEFUNDEN" ? "SCHON" : "GEFUNDEN", logId: ziffern, position: pos };
}

/**
 * Was bedeutet dieser Scan? Reine Funktion, kein Netz.
 *
 * LogID-Auftrag: 9 Stellen → Gerät; 6–7 → Hauptcolli (Wagen, hakt nichts ab)
 * oder Colli-Prüfung; sonst „nicht erkannt".
 * Colli-Auftrag: Hauptcolli zuerst; 6–7 → Colli als Position; 9 → gehört nicht
 * dazu; sonst „nicht erkannt".
 * ⚠️ Haupt- und Untercolli sind beide ~7-stellig — unterscheidbar NUR über die
 * Lagerwagen-Tabelle (`hauptcollis`), nie über die Länge.
 */
export function werteScanAus<P extends ScanPositionBasis>(args: {
  roh: string;
  istColli: boolean;
  positionen: P[];
  hauptcollis: Set<string>;
}): ScanUrteil<P> {
  const ziffern = nurZiffern(args.roh);
  const len = ziffern.length;
  const colliLang = len >= COLLI_MIN && len <= COLLI_MAX;

  if (args.hauptcollis.has(ziffern) && (args.istColli || colliLang)) {
    return { art: "vorabscan", hauptcolli: ziffern };
  }
  if (args.istColli) {
    if (colliLang) return positionZu(args.positionen, ziffern);
    if (len === LOGID_LEN) return { art: "logid", result: "FREMD", logId: ziffern, position: null };
    return { art: "unbekannt", wert: ziffern };
  }
  if (len === LOGID_LEN) return positionZu(args.positionen, ziffern);
  if (colliLang) {
    // Gleiche Regel wie `pickup.colliPruefen`: nur die Positionen des Auftrags,
    // „bekannt" = der Colli gehört überhaupt dazu, Treffer = noch offene, je LogID einmal.
    const imColli = args.positionen.filter((p) => nurZiffern(p.colli ?? "") === ziffern);
    const treffer: { logId: string; bezeichnung: string | null }[] = [];
    const gesehen = new Set<string>();
    for (const p of imColli) {
      if (p.status === "GEFUNDEN") continue;
      const d = nurZiffern(p.logId);
      if (gesehen.has(d)) continue;
      gesehen.add(d);
      treffer.push({ logId: d, bezeichnung: p.bezeichnung });
    }
    return { art: "colli", colliNummer: ziffern, colliBekannt: imColli.length > 0, treffer };
  }
  return { art: "unbekannt", wert: ziffern };
}

// ── Warteschlange ────────────────────────────────────────────────────────────

/** Ein gefundenes Gerät, dessen Speicherung noch aussteht. */
export type OffenerScan = {
  /** Eindeutig je Scan — zum Entfernen nach dem Speichern. */
  key: string;
  logId: string;
  erfasstAm: number;
  versuche: number;
};

/**
 * Wie mit einem Fehler beim Speichern umgehen?
 *  • "wiederholen": Netz weg, 502, Zeitüberschreitung, Serverfehler — später nochmal.
 *  • "anmelden":    Sitzung abgelaufen — Scans BEHALTEN, bis wieder angemeldet.
 *  • "aufgeben":    Der Server lehnt den Scan dauerhaft ab (Auftrag abgeschlossen,
 *                   gelöscht, kein Recht) — Wiederholen ändert daran nichts.
 */
export function fehlerArt(err: unknown): "wiederholen" | "anmelden" | "aufgeben" {
  const code = (err as { data?: { code?: string } } | null)?.data?.code;
  if (code === "UNAUTHORIZED") return "anmelden";
  if (code === "PRECONDITION_FAILED" || code === "NOT_FOUND" || code === "FORBIDDEN" || code === "BAD_REQUEST") {
    return "aufgeben";
  }
  return "wiederholen";
}

/** Pause vor dem nächsten Versuch: 1, 2, 4, 8, dann alle 15 s. */
export function wartezeitMs(versuche: number): number {
  return Math.min(15_000, 1000 * 2 ** Math.max(0, versuche));
}

const SPEICHER_PREFIX = "pickup-warteschlange-";

/**
 * Unsendete Scans überleben ein Neuladen der Seite. ⚠️ localStorage kann fehlen
 * oder werfen (privater Modus, volle Quote) — dann läuft die Schlange nur im
 * Speicher weiter, das Scannen selbst darf daran nie scheitern.
 */
export function ladeWarteschlange(auftragId: number): OffenerScan[] {
  try {
    const roh = window.localStorage.getItem(SPEICHER_PREFIX + auftragId);
    if (!roh) return [];
    const liste = JSON.parse(roh) as unknown;
    if (!Array.isArray(liste)) return [];
    return liste.filter(
      (s): s is OffenerScan =>
        !!s && typeof s.key === "string" && typeof s.logId === "string" && typeof s.erfasstAm === "number",
    ).map((s) => ({ ...s, versuche: typeof s.versuche === "number" ? s.versuche : 0 }));
  } catch {
    return [];
  }
}

/** Alle Aufträge, für die auf DIESEM Gerät noch Scans auf das Speichern warten. */
export function wartendeAuftraege(): { auftragId: number; anzahl: number }[] {
  const out: { auftragId: number; anzahl: number }[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k?.startsWith(SPEICHER_PREFIX)) continue;
      const auftragId = Number(k.slice(SPEICHER_PREFIX.length));
      if (!Number.isInteger(auftragId)) continue;
      const anzahl = ladeWarteschlange(auftragId).length;
      if (anzahl > 0) out.push({ auftragId, anzahl });
    }
  } catch {
    /* ohne Speicher: nichts zu melden */
  }
  return out;
}

export function speichereWarteschlange(auftragId: number, liste: OffenerScan[]): void {
  try {
    if (liste.length === 0) window.localStorage.removeItem(SPEICHER_PREFIX + auftragId);
    else window.localStorage.setItem(SPEICHER_PREFIX + auftragId, JSON.stringify(liste));
  } catch {
    /* ohne Speicher weiter — siehe oben */
  }
}

/**
 * Positionen mit den lokal gefundenen, aber vom Server noch nicht bestätigten
 * Geräten überlagern. So bleibt ein Fund sichtbar abgehakt, auch wenn die Seite
 * zwischendurch den (älteren) Server-Stand neu lädt.
 */
export function mitLokalenFunden<P extends ScanPositionBasis & { gefundenVonName: string | null; gefundenAm: Date | string | null }>(
  positionen: P[],
  lokal: Map<string, number>,
  meinName: string | null,
): P[] {
  if (lokal.size === 0) return positionen;
  return positionen.map((p) => {
    if (p.status === "GEFUNDEN") return p;
    const am = lokal.get(nurZiffern(p.logId));
    if (am === undefined) return p;
    return { ...p, status: "GEFUNDEN", gefundenVonName: meinName, gefundenAm: new Date(am) };
  });
}
