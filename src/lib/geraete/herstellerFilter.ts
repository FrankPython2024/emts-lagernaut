// ── Hersteller-Filter ────────────────────────────────────────────────────────
// Strikte Whitelist: HP, Lenovo, Dell, Fujitsu, Microsoft (Surface).
// Blocklist verhindert Drift-Modelle (Apple, ASUS, etc.).
// Typo-Map korrigiert bekannte Schreibfehler aus CSV-Daten.

// ⚠️ Microsoft (Surface) ist seit 16.09.2026 erlaubt — die Technik repariert die
// Geräte. Vorher stand Microsoft auf der Blocklist: Der Geräte-Import übersprang
// Surface-Zeilen still, `GeraeteLookup` blieb leer und das Techniker-Portal
// meldete für eine gescannte Surface-LogID nur „LogID nicht gefunden" (gemessen:
// 3.356 Surface-Geräte im Lagerfuchs, 0 in Lagernaut).
export const ERLAUBTE_HERSTELLER_LISTE = ["HP", "Lenovo", "Dell", "Fujitsu", "Microsoft"] as const;
export type ErlaubterHersteller = typeof ERLAUBTE_HERSTELLER_LISTE[number];

// Blocklist: Hersteller die NIEMALS erlaubt sind
const BLOCKLIST: Record<string, string> = {
  apple:              "Apple — nicht im AfB-Portfolio",
  asus:               "ASUS — nicht im AfB-Portfolio",
  acer:               "Acer — nicht im AfB-Portfolio",
  dynabook:           "dynabook (Toshiba) — nicht im AfB-Portfolio",
  toshiba:            "Toshiba — nicht im AfB-Portfolio",
  wortmann:           "Wortmann — nicht im AfB-Portfolio",
  medion:             "Medion — nicht im AfB-Portfolio",
  huawei:             "Huawei — nicht im AfB-Portfolio",
  gigabyte:           "Gigabyte — nicht im AfB-Portfolio",
  panasonic:          "Panasonic — nicht im AfB-Portfolio",
  tuxedo:             "Tuxedo — nicht im AfB-Portfolio",
  bluechip:           "Bluechip — nicht im AfB-Portfolio",
  msi:                "MSI — nicht im AfB-Portfolio",
  // ⚠️ Fangen „Micro…"-Namen ab, die NICHT Microsoft sind. Ohne sie fallen sie
  // zwar auch durch (unbekannt), aber die Meldung nennt dann keinen Grund.
  microstar:          "MicroStar (MSI) — nicht im AfB-Portfolio",
  micron:             "Micron (Speicher-Hersteller) — kein Geräte-Hersteller",
  "micron technology inc": "Micron (Speicher-Hersteller) — kein Geräte-Hersteller",
  microconnect:       "MicroConnect (Zubehör) — kein Geräte-Hersteller",
  schenker:           "Schenker — nicht im AfB-Portfolio",
  telenorma:          "Telenorma — nicht im AfB-Portfolio",
  hpe:                "HPE (Server) — explizit verboten",
  nn:                 "NN — Platzhalter, kein gültiger Hersteller",
};

// Tippfehler → kanonischer Whitelist-Wert
const TYPO_FIX: Record<string, ErlaubterHersteller> = {
  "hpö":               "HP",
  "hp ö":              "HP",
  "hp250":             "HP",
  "hp compaq":         "HP",
  "hpcompaq":          "HP",
  "fujjtsu":           "Fujitsu",
  "fsc":               "Fujitsu",
  "fujitsu siemens":   "Fujitsu",
  // Der volle frühere Firmenname, wie er in echten Exporten vorkommt. Die
  // Tabelle vergleicht EXAKT — ohne diesen Eintrag fiel „Fujitsu Siemens
  // Computers" durch und das Gerät wurde beim Import als unbekannter
  // Hersteller abgewiesen.
  "fujitsu siemens computers": "Fujitsu",
  "ibm lenovo":        "Lenovo",
  "microsoft corporation": "Microsoft",
  // 17 Zeilen im Lagerfuchs schreiben sich so (Stand 16.09.2026).
  "microsft":          "Microsoft",
};

// Apple-Indikatoren in Modell-Bezeichnung (auch wenn Hersteller "Dell" lautet)
const APPLE_INDICATORS: RegExp[] = [
  /macbook/i,
  /\bA1[0-9]{3}\b/i,
  /\bA2[0-9]{3}\b/i,
  /\bM[1-4](?:\s+(?:Pro|Max|Ultra))?\b/i,
  /^Pro [0-9]+$/i,        // "Pro 14" — Apple-Modell als Dell verkleidet
  /^Pro Max [0-9]+$/i,    // "Pro Max 16" — Apple-Modell als Dell verkleidet
];

/** Welche Regel den Ausgang bestimmt hat (additiv, für die Import-Sandbox). */
export type HerstellerRegel = "leer" | "apple" | "typo" | "blocklist" | "whitelist" | "unbekannt";

export interface HerstellerCheckResult {
  erlaubt:    boolean;
  kanonisch?: ErlaubterHersteller;
  grund?:     string;
  regel?:     HerstellerRegel;
}

/**
 * Prüft Hersteller gegen Whitelist/Blocklist/Typo-Map.
 * `bezeichnung` ermöglicht Apple-Indikator-Erkennung (auch bei Hersteller "Dell").
 */
export function checkHersteller(raw: string, bezeichnung?: string): HerstellerCheckResult {
  if (!raw?.trim()) {
    return { erlaubt: false, grund: "Leerer Hersteller", regel: "leer" };
  }
  const lower = raw.trim().toLowerCase();

  // Apple-Indikator in Bezeichnung (Bypass für "Dell MacBook"-Einträge)
  if (bezeichnung) {
    for (const re of APPLE_INDICATORS) {
      if (re.test(bezeichnung)) {
        return { erlaubt: false, grund: "Apple-Indikator in Bezeichnung erkannt", regel: "apple" };
      }
    }
  }

  // Tippfehler-Korrektur
  const typoFix = TYPO_FIX[lower];
  if (typoFix) return { erlaubt: true, kanonisch: typoFix, regel: "typo" };

  // Blocklist
  const blockGrund = BLOCKLIST[lower];
  if (blockGrund) return { erlaubt: false, grund: blockGrund, regel: "blocklist" };

  // Whitelist (case-insensitive)
  const treffer = ERLAUBTE_HERSTELLER_LISTE.find((h) => h.toLowerCase() === lower);
  if (treffer) return { erlaubt: true, kanonisch: treffer, regel: "whitelist" };

  return { erlaubt: false, grund: `Unbekannter Hersteller "${raw}" — nicht in Whitelist`, regel: "unbekannt" };
}

// ── Backward-Compat-Exports ────────────────────────────────────────────────

export function normalisiereHersteller(raw: string): string | null {
  const result = checkHersteller(raw);
  return result.erlaubt && result.kanonisch ? result.kanonisch : null;
}

export function istErlaubterHersteller(raw: string): boolean {
  return checkHersteller(raw).erlaubt;
}
