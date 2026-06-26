// ── Mobil-Ersatzteile — Bezeichnungs-Parser ─────────────────────────────────
//
// Reine Logik, KEIN DB-Zugriff, vollständig testbar. Leitet aus dem Freitext-
// Feld "Bezeichnung" Hersteller + Modell(e) + Teiltyp ab.
//
// GRUNDREGEL: Es wird NICHTS geraten. Nur eindeutige Treffer gelten als
// "sicher" (Hersteller UND genau EIN Modell UND Teiltyp). Alles andere ist
// REVIEW. Mehrere kompatible Modelle ("12 / 12 Pro") sind ein eigener Fall
// (mehrfachModell) — erkannt, aber nicht eindeutig EINEM Modell zuordenbar.
//
// Die echte CSV (AfB/ReForm-Export) hat drei wichtige Eigenheiten, die hier
// bewusst behandelt werden:
//   1. Viele Akku-Zeilen nennen das Modell OHNE das Wort "iPhone" und mit
//      angeklebtem Suffix:  "Diagnostic Battery 13Pro 3095mAh ...",
//      "... 12ProMax ...", "... 13Mini ...".  → Hersteller wird dann aus dem
//      erkannten Modell abgeleitet.
//   2. Mehrfach-Modelle über diverse Trenner: "12 / 12 Pro", "12/12 Pro",
//      "14 Pro/ 14 Pro Max", "12 and iPhone 12 Pro", "iPhone 8 & iPhone SE
//      (2020 & 2022)".
//   3. Zeilenumbrüche mitten im Text und Tippfehler ("Camerglass").

export type MobilHersteller = "Apple" | "Samsung" | "Google" | "Xiaomi";

// Kanonische Teiltyp-Namen (erweiterbar). Spiegeln die später in MobilTeiltyp
// gepflegten `name`-Werte.
export const MOBIL_TEILTYPEN = [
  "Akku",
  "Display",
  "Displaymodul",
  "Digitizer",
  "Kameraglas",
  "Backcover",
  "Middle Frame",
  "SIM-Tray",
] as const;
export type MobilTeiltyp = (typeof MOBIL_TEILTYPEN)[number];

export type MobilZuordnung = {
  hersteller:     MobilHersteller | null;
  modelle:        string[];            // 0 = unbekannt, 1 = eindeutig, >1 = Mehrfach-Modell
  modell:         string | null;       // nur gesetzt, wenn GENAU ein Modell erkannt
  teiltyp:        MobilTeiltyp | null;  // null = nicht erkannt ODER mehrdeutig
  sicher:         boolean;              // hersteller && genau 1 Modell && teiltyp
  mehrfachModell: boolean;              // modelle.length > 1
  quelle:         "alias" | "regel";    // woher die Zuordnung stammt
};

// Gelernte Zuordnung (MobilAlias). Im Trockenlauf leer — nur Struktur.
export type MobilAliasTreffer = {
  hersteller: MobilHersteller;
  modell:     string;
  teiltyp:    MobilTeiltyp;
};

// ── 1. Normalisierung ────────────────────────────────────────────────────────
// Typografische Anführungszeichen/Bindestriche → ASCII, Zeilenumbrüche/Tabs/
// Mehrfach-Spaces raus, trim, lower für Matching. (Quotes/Dashes vereinheitlichen,
// damit z. B. 10.5”  und  10,5"  oder – —  beim Matching gleich behandelt werden.)
export function bezeichnungNormalisieren(roh: string): string {
  return (roh ?? "")
    .replace(/[‘’‚‛]/g, "'")   // ‘ ’ ‚ ‛ → '
    .replace(/[“”„‟]/g, '"')   // “ ” „ ‟ → "
    .replace(/[–—−]/g, "-")          // – — − → -
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// ── 2. Hersteller (rein keyword-basiert, wie spezifiziert) ───────────────────
export function herstellerErkennen(norm: string): MobilHersteller | null {
  if (/\b(?:iphone|ipad|ipod)\b/.test(norm)) return "Apple";
  if (/\bsamsung\b/.test(norm) || /\bgalaxy\b/.test(norm) || /\bsm-[a-z]?\d/.test(norm)) return "Samsung";
  if (/\bpixel\b/.test(norm) || /\bgoogle\b/.test(norm)) return "Google";
  if (/\b(?:xiaomi|redmi|poco)\b/.test(norm)) return "Xiaomi";
  return null;
}

// ── 3. Modell ────────────────────────────────────────────────────────────────
export function modellErkennen(norm: string, hersteller: MobilHersteller): string[] {
  switch (hersteller) {
    case "Apple":   return /\bipad\b/.test(norm) ? ipadModelle(norm) : iphoneModelle(norm);
    case "Samsung": return samsungModelle(norm);
    case "Google":  return googleModelle(norm);
    case "Xiaomi":  return xiaomiModelle(norm);
  }
}

// iPhone: nummerierte Modelle (8–16) + X-Familie + SE. Global gescannt, damit
// Mehrfach-Nennungen ("12 / 12 Pro") und keyword-freie Zeilen funktionieren.
export function iphoneModelle(norm: string): string[] {
  return eindeutig([...iphoneNummern(norm), ...iphoneXFamilie(norm), ...iphoneSe(norm)]);
}

function iphoneNummern(norm: string): string[] {
  const out: string[] = [];
  // \b sorgt dafür, dass Referenznummern (rwip101753) und mAh-Werte (3279mah,
  // 4-stellig) NICHT als Modell durchrutschen. Suffix darf angeklebt sein.
  const re = /\b(1[0-6]|[89])\s*(pro\s*max|pro|plus|mini|max)?\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(norm)) !== null) out.push(`iPhone ${m[1]}${variantenSuffix(m[2])}`);
  return out;
}

function iphoneXFamilie(norm: string): string[] {
  const out: string[] = [];
  const re = /\bx(s\s*max|s|r)?\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(norm)) !== null) {
    const t = (m[1] ?? "").replace(/\s+/g, "");
    if (t === "smax")   out.push("iPhone XS Max");
    else if (t === "s") out.push("iPhone XS");
    else if (t === "r") out.push("iPhone XR");
    else                out.push("iPhone X");
  }
  return out;
}

function iphoneSe(norm: string): string[] {
  const out: string[] = [];
  // se + optional (…), Jahr oder "N. Generation". Mehrere Jahre in einer
  // Klammer ("(2020 & 2022)") ergeben mehrere Modelle.
  const re = /\bse\b\s*(\([^)]*\)|\d{4}|\d\.?\s*generation|\d)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(norm)) !== null) {
    const tail  = m[1] ?? "";
    const jahre = [...tail.matchAll(/(20\d{2})/g)].map((x) => x[1]);
    const gens  = [...tail.matchAll(/(\d)\.?\s*generation/g)].map((x) => x[1]);
    if (jahre.length)      jahre.forEach((j) => out.push(`iPhone SE (${j})`));
    else if (gens.length)  gens.forEach((g) => out.push(`iPhone SE (${g}. Generation)`));
    else                   out.push("iPhone SE");
  }
  return out;
}

function variantenSuffix(v: string | undefined): string {
  if (!v) return "";
  const k = v.replace(/\s+/g, "").toLowerCase();
  if (k === "promax") return " Pro Max";
  if (k === "pro")    return " Pro";
  if (k === "plus")   return " Plus";
  if (k === "mini")   return " mini";
  if (k === "max")    return " Max";
  return "";
}

// iPad-Air-Generation aus expliziten Signalen ableiten (konservativ):
//   • explizite "N. Generation" / "Nth gen" (N=2–5)
//   • Bildschirmgröße 10.5" → Air 3 (eindeutig)
//   • M1 → Air 5
// 10.9" ALLEIN ist mehrdeutig (Air 4 ODER 5) → daraus wird NICHTS abgeleitet
// (nur über die explizite Generation); 9.7" (Air 1/2) ebenfalls nicht. Ohne Signal "".
function ipadAirGeneration(norm: string): string {
  // "N. Generation" / "N.Generation" (ohne Space) / "Nth gen" — N=2–5.
  const g = norm.match(/\b([2-5])\s*\.?\s*(?:te|st|nd|rd|th)?\s*gen(?:eration)?\b/);
  if (g) return g[1];
  if (/\b10[.,]5\b/.test(norm)) return "3"; // Größe 10.5"/10,5" eindeutig Air 3
  if (/\bm1\b/.test(norm))      return "5";
  return ""; // 10.9" (Air 4/5) ist ohne explizite Generation mehrdeutig → generisch
}

function ipadModelle(norm: string): string[] {
  const out: string[] = [];
  // Bei "air"/"mini" nur eine EINZELNE Generationsziffer mitnehmen (nicht die erste
  // Ziffer einer Größe wie 10.9" → sonst fälschlich "Air 1").
  const re = /ipad\s+(pro\s*\d{1,2}(?:[.,]\d)?|air(?:\s*\d(?!\d|[.,]\d))?|mini(?:\s*\d(?!\d|[.,]\d))?|\d{1,2}[.,]\d)\s*(?:\(\s*(20\d{2}))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(norm)) !== null) {
    const teil = m[1].replace(/\s+/g, " ").trim();
    const jahr = m[2] ? ` (${m[2]})` : "";
    let label: string;
    if (teil.startsWith("pro")) {
      const groesse = teil.replace(/^pro\s*/, "").trim();          // z. B. "11"
      label = groesse ? `iPad Pro ${groesse}"` : "iPad Pro";
    } else if (teil.startsWith("air")) {
      // Explizite Ziffer aus "air 2"/"air2"; sonst aus Generation/Größe/M1 ableiten.
      let gen = teil.replace(/^air\s*/, "").trim();
      if (!gen) gen = ipadAirGeneration(norm);
      label = gen ? `iPad Air ${gen}` : "iPad Air"; // ohne Signal generisch (nicht raten)
    } else if (teil.startsWith("mini")) {
      const gen = teil.replace(/^mini\s*/, "").trim();
      label = gen ? `iPad mini ${gen}` : "iPad mini";
    } else {
      label = `iPad ${teil.replace(",", ".")}"`;                  // z. B. "10.2" / "10,2"
    }
    out.push(`${label}${jahr}`);
  }
  return eindeutig(out);
}

function samsungModelle(norm: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  // Galaxy S-Serie — Modellnummer S<N> (N=8..24), das "Galaxy"-Wort davor ist OPTIONAL.
  // Deckt damit auch "Samsung S21+" (ohne "Galaxy") ab und ergänzt das bisherige
  // "Galaxy S22". Suffix ausgeschrieben/einheitlich; angeklebtes "+" zählt als Plus
  // (S21 und S21+ sind VERSCHIEDENE Modelle!). (?!\d) verhindert, dass 3-stellige
  // SM-Codes ("SM-S908") als S9/S90 fehlgelesen werden.
  const reS = /\bs(8|9|1\d|2[0-4])(?!\d)\s*(ultra|plus|fe|\+)?/g;
  while ((m = reS.exec(norm)) !== null) {
    const v      = (m[2] ?? "").trim();
    const suffix = v === "ultra" ? " Ultra" : v === "plus" || v === "+" ? " Plus" : v === "fe" ? " FE" : "";
    out.push(`Galaxy S${m[1]}${suffix}`);
  }
  // Galaxy A/N/M/J-Serien — nur MIT "Galaxy"-Keyword (einzelner Buchstabe+Zahl wäre
  // ohne Keyword zu mehrdeutig).
  const reSerie = /galaxy\s+([anmj])\s*(\d{1,3})\s*(ultra|plus|\+|fe)?/g;
  while ((m = reSerie.exec(norm)) !== null) {
    const serie  = `${m[1].toUpperCase()}${m[2]}`;
    const suffix = m[3] === "ultra" ? " Ultra" : m[3] === "plus" || m[3] === "+" ? " Plus" : m[3] === "fe" ? " FE" : "";
    out.push(`Galaxy ${serie}${suffix}`);
  }
  // Galaxy Z Fold / Z Flip
  const reZ = /galaxy\s+z\s*(fold|flip)\s*(\d)?/g;
  while ((m = reZ.exec(norm)) !== null) {
    out.push(`Galaxy Z ${m[1] === "fold" ? "Fold" : "Flip"}${m[2] ? " " + m[2] : ""}`);
  }
  // Galaxy Note
  const reN = /galaxy\s+note\s*(\d{1,2})\s*(ultra|plus|\+)?/g;
  while ((m = reN.exec(norm)) !== null) {
    const suffix = m[2] === "ultra" ? " Ultra" : m[2] === "plus" || m[2] === "+" ? " Plus" : "";
    out.push(`Galaxy Note ${m[1]}${suffix}`);
  }
  return eindeutig(out);
}

function googleModelle(norm: string): string[] {
  const out: string[] = [];
  const re = /pixel\s*(\d{1,2})\s*(a|pro\s*xl|pro|xl)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(norm)) !== null) {
    const v = (m[2] ?? "").replace(/\s+/g, "");
    const suffix = v === "a" ? "a" : v === "proxl" ? " Pro XL" : v === "pro" ? " Pro" : v === "xl" ? " XL" : "";
    out.push(`Pixel ${m[1]}${suffix}`);
  }
  return eindeutig(out);
}

function xiaomiModelle(norm: string): string[] {
  const out: string[] = [];
  const re = /(redmi\s*note|redmi|poco|mi)\s*(\d{1,3}[a-z]?)\s*(pro\s*plus|pro|plus|ultra|max)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(norm)) !== null) {
    const basis  = m[1].includes("note") ? "Redmi Note" : m[1] === "redmi" ? "Redmi" : m[1] === "poco" ? "Poco" : "Mi";
    const v      = (m[3] ?? "").replace(/\s+/g, "");
    const suffix = v === "proplus" ? " Pro+" : v === "pro" ? " Pro" : v === "plus" ? " Plus" : v === "ultra" ? " Ultra" : v === "max" ? " Max" : "";
    out.push(`${basis} ${m[2].toUpperCase()}${suffix}`);
  }
  return eindeutig(out);
}

// ── 4. Teiltyp ───────────────────────────────────────────────────────────────
// Regelwerk. Mehrdeutigkeit (zwei verschiedene Teiltypen in derselben Zeile)
// → bewusst null (REVIEW, nichts raten).
//
// Digitizer vs. Display: Ein reines Touch-Glas ("Digitizer", "Touch Glass") ist
// ein eigener Teiltyp. Eine KOMPLETTE Display-Einheit (mit Panel — lcd/oled/
// display/…assembly) bleibt "Display", auch wenn das Wort "digitizer" darin
// vorkommt (z. B. "LCD Display Touchscreen Digitizer Assembly"). Beide Regeln
// schließen sich über `istReinDigitizer` gegenseitig aus → nie beide gleichzeitig.

// Marker einer kompletten Display-Einheit (Panel vorhanden).
const KOMPLETT_DISPLAY = /lcd|oled|display assembly|screen assembly|\bdisplay\b/;
// Reines Touch-Glas: Digitizer/Touch-Glass-Wort UND kein Komplett-Display-Marker.
function istReinDigitizer(norm: string): boolean {
  return /digitizer|touch\s?glass|touchscreen glass/.test(norm) && !KOMPLETT_DISPLAY.test(norm);
}
// Display-/Screen-Familie (Panel/Touch). Modul-Marker = komplette Einheit.
const DISPLAY_FAMILIE = /oled|lcd|touchscreen|display|bildschirm|screen|digitizer/;
// Modul-Marker: "module"/"modul" (auch geklebt: "displaymodul[e]"), "assembly"
// (auch "displayassembly"), "einheit" (nur als eigenes Wort → NICHT "bildschirmeinheit").
const MODUL_MARKER = /modul|assembly|\beinheit\b/;

// Reihenfolge/Abgrenzung (alle gegenseitig ausschließend → genau ein Treffer):
//   1) Digitizer  = reines Touch-Glas (kein Panel). Geht VOR Modul/Display.
//   2) Displaymodul = Display-/Screen-Familie + Modul-Marker (komplette Einheit).
//   3) Display    = Display-/Screen-Familie OHNE Modul-Marker (reines Panel/LCD/OLED).
const TEILTYP_REGELN: { teiltyp: MobilTeiltyp; test: (norm: string) => boolean }[] = [
  { teiltyp: "Akku",         test: (n) => /\bakku\b|batter(?:y|ies|ie)|diagnostizierbar/.test(n) },
  { teiltyp: "Digitizer",    test: (n) => istReinDigitizer(n) },
  { teiltyp: "Displaymodul", test: (n) => DISPLAY_FAMILIE.test(n) && MODUL_MARKER.test(n) && !istReinDigitizer(n) },
  { teiltyp: "Display",      test: (n) => DISPLAY_FAMILIE.test(n) && !MODUL_MARKER.test(n) && !istReinDigitizer(n) },
  { teiltyp: "Kameraglas",   test: (n) => /camera glass(?:es)?|camera lens(?:es)?|camerglass|kamera\s?glas/.test(n) },
  { teiltyp: "Backcover",    test: (n) => /back\s?glass|rear cover|back\s?cover/.test(n) },
  { teiltyp: "Middle Frame", test: (n) => /middle\s?frame|mittelrahmen/.test(n) },
  { teiltyp: "SIM-Tray",     test: (n) => /sim[-\s]?tray|sim[-\s]?slot|sim[-\s]?karten?/.test(n) },
];

export function teiltypenErkennen(norm: string): MobilTeiltyp[] {
  return TEILTYP_REGELN.filter((r) => r.test(norm)).map((r) => r.teiltyp);
}

export function teiltypErkennen(norm: string): MobilTeiltyp | null {
  const treffer = teiltypenErkennen(norm);
  if (treffer.length === 1) return treffer[0];
  // Konflikt Display ↔ Backcover („letztes Schlüsselwort gewinnt"): ein echter
  // Backcover-/Rear-Cover-Marker überstimmt ein vorangestelltes „Display for …"
  // (z. B. „Display for … Back Cover Phantom black" → Backcover). Nur dieser
  // Konflikt wird aufgelöst — sonst bleibt Mehrdeutigkeit bewusst null (REVIEW).
  if (treffer.includes("Backcover") &&
      treffer.every((t) => t === "Backcover" || t === "Display" || t === "Displaymodul")) {
    return "Backcover";
  }
  return null; // 0 = unbekannt, >1 = mehrdeutig (nicht raten)
}

// ── 4b. Farbe ─────────────────────────────────────────────────────────────────
// DE/EN-Farben, NUR an Wortgrenzen (kein Teilwort-Treffer). Rückgabe normalisiert
// auf den DE-Begriff. Erster Treffer in dieser Reihenfolge gewinnt (relevant nur
// bei Mehrfach-Farben wie "Blue/Green" → erster = blau). Kein Treffer → null.
// Reihenfolge: zusammengesetzte/spezielle zuerst (space gray, midnight, starlight).
const FARBEN: { name: string; muster: RegExp }[] = [
  { name: "grau",       muster: /\bspace\s?gr[ae]y\b|\bgrau\b|\bgr[ae]y\b/ },
  { name: "starlight",  muster: /\bstarlight\b|\bpolarstern\b/ },
  { name: "mitternacht", muster: /\bmidnight\b|\bmitternacht\b/ },
  { name: "schwarz",    muster: /\bschwarz\b|\bblack\b/ },
  // Kein trailing \b nach "ß" (ß ist kein ASCII-Wortzeichen → \b würde dort scheitern).
  { name: "weiß",       muster: /\bweiß|\bweiss\b|\bwhite\b/ },
  { name: "silber",     muster: /\bsilber\b|\bsilver\b/ },
  { name: "gold",       muster: /\bgold\b/ },
  { name: "blau",       muster: /\bblau\b|\bblue\b/ },
  { name: "grün",       muster: /\bgr[üu]n\b|\bgruen\b|\bgreen\b/ },
  { name: "rot",        muster: /\brot\b|\bred\b/ },
  { name: "rosa",       muster: /\brosa\b|\bpink\b|\brose\b/ },
  { name: "lila",       muster: /\blila\b|\bviolett\b|\bpurple\b/ },
  { name: "gelb",       muster: /\bgelb\b|\byellow\b/ },
];

export function farbeErkennen(rohBezeichnung: string): string | null {
  const norm = bezeichnungNormalisieren(rohBezeichnung);
  for (const f of FARBEN) if (f.muster.test(norm)) return f.name;
  return null;
}

// ── 4c. Keyword-freie Hersteller+Modell-Erkennung (mit Fehltreffer-Schutz) ────
// Manche Lieferanten-Wortlaute nennen KEIN Hersteller-Keyword, nur die angeklebte
// Modellnummer: "Diagnostic Battery 13Pro …" (iPhone), "Backcover with Glue S22 …"
// (Samsung). Diese Funktion leitet Hersteller+Modell daraus ab — aber NUR streng
// abgesichert, damit keine Fremd-Hersteller-Zeile fälschlich zu Apple/Samsung wird.

// Fremd-Hersteller-Keywords: stehen sie im Text, wird NICHTS keyword-frei abgeleitet.
// (Verhindert "Redmi Note 11"→iPhone 11 und "Pixel 8"→iPhone 8 — Audit K1/M2.)
const FREMD_KEYWORD = /\b(?:iphone|ipad|ipod|samsung|galaxy|pixel|google|xiaomi|redmi|poco)\b|\bsm-/;

// Plausibilität: „sieht nach Ersatzteil aus" — verhindert, dass eine beliebige Zahl
// ein Modell erfindet. Greift zusammen mit dem Suffix-Signal unten (Audit M2).
const TEIL_KEYWORD = /batter|akku|display|screen|lcd|oled|touchscreen|digiti[sz]er|back\s?cover|back\s?glass|rear\s?cover|\bcover\b|camera|kamera|glas|frame|rahmen|\bsim\b|modul|assembly|einheit|bildschirm|lens/;

// Eindeutiges Modellsignal: Modellnummer MIT Suffix (z. B. "13Pro", "S20 Ultra").
const IPHONE_NUM_SUFFIX = /\b(?:1[0-6]|[89])\s*(?:pro\s*max|pro|plus|mini)\b/;
const GALAXY_S_SUFFIX   = /\bs\d{1,2}\s*(?:ultra|plus|fe|\+)/;

// Galaxy-S-Serie OHNE "galaxy"-Keyword: "S22"→Galaxy S22, "S20 Ultra"→Galaxy S20 Ultra,
// "S10+"→Galaxy S10 Plus. `(?!\d)` verhindert, dass aus "S908"-artigen Codes ein Modell
// wird; das fehlende abschließende \b lässt das angeklebte "+" als Plus-Suffix zu.
function galaxyOhneKeyword(norm: string): string[] {
  const out: string[] = [];
  const re = /\bs(\d{1,2})(?!\d)\s*(ultra|plus|fe|\+)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(norm)) !== null) {
    const v = (m[2] ?? "").trim();
    const suffix = v === "ultra" ? " Ultra" : v === "plus" || v === "+" ? " Plus" : v === "fe" ? " FE" : "";
    out.push(`Galaxy S${m[1]}${suffix}`);
  }
  return eindeutig(out);
}

export function keywordFreieErkennung(
  norm: string,
): { hersteller: MobilHersteller; modelle: string[] } | null {
  // HARTE Vorbedingung: kein anderes Hersteller-Keyword im Text (sonst kein Raten).
  if (FREMD_KEYWORD.test(norm)) return null;
  const teilHinweis = TEIL_KEYWORD.test(norm);

  // 1) iPhone — nur die nummerierten Modelle (8/9/10–16). KEINE X-Familie/SE keyword-frei
  //    (ein freistehendes "x" wäre ein Fehltreffer-Magnet). Plausibel, wenn der Text nach
  //    Teil aussieht ODER die Nummer ein Suffix trägt.
  const iphone = iphoneNummern(norm);
  if (iphone.length > 0 && (teilHinweis || IPHONE_NUM_SUFFIX.test(norm))) {
    return { hersteller: "Apple", modelle: eindeutig(iphone) };
  }

  // 2) Samsung Galaxy S-Serie (die \b-Lücke in iphoneNummern verhindert, dass die an "s"
  //    geklebten Ziffern oben als iPhone-Nummer gelesen werden → hier landet z. B. "S22").
  const galaxy = galaxyOhneKeyword(norm);
  if (galaxy.length > 0 && (teilHinweis || GALAXY_S_SUFFIX.test(norm))) {
    return { hersteller: "Samsung", modelle: galaxy };
  }
  return null;
}

// ── 5. Gesamt-Zuordnung ──────────────────────────────────────────────────────
export function zuordnen(
  rohBezeichnung: string,
  aliase?: Map<string, MobilAliasTreffer>,
): MobilZuordnung {
  const norm = bezeichnungNormalisieren(rohBezeichnung);

  // (a) Alias-Lookup auf exaktem Normwortlaut — im Trockenlauf leer, nur Struktur.
  const alias = aliase?.get(norm);
  if (alias) {
    return {
      hersteller:     alias.hersteller,
      modelle:        [alias.modell],
      modell:         alias.modell,
      teiltyp:        alias.teiltyp,
      sicher:         true,
      mehrfachModell: false,
      quelle:         "alias",
    };
  }

  // (b) Regelwerk.
  let hersteller = herstellerErkennen(norm);
  let modelle: string[];
  if (hersteller) {
    modelle = modellErkennen(norm, hersteller);
  } else {
    // Keyword-frei (z. B. "Diagnostic Battery 13Pro …" oder "Backcover … S22 …"):
    // Hersteller+Modell aus der angeklebten Modellnummer ableiten — streng abgesichert
    // (kein Fremd-Hersteller-Keyword, plausibler Teil-Kontext). Kein Raten.
    const kf = keywordFreieErkennung(norm);
    if (kf) {
      hersteller = kf.hersteller;
      modelle    = kf.modelle;
    } else {
      modelle = [];
    }
  }

  const teiltyp = teiltypErkennen(norm);
  const sicher  = !!hersteller && modelle.length === 1 && !!teiltyp;

  return {
    hersteller,
    modelle,
    modell:         modelle.length === 1 ? modelle[0] : null,
    teiltyp,
    sicher,
    mehrfachModell: modelle.length > 1,
    quelle:         "regel",
  };
}

// Duplikate entfernen, Reihenfolge erhalten.
function eindeutig(xs: string[]): string[] {
  return [...new Set(xs)];
}
