import { VERSCHIEDENES_TEILTYP } from "@/lib/constants/teiltypen";

/**
 * Extrahiert den Heimat-Modell-String aus der Artikel-Bezeichnung, indem der
 * Teiltyp-Suffix abgeschnitten wird.
 *
 * Artikel-Bezeichnungen folgen dem Generator-Muster `{Hersteller} {Modell} {Teiltyp}`
 * (= geraetVoll + " " + teiltyp). Der Rest ist das Heimat-Modell des Artikels.
 *
 * Beispiele:
 *   ("Lenovo ThinkPad T590 20N5-S4WE00 Touchpad", "Touchpad")
 *     → "Lenovo ThinkPad T590 20N5-S4WE00"
 *   ("Lenovo ThinkPad T480 Verschiedenes — Schraubenset", "Verschiedenes")
 *     → null  (Verschiedenes wird NICHT gespiegelt)
 *
 * Gibt null zurück, wenn der Suffix nicht passt oder das Verschiedenes-Teil ist.
 */
export function extractHeimatModell(bezeichnung: string, teiltyp: string): string | null {
  // Verschiedenes hat kein natürliches Modell-Mapping → kein Auto-Mirror
  if (teiltyp === VERSCHIEDENES_TEILTYP) return null;

  const suffix = ` ${teiltyp}`;
  if (!bezeichnung.endsWith(suffix)) return null;

  const heimat = bezeichnung.slice(0, -suffix.length).trim();
  return heimat.length >= 5 ? heimat : null; // Sicherheitsnetz gegen Mini-Fragmente
}
