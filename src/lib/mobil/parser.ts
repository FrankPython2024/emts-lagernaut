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
// Zeilenumbrüche/Tabs/Mehrfach-Spaces raus, trim, lower für Matching.
export function bezeichnungNormalisieren(roh: string): string {
  return (roh ?? "")
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

function ipadModelle(norm: string): string[] {
  const out: string[] = [];
  const re = /ipad\s+(pro\s*\d{1,2}(?:\.\d)?|air(?:\s*\d)?|mini(?:\s*\d)?|\d{1,2}\.\d)\s*(?:\(\s*(20\d{2}))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(norm)) !== null) {
    const teil = m[1].replace(/\s+/g, " ").trim();
    const jahr = m[2] ? ` (${m[2]})` : "";
    let label: string;
    if (teil.startsWith("pro")) {
      const groesse = teil.replace(/^pro\s*/, "").trim();          // z. B. "11"
      label = groesse ? `iPad Pro ${groesse}"` : "iPad Pro";
    } else if (teil.startsWith("air")) {
      const gen = teil.replace(/^air\s*/, "").trim();
      label = gen ? `iPad Air ${gen}` : "iPad Air";
    } else if (teil.startsWith("mini")) {
      const gen = teil.replace(/^mini\s*/, "").trim();
      label = gen ? `iPad mini ${gen}` : "iPad mini";
    } else {
      label = `iPad ${teil}"`;                                     // z. B. "10.2"
    }
    out.push(`${label}${jahr}`);
  }
  return eindeutig(out);
}

function samsungModelle(norm: string): string[] {
  const out: string[] = [];
  const re = /galaxy\s+([sanmj])\s*(\d{1,3})\s*(ultra|plus|\+|fe)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(norm)) !== null) {
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
const TEILTYP_REGELN: { teiltyp: MobilTeiltyp; muster: RegExp }[] = [
  { teiltyp: "Akku",         muster: /\bakku\b|batter(?:y|ies|ie)|diagnostizierbar/ },
  { teiltyp: "Display",      muster: /oled|lcd|touchscreen|digitizer|display|bildschirmeinheit|screen assembly|\bscreen\b/ },
  { teiltyp: "Kameraglas",   muster: /camera glass(?:es)?|camera lens(?:es)?|camerglass|kamera\s?glas/ },
  { teiltyp: "Backcover",    muster: /back\s?glass|rear cover|back\s?cover/ },
  { teiltyp: "Middle Frame", muster: /middle\s?frame|mittelrahmen/ },
  { teiltyp: "SIM-Tray",     muster: /sim[-\s]?tray|sim[-\s]?slot|sim[-\s]?karten?/ },
];

export function teiltypenErkennen(norm: string): MobilTeiltyp[] {
  return TEILTYP_REGELN.filter((r) => r.muster.test(norm)).map((r) => r.teiltyp);
}

export function teiltypErkennen(norm: string): MobilTeiltyp | null {
  const treffer = teiltypenErkennen(norm);
  return treffer.length === 1 ? treffer[0] : null; // 0 = unbekannt, >1 = mehrdeutig
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
    // Keyword-frei (z. B. "Diagnostic Battery 13Pro …"): aus dem iPhone-Modell
    // den Hersteller ableiten. Das ist kein Raten — "13Pro" ist eindeutig.
    modelle = iphoneModelle(norm);
    if (modelle.length > 0) hersteller = "Apple";
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
