// ── Entsorgung: die zwei Bereiche ────────────────────────────────────────────
//
// Schrottabholung und Batterietransport sind derselbe Vorgang: Behälter
// erfassen, Gewichte summieren, Tabelle an den Entsorger schicken. Sie
// unterscheiden sich in drei Dingen — wie der Behälter heißt, wie viele auf
// eine Ladung gehen, und welche Abfallarten zur Auswahl stehen.
//
// ⚠️ Diese Datei ist die EINZIGE Stelle, an der das steht. Server und
// Oberfläche lesen beide hier — sonst driften Beschriftung und Grenzwert
// auseinander, und die Warnung stimmt nicht mehr mit dem überein, was auf dem
// Hof passiert.

export type BereichKey = "SCHROTT" | "BATTERIE";

export type BereichInfo = {
  key: BereichKey;
  /** Überschrift und Navigationseintrag. */
  titel: string;
  icon: string;
  pfad: string;
  /** Wie ein Behälter heißt — Einzahl und Mehrzahl. */
  einheit: string;
  einheitMehrzahl: string;
  /**
   * Kapazität einer Ladung.
   *
   * SCHROTT: ein Colli belegt einen LKW-Stellplatz, 33 passen drauf.
   * BATTERIE: 6 Fässer gehen auf eine Palette; die Zahl der Paletten ergibt
   * sich daraus. Wie viele Paletten auf den LKW gehen, ist hier nicht
   * hinterlegt — danach wurde nicht gefragt.
   */
  proLadung: number;
  /** Wie die Einheit der Ladung heißt („Stellplätze", „Paletten"). */
  ladungName: string;
  /** Wird die Ladungszahl gerechnet (Fässer/6) oder ist sie die Stückzahl? */
  ladungGerechnet: boolean;
  /** Nur beim Batterietransport: die UN-Nummer steht auf dem Fass. */
  mitUnNummer: boolean;
};

export const BEREICHE: Record<BereichKey, BereichInfo> = {
  SCHROTT: {
    key:             "SCHROTT",
    titel:           "Schrottabholung",
    icon:            "♻️",
    pfad:            "/admin/schrott",
    einheit:         "Colli",
    einheitMehrzahl: "Collis",
    proLadung:       33,
    ladungName:      "Stellplätze",
    ladungGerechnet: false,
    mitUnNummer:     false,
  },
  BATTERIE: {
    key:             "BATTERIE",
    titel:           "Batterietransport",
    icon:            "🔋",
    pfad:            "/admin/batterien",
    einheit:         "Fass",
    einheitMehrzahl: "Fässer",
    proLadung:       6,
    ladungName:      "Paletten",
    ladungGerechnet: true,
    mitUnNummer:     true,
  },
};

/**
 * Wie viele Ladungseinheiten belegt diese Anzahl Behälter?
 *
 * Beim Schrott ist das die Stückzahl selbst (ein Colli = ein Stellplatz), bei
 * den Batterien wird aufgerundet: 14 Fässer sind 3 Paletten, auch wenn die
 * dritte nur zwei trägt.
 */
export function ladungsEinheiten(bereich: BereichInfo, anzahl: number): number {
  return bereich.ladungGerechnet ? Math.ceil(anzahl / bereich.proLadung) : anzahl;
}

/**
 * UN-Nummern der Lithium-Recyclingfässer, wie sie auf dem Behälter stehen.
 * 3090 = Lithium-Metall-Batterien, 3480 = Lithium-Ionen-Batterien. Beide
 * Gefahrgutklasse 9.
 *
 * ⚠️ Das ist die Transportkennzeichnung nach ADR und etwas ANDERES als der
 * Abfallschlüssel nach Abfallverzeichnis. Beide stehen nebeneinander in der
 * Tabelle, weil beide auf die Papiere gehören.
 */
export const UN_NUMMERN = ["3090", "3480"] as const;

/** Abfalllager zur Auswahl (Frank, 08.10.2026). Gespeichert wird der Text. */
export const ABFALLLAGER = [
  "Wareneingangslager",
  "Lager für nicht gefährlichen Artikel",
  "Lager für gefährlichen Artikel",
  "Produktlager",
  "Schredderlager",
] as const;

/**
 * Versandarten mit dem Leergewicht des Behälters (Frank, 08.10.2026).
 * Gespeichert wird nur der Name („GIBO"), wie bisher.
 *
 * ⚠️ Das Leergewicht hängt am BEHÄLTER, nicht am Abfall — deshalb schlägt es
 * das Leergewicht der Abfallart. Das der Abfallart bleibt Rückfall für
 * Versandarten ohne Angabe (z. B. alte, frei getippte Werte).
 */
export const VERSANDARTEN: readonly { name: string; taraKg: number }[] = [
  { name: "GIBO",        taraKg: 85 },
  { name: "Europalette", taraKg: 25 },
];

/** Leergewicht für die Netto-Rechnung: Versandart vor Abfallart, sonst keins. */
export function taraFuer(versandart: string, artTaraKg: number | null | undefined): number | null {
  const v = VERSANDARTEN.find((x) => x.name === versandart);
  return v ? v.taraKg : (artTaraKg ?? null);
}

/** Netto-Vorschlag aus dem Brutto; null = nichts vorschlagen (Feld bleibt, wie es ist). */
export function nettoVorschlag(brutto: string, tara: number | null): string | null {
  const b = Number(brutto);
  if (!brutto.trim() || !Number.isFinite(b) || b <= 0 || tara == null) return null;
  return String(Math.max(0, b - tara));
}
