// ── Hersteller-Filter ────────────────────────────────────────────────────────
// Nur Notebooks von HP, Lenovo, Dell und Fujitsu werden importiert.
// Tippfehler und Varianten aus echten Daten werden normalisiert.

const ERLAUBTE_HERSTELLER: Record<string, RegExp[]> = {
  HP: [
    /^hp$/i,
    /^hp\s+compaq$/i,
    /^hpö$/i,          // Tippfehler aus echten CSV-Daten
  ],
  Lenovo: [
    /^lenovo$/i,
    /^ibm\s+lenovo$/i, // alte IBM-Marke
  ],
  Dell: [
    /^dell$/i,
  ],
  Fujitsu: [
    /^fujitsu$/i,
    /^fujjtsu$/i,             // Tippfehler aus echten CSV-Daten
    /^fujitsu\s+siemens.*$/i, // FSC
    /^fsc$/i,
  ],
};

// Server-Hardware — ausdrücklich NICHT akzeptiert
const EXPLIZIT_ABGELEHNT: RegExp[] = [
  /^hpe$/i,
  /hewlett\s+packard\s+enterprise/i,
];

/**
 * Normalisiert einen Herstellernamen auf den kanonischen Wert
 * oder gibt null zurück wenn der Hersteller nicht erlaubt ist.
 */
export function normalisiereHersteller(raw: string): string | null {
  if (!raw?.trim()) return null;

  const trimmed = raw.trim();

  for (const pattern of EXPLIZIT_ABGELEHNT) {
    if (pattern.test(trimmed)) return null;
  }

  for (const [normalisiert, patterns] of Object.entries(ERLAUBTE_HERSTELLER)) {
    for (const pattern of patterns) {
      if (pattern.test(trimmed)) return normalisiert;
    }
  }

  return null;
}

export function istErlaubterHersteller(raw: string): boolean {
  return normalisiereHersteller(raw) !== null;
}

// Kanonische Liste für DB-Abfragen ("NOT IN (...)") und UI-Anzeige
export const ERLAUBTE_HERSTELLER_LISTE = ["HP", "Lenovo", "Dell", "Fujitsu"] as const;
export type ErlaubterHersteller = typeof ERLAUBTE_HERSTELLER_LISTE[number];
