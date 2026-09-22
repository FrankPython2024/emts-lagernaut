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
 * Die Reinigungs-Schritte in fester Reihenfolge. Die Nummern erscheinen so in der
 * Import-Sandbox; wer einen Schritt einschiebt, nummeriert die folgenden mit.
 */
export const BEREINIGUNGS_SCHRITTE: BereinigungsSchritt[] = [
  {
    nummer:       1,
    name:         "Führende Sonderzeichen entfernen",
    beschreibung: 'Zeichen wie „-", „.", oder Leerzeichen ganz am Anfang werden abgeschnitten. Ein Modellname beginnt nie mit einem Satzzeichen — Beispiel: „- ThinkPad L14 Gen 2" → „ThinkPad L14 Gen 2".',
    transform: (current) =>
      // 1. Führende Nicht-Alphanumerik entfernen (kaputtes Präfix, z.B. "- ThinkPad …")
      current.replace(/^[^A-Za-z0-9]+/, ""),
  },
  {
    nummer:       2,
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
    nummer:       3,
    name:         "Vorsätze entfernen",
    beschreibung: 'Wörter wie „Notebook", „Laptop" oder die Business-Familie („Business-NB", „Business-Tablet", …) am Anfang werden gestrichen.',
    transform: (current) =>
      // 3. Marketing-Präfixe entfernen — Business-<Wort> verallgemeinert
      //    (Business-NB / -Convertible / -Laptop / -Tablet / künftige Varianten)
      current.replace(
        /^(Business-[A-Za-zÄÖÜäöü]+|Notebook\s+Pc?|Notebook\b|Laptop\b)\s+/i,
        "",
      ).trim(),
  },
  {
    nummer:       4,
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
    nummer:       5,
    name:         "Einzelbuchstabe in Klammern entfernen",
    beschreibung: 'Ein einzelner Großbuchstabe in Klammern am Ende wie „(F)" oder „(A)" wird entfernt.',
    transform: (current) =>
      // 4. Einzelbuchstabe in Klammern am Ende: "(F)", "(A)"
      //    "Latitude 7490 (F)" → "Latitude 7490"
      current.replace(/\s*\([A-Z]\)\s*$/, "").trim(),
  },
  {
    nummer:       6,
    name:         "Varianten-Suffix entfernen",
    beschreibung: 'Zusätze wie „und G5", „/ G5" oder „& G5" am Ende werden gestrichen.',
    transform: (current) =>
      // 5. "und/& GX" / "/ GX" am Ende entfernen (HP-Varianten-Suffix)
      //    "ProBook 650 G4 und G5" → "ProBook 650 G4"
      current.replace(/\s+(?:und|\/|&)\s+G\d+\s*$/i, "").trim(),
  },
  {
    nummer:       7,
    name:         "Betriebssystem-Zusatz entfernen",
    beschreibung: 'Ein angehängtes Betriebssystem wie „Win11P" am Ende wird entfernt — es gehört nicht zum Modellnamen.',
    transform: (current) =>
      // "… 16GB 250GB SSD CAM BL Win11P" → "… 16GB 250GB SSD CAM BL"
      // Kommt in den Lagerfuchs-Bezeichnungen als Win11P/Win10P/Win11H vor.
      current.replace(/\s+Win\s?\d{1,2}\s?[A-Za-z]{0,3}$/i, "").trim(),
  },
  {
    nummer:       8,
    name:         "Interne Codes entfernen",
    beschreibung: 'Lange interne Codes am Ende (6+ GROSSBUCHSTABEN/Ziffern, mindestens eine Ziffer) werden entfernt — Modell-Nummern wie 7530, T14s oder M3800 und Namenszusätze wie „Detachable" bleiben erhalten.',
    transform: (current) => {
      // 6. Interne Codes am Ende entfernen (Lenovo-Stil: 6+ Zeichen, nur GROSSBUCHSTABEN + Ziffern)
      //    "ThinkPad T14 Gen 2i 20W1S06V00" → "ThinkPad T14 Gen 2i"
      //    NICHT: "7530" (4 Zeichen), "T14s" (4 Zeichen), "M3800" (5 Zeichen)
      //    Der Bug in der alten Version: {4,} hat "7530" fälschlich entfernt!
      //
      // ⚠️ KEIN `i`-Flag und PFLICHT-Ziffer. Mit `i` traf die Regel jedes Wort ab
      //    6 Buchstaben am Ende: Am 22.09.2026 standen deshalb 1.111 Geräte unter
      //    einem fremden Modellnamen — „Latitude 7320 Detachable" hieß „Latitude
      //    7320" (234×), dazu „ZBook Fury 15 G7 Mobile Workstation" (292×),
      //    „Elite x2 G8 Tablet" (138×) und die „Rugged"-Reihe. Folge: Neun
      //    Anfragen zu Detachables wurden auf Teile des normalen 7320 gebucht,
      //    und der Teilespender schlug fremde Modelle vor. Die Ziffern-Pflicht
      //    hält zusätzlich reine Großschreib-Wörter wie „TABLET" heraus.
      //    Bekannte Restlücke: Codes mit Kleinbuchstaben am Ende („21C2L14gen",
      //    1 Gerät) bleiben stehen — lieber ein Code zu viel als ein Modellname
      //    zu wenig.
      let prev   = "";
      let result = current;
      while (prev !== result) {
        prev   = result;
        result = result.replace(/\s+(?=[-A-Z0-9]*\d)[A-Z0-9]{6,}[-A-Z0-9]*$/, "").trim();
      }
      return result;
    },
  },
  {
    nummer:       9,
    name:         "Leerzeichen normalisieren",
    beschreibung: "Mehrfache Leerzeichen werden zu einem einzigen zusammengefasst.",
    transform: (current) =>
      // 7. Mehrfache Leerzeichen normalisieren
      current.replace(/\s+/g, " ").trim(),
  },
];

// Bekannte Platzhalter, die nie ein echtes Modell sind (case-insensitive, getrimmt).
const PLATZHALTER = new Set(["nn", "-"]);

/**
 * Sicherheitsnetz nach den Schritten:
 *  • ist das Ergebnis leer oder kürzer als 3 Zeichen, wird die getrimmte
 *    Original-Bezeichnung zurückgegeben;
 *  • ist der so ermittelte Wert ein bekannter Platzhalter ("NN" / "-"), wird ""
 *    zurückgegeben (ungültig — getOrCreateModell wertet das als Fehler, es
 *    entsteht KEIN Modell).
 */
function finalize(result: string, bezeichnung: string): { result: string; sicherheitsnetzGegriffen: boolean } {
  // Safety: zu kurz → Original zurückgeben
  let final = result;
  let sicherheitsnetzGegriffen = false;
  if (!result || result.length < 3) {
    final = bezeichnung.trim();
    sicherheitsnetzGegriffen = true;
  }

  // Platzhalter-Schutz: bekannter Dummy-Wert → ungültig ("")
  if (PLATZHALTER.has(final.trim().toLowerCase())) {
    return { result: "", sicherheitsnetzGegriffen };
  }

  return { result: final, sicherheitsnetzGegriffen };
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
