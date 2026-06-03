// ── Bezeichnung-Bereinigung ──────────────────────────────────────────────────
//
// Bereinigt eine Geräte-Bezeichnung auf den reinen Modell-Namen.
// Gibt die bereinigte Bezeichnung OHNE Hersteller-Prefix zurück.
//
// Der Aufrufer konstruiert dann: bereinigt = "${hersteller} ${ergebnis}"
//
// WICHTIG: Modell-Nummern wie 7530, 5490, T14, G6 werden BEHALTEN!
// Nur Lenovo-Interne Codes (6+ Großbuchstaben+Ziffern am Ende) werden entfernt.
//
// Single Source of Truth: Sowohl bereinigeBezeichnung() (dünner Wrapper) als auch
// bereinigeBezeichnungTrace() (für die Import-Sandbox) durchlaufen dieselbe
// geordnete Schritt-Liste BEREINIGUNGS_SCHRITTE + denselben finalize-Guard.

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Kontext, der den Reinigungs-Schritten zur Verfügung steht. */
export interface BereinigungsContext {
  hersteller: string;
  original:   string;
}

/** Ein einzelner Reinigungs-Schritt (reine Transformation auf dem aktuellen String). */
export interface BereinigungsSchritt {
  nummer:       number;
  name:         string;
  beschreibung: string;
  transform:    (current: string, ctx: BereinigungsContext) => string;
}

/**
 * Die Reinigungs-Schritte 1–7 in fester Reihenfolge. EXAKT dieselben Regex,
 * Schwellen und Reihenfolge wie zuvor — Verhalten ist byte-identisch.
 */
export const BEREINIGUNGS_SCHRITTE: BereinigungsSchritt[] = [
  {
    nummer:       1,
    name:         "Marketing-Text abschneiden",
    beschreibung: 'Alles ab dem ersten „ - " (Leerzeichen beidseitig) wird entfernt — z.B. Display- und CPU-Angaben. Nur, wenn davor mindestens 5 Zeichen stehen.',
    transform: (current) => {
      // 1. Marketing-Texte entfernen: alles ab erstem " - " (Leerzeichen beidseitig!)
      //    "Latitude 7490 (F) - 14"-FullHD-Displ." → "Latitude 7490 (F)"
      //    Nur wenn mindestens 5 Zeichen davor stehen (kein "A - B")
      const dashIdx = current.indexOf(" - ");
      if (dashIdx >= 5) {
        return current.substring(0, dashIdx).trim();
      }
      return current;
    },
  },
  {
    nummer:       2,
    name:         "Vorsätze entfernen",
    beschreibung: 'Wörter wie „Notebook", „Laptop" oder „Business-NB" am Anfang werden gestrichen.',
    transform: (current) =>
      // 2. Marketing-Präfixe entfernen
      current.replace(
        /^(Business-NB|Business-Convertible|Business-Laptop|Notebook\s+Pc?|Notebook\b|Laptop\b)\s+/i,
        "",
      ).trim(),
  },
  {
    nummer:       3,
    name:         "Hersteller-Doppelung entfernen",
    beschreibung: 'Steht der Hersteller-Name nochmal am Anfang (z.B. „Dell Precision"), wird er entfernt.',
    transform: (current, ctx) => {
      // 3. Hersteller-Doppelung entfernen
      //    "Dell Precision M3800" → "Precision M3800" (wenn hersteller = "Dell")
      if (ctx.hersteller) {
        const herstellerRegex = new RegExp(`^${escapeRegex(ctx.hersteller)}\\s+`, "i");
        return current.replace(herstellerRegex, "").trim();
      }
      return current;
    },
  },
  {
    nummer:       4,
    name:         "Einzelbuchstabe in Klammern entfernen",
    beschreibung: 'Ein einzelner Großbuchstabe in Klammern am Ende wie „(F)" oder „(A)" wird entfernt.',
    transform: (current) =>
      // 4. Einzelbuchstabe in Klammern am Ende: "(F)", "(A)"
      //    "Latitude 7490 (F)" → "Latitude 7490"
      current.replace(/\s*\([A-Z]\)\s*$/, "").trim(),
  },
  {
    nummer:       5,
    name:         "Varianten-Suffix entfernen",
    beschreibung: 'Zusätze wie „und G5", „/ G5" oder „& G5" am Ende werden gestrichen.',
    transform: (current) =>
      // 5. "und/& GX" / "/ GX" am Ende entfernen (HP-Varianten-Suffix)
      //    "ProBook 650 G4 und G5" → "ProBook 650 G4"
      current.replace(/\s+(?:und|\/|&)\s+G\d+\s*$/i, "").trim(),
  },
  {
    nummer:       6,
    name:         "Interne Codes entfernen",
    beschreibung: 'Lange interne Codes am Ende (6+ Großbuchstaben/Ziffern) werden entfernt — Modell-Nummern wie 7530, T14s oder M3800 bleiben erhalten.',
    transform: (current) => {
      // 6. Interne Codes am Ende entfernen (Lenovo-Stil: 6+ Zeichen, nur GROSSBUCHSTABEN + Ziffern)
      //    "ThinkPad T14 Gen 2i 20W1S06V00" → "ThinkPad T14 Gen 2i"
      //    NICHT: "7530" (4 Zeichen), "T14s" (4 Zeichen), "M3800" (5 Zeichen)
      //    Der Bug in der alten Version: {4,} hat "7530" fälschlich entfernt!
      let prev   = "";
      let result = current;
      while (prev !== result) {
        prev   = result;
        result = result.replace(/\s+[A-Z0-9]{6,}[-A-Z0-9]*$/i, "").trim();
      }
      return result;
    },
  },
  {
    nummer:       7,
    name:         "Leerzeichen normalisieren",
    beschreibung: "Mehrfache Leerzeichen werden zu einem einzigen zusammengefasst.",
    transform: (current) =>
      // 7. Mehrfache Leerzeichen normalisieren
      current.replace(/\s+/g, " ").trim(),
  },
];

/**
 * Sicherheitsnetz nach den Schritten: ist das Ergebnis leer oder kürzer als
 * 3 Zeichen, wird die getrimmte Original-Bezeichnung zurückgegeben.
 */
function finalize(result: string, bezeichnung: string): { result: string; sicherheitsnetzGegriffen: boolean } {
  // 8. Safety: zu kurz → Original zurückgeben
  if (!result || result.length < 3) {
    return { result: bezeichnung.trim(), sicherheitsnetzGegriffen: true };
  }
  return { result, sicherheitsnetzGegriffen: false };
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

  const ctx: BereinigungsContext = { hersteller, original: bezeichnung };
  let result = bezeichnung.trim();
  for (const schritt of BEREINIGUNGS_SCHRITTE) {
    result = schritt.transform(result, ctx);
  }
  return finalize(result, bezeichnung).result;
}

// ── Trace-Variante für die Import-Sandbox ─────────────────────────────────────

export interface BereinigungsSchrittTrace {
  nummer:       number;
  name:         string;
  beschreibung: string;
  vorher:       string;
  nachher:      string;
  veraendert:   boolean;
}

export interface BereinigungsTrace {
  result:                    string;
  schritte:                  BereinigungsSchrittTrace[];
  sicherheitsnetzGegriffen:  boolean;
}

/**
 * Wie bereinigeBezeichnung(), gibt aber den vollständigen Verlauf zurück:
 * je Schritt vorher/nachher + ob er etwas verändert hat, plus ob das
 * Sicherheitsnetz gegriffen hat. Nutzt DIESELBE Schritt-Liste (Single Source of
 * Truth) — `result` ist identisch zu bereinigeBezeichnung().
 */
export function bereinigeBezeichnungTrace(hersteller: string, bezeichnung: string): BereinigungsTrace {
  if (!bezeichnung) {
    return { result: "", schritte: [], sicherheitsnetzGegriffen: false };
  }

  const ctx: BereinigungsContext = { hersteller, original: bezeichnung };
  let current = bezeichnung.trim();
  const schritte: BereinigungsSchrittTrace[] = [];

  for (const schritt of BEREINIGUNGS_SCHRITTE) {
    const vorher  = current;
    const nachher = schritt.transform(vorher, ctx);
    schritte.push({
      nummer:       schritt.nummer,
      name:         schritt.name,
      beschreibung: schritt.beschreibung,
      vorher,
      nachher,
      veraendert:   vorher !== nachher,
    });
    current = nachher;
  }

  const fin = finalize(current, bezeichnung);
  return { result: fin.result, schritte, sicherheitsnetzGegriffen: fin.sicherheitsnetzGegriffen };
}
