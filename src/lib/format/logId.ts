/**
 * LogID-Format-Normalisierung — Single Source of Truth.
 *
 * Standard-Format der DB: XXX.XXX.XXX (mit Punkten).
 * Frontend darf weiterhin mit/ohne Punkten eintippen, der Server normalisiert
 * vor jedem DB-Schreibvorgang.
 */

/**
 * Normalisiert auf Standard-Format XXX.XXX.XXX (mit Punkten).
 *
 * Akzeptiert beliebige Trenner ("212757577", "212.757.577", "212 757 577",
 * "212-757-577") und liefert konsistent das Punkt-Format zurück.
 *
 * Fallback: wenn nicht genau 9 Ziffern, wird die geputzte Variante (nur
 * Ziffern) zurückgegeben — kein Crash bei Test-/Sonder-LogIDs anderer Länge.
 */
export function normalizeLogId(input: string): string {
  const clean = input.replace(/\D/g, "");
  if (clean.length !== 9) return clean;
  return `${clean.slice(0, 3)}.${clean.slice(3, 6)}.${clean.slice(6, 9)}`;
}

/**
 * Liefert die punktfreie Variante einer LogID.
 * Für direkte DB-Vergleiche mit GeraeteLookup.logIdClean.
 */
export function logIdClean(input: string): string {
  return input.replace(/\D/g, "");
}
