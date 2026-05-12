// ── Bezeichnung-Bereinigung ──────────────────────────────────────────────────
//
// Bereinigt eine Geräte-Bezeichnung auf den reinen Modell-Namen.
// Gibt die bereinigte Bezeichnung OHNE Hersteller-Prefix zurück.
//
// Der Aufrufer konstruiert dann: bereinigt = "${hersteller} ${ergebnis}"
//
// WICHTIG: Modell-Nummern wie 7530, 5490, T14, G6 werden BEHALTEN!
// Nur Lenovo-Interne Codes (6+ Großbuchstaben+Ziffern am Ende) werden entfernt.

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Bereinigt die rohe Bezeichnung aus dem CSV und gibt den Modell-Namen zurück.
 *
 * @param hersteller  Normalisierter Hersteller ("Dell", "HP", "Lenovo", "Fujitsu")
 * @param bezeichnung Rohe Bezeichnung aus dem CSV
 * @returns           Bereinigter Modell-Name ohne Hersteller-Prefix
 */
export function bereinigeBezeichnung(hersteller: string, bezeichnung: string): string {
  if (!bezeichnung) return "";

  let result = bezeichnung.trim();

  // 1. Marketing-Texte entfernen: alles ab erstem " - " (Leerzeichen beidseitig!)
  //    "Latitude 7490 (F) - 14"-FullHD-Displ." → "Latitude 7490 (F)"
  //    Nur wenn mindestens 5 Zeichen davor stehen (kein "A - B")
  const dashIdx = result.indexOf(" - ");
  if (dashIdx >= 5) {
    result = result.substring(0, dashIdx).trim();
  }

  // 2. Marketing-Präfixe entfernen
  result = result.replace(
    /^(Business-NB|Business-Convertible|Business-Laptop|Notebook\s+Pc?|Notebook\b|Laptop\b)\s+/i,
    "",
  ).trim();

  // 3. Hersteller-Doppelung entfernen
  //    "Dell Precision M3800" → "Precision M3800" (wenn hersteller = "Dell")
  if (hersteller) {
    const herstellerRegex = new RegExp(`^${escapeRegex(hersteller)}\\s+`, "i");
    result = result.replace(herstellerRegex, "").trim();
  }

  // 4. Einzelbuchstabe in Klammern am Ende: "(F)", "(A)"
  //    "Latitude 7490 (F)" → "Latitude 7490"
  result = result.replace(/\s*\([A-Z]\)\s*$/, "").trim();

  // 5. "und/& GX" / "/ GX" am Ende entfernen (HP-Varianten-Suffix)
  //    "ProBook 650 G4 und G5" → "ProBook 650 G4"
  result = result.replace(/\s+(?:und|\/|&)\s+G\d+\s*$/i, "").trim();

  // 6. Interne Codes am Ende entfernen (Lenovo-Stil: 6+ Zeichen, nur GROSSBUCHSTABEN + Ziffern)
  //    "ThinkPad T14 Gen 2i 20W1S06V00" → "ThinkPad T14 Gen 2i"
  //    NICHT: "7530" (4 Zeichen), "T14s" (4 Zeichen), "M3800" (5 Zeichen)
  //    Der Bug in der alten Version: {4,} hat "7530" fälschlich entfernt!
  let prev = "";
  while (prev !== result) {
    prev   = result;
    result = result.replace(/\s+[A-Z0-9]{6,}[-A-Z0-9]*$/i, "").trim();
  }

  // 7. Mehrfache Leerzeichen normalisieren
  result = result.replace(/\s+/g, " ").trim();

  // 8. Safety: zu kurz → Original zurückgeben
  if (!result || result.length < 3) {
    return bezeichnung.trim();
  }

  return result;
}
