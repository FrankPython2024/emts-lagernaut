/**
 * Extrahiert reine Ziffern aus einer (möglicherweise gruppierten) Nummer.
 * Gemeinsame Basis für LogID- und Colli-Normalisierung — niemals numerisch
 * coercen (parseFloat/Number würde "212.757.000" beim zweiten Punkt abschneiden).
 *
 *   "212.757.000" → "212757000"   (alle Ziffern, inkl. abschließender Nullen)
 *   "3.183.906"   → "3183906"
 *
 * Excel/CSV-Float-Artefakte ("209761402.0") werden entfernt — aber NUR wenn der
 * ganze Wert eine reine Dezimalzahl mit Nullen-Nachkommastellen ist. Gepunktete
 * Werte mit mehreren Gruppen bleiben unangetastet, damit eine legitime
 * "…000"-Gruppe nicht verloren geht.
 *
 *   "209761402.0" → "209761402"   (Float-Artefakt: reine Dezimalzahl → ".0" weg)
 *   "212.757.000" → "212757000"   (mehrere Gruppen → KEINE Strip, "000" bleibt)
 */
export function nurZiffern(raw: unknown): string {
  const s = String(raw ?? "").trim();
  const bereinigt = /^\d+\.0+$/.test(s) ? s.replace(/\.0+$/, "") : s;
  return bereinigt.replace(/\D/g, "");
}
