// LogID-Helfer fürs Pickup-Modul.
//
// Achtung — zwei verschiedene Darstellungen:
//   • normalizeLogId → REINE ZIFFERN (für Speicherung/Vergleich, robust gegen
//     Float-Artefakte aus CSV/Excel wie "209761402.0").
//   • formatLogId    → ANZEIGE mit Punkten (XXX.XXX.XXX). Nutzt den vorhandenen
//     Projekt-Formatierer (Single Source of Truth) wieder.

import { normalizeLogId as formatProjektLogId } from "@/lib/format/logId";

/**
 * Normalisiert eine rohe LogID auf reine Ziffern.
 *   "209.761.402"  → "209761402"
 *   "209761402.0"  → "209761402"   (Float-Artefakt: trailing ".0+" zuerst weg)
 */
export function normalizeLogId(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .replace(/\.0+$/, "")  // Float-Artefakt aus Excel/CSV entfernen
    .replace(/\D/g, "");   // alle Nicht-Ziffern entfernen
}

/**
 * Formatiert reine Ziffern zur Anzeige mit Punkten (alle 3 Stellen von rechts).
 * Für die Standard-9-Stellen-LogID nutzt es den vorhandenen Projekt-Formatierer
 * (liefert XXX.XXX.XXX); für abweichende Längen wird generisch gruppiert.
 */
export function formatLogId(digits: string): string {
  if (!digits) return "";
  if (digits.length === 9) return formatProjektLogId(digits);
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}
