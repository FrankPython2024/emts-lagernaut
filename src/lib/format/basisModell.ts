// ── Basis-Modell-Extraktion ──────────────────────────────────────────────────
//
// Volle Modell-Strings enthalten am Ende einen MTM-Code (Maschinentyp-Modell),
// z.B. "Lenovo ThinkPad T480 20L6-S2AD03". Für die UI-Gruppierung wollen wir
// nur das Basis-Modell ("Lenovo ThinkPad T480").
//
// Bewusst KEINE breite Regex über den ganzen String (wie ursprünglich
// angedacht): mit /i und Token-Chaining würde "Lenovo ThinkPad T480 20L6-S2AD03"
// fälschlich zu "Lenovo" zusammenfallen. Stattdessen prüfen wir gezielt das
// LETZTE Whitespace-Token und entfernen es nur, wenn es eindeutig wie ein
// MTM-Code aussieht. Im Zweifel bleibt der Name unverändert (Einzel-Gruppe).

/**
 * Ist das Token ein MTM-Code (und NICHT eine Modellnummer wie "T480"/"G5"/"7530")?
 *
 * Unterscheidungsmerkmale eines MTM-Codes:
 *   - nur Großbuchstaben/Ziffern (+ optionale Bindestriche) → "ThinkPad" (klein) fällt raus
 *   - enthält mindestens eine Ziffer UND einen Buchstaben → "7530"/"840" fallen raus
 *   - hat entweder einen Bindestrich ("20L6-S2AD03") ODER ist ≥6 alphanum. Zeichen
 *     ("CK12345") → "T480" (4)/"G5" (2)/"X1" (2) fallen raus und bleiben Teil der Basis
 */
function istMtmToken(tok: string): boolean {
  if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(tok)) return false; // Großbuchst./Ziffern (+ Bindestrich)
  if (!/[0-9]/.test(tok)) return false;                       // muss Ziffer enthalten
  if (!/[A-Z]/.test(tok)) return false;                       // muss Buchstaben enthalten
  const alnumLen = tok.replace(/-/g, "").length;
  return tok.includes("-") || alnumLen >= 6;
}

/**
 * Extrahiert den Basis-Modellnamen, indem ein klar erkennbarer MTM-Code am Ende
 * entfernt wird. Fallback: Original-Name (z.B. wenn kein MTM erkennbar).
 */
export function extractBasisModell(modellName: string): string {
  const name   = modellName.trim();
  const tokens = name.split(/\s+/);
  if (tokens.length < 2) return name;

  const last = tokens[tokens.length - 1]!;
  if (!istMtmToken(last)) return name;

  const basis = tokens.slice(0, -1).join(" ").trim();
  // Sicherheitsnetz: zu kurze Basis (z.B. nur Hersteller) → lieber Original behalten
  return basis.length >= 5 ? basis : name;
}

export type BasisGruppe = { basisName: string; varianten: string[]; anzahl: number };

/**
 * Gruppiert Modelle nach Basis-Modell. `varianten` enthält die vollen
 * Gerätenamen (= Kompatibilitaet.geraet), damit beim Speichern expandiert
 * werden kann.
 */
export function gruppiereNachBasis(
  modelle: Array<{ id: number; name: string }>,
): BasisGruppe[] {
  const gruppen = new Map<string, string[]>();

  for (const m of modelle) {
    const basis = extractBasisModell(m.name);
    if (!gruppen.has(basis)) gruppen.set(basis, []);
    gruppen.get(basis)!.push(m.name);
  }

  return [...gruppen.entries()]
    .map(([basisName, varianten]) => ({ basisName, varianten, anzahl: varianten.length }))
    .sort((a, b) => a.basisName.localeCompare(b.basisName));
}
