/**
 * Aufteilung der Technik-Rückläufer auf drei Pickup-Aufträge.
 *
 * Der mobile Lagerwagen holt aus der Technik Geräte ab, die es nicht in den
 * Verkauf geschafft haben. Der ReForm-Export dieser Geräte wird in drei
 * Abholaufträge zerlegt:
 *
 *   1. Zustand aktuell = "H"          → eigener Auftrag, unabhängig vom Prozessor
 *   2. alle übrigen, Generation ≤ 9   → Auftrag „alte Generation"
 *   3. alle übrigen, Generation > 9   → Auftrag „neue Generation"
 *
 * ⚠️ Die Reihenfolge ist die Regel, nicht nur eine Sortierung. „H" gewinnt IMMER
 * zuerst; erst danach entscheidet die Prozessorgeneration. Ohne diesen Vorrang
 * stünde dasselbe Gerät auf zwei Listen — im Export vom 07.09.2026 wären das 62
 * Geräte auf 107 Positionen gewesen. Ein Gerät kann aber nur einmal abgeholt
 * werden, deshalb sind die drei Gruppen überschneidungsfrei.
 *
 * Reine Logik ohne Datei-/DB-Zugriff, damit sie prüfbar bleibt.
 */

import type { PickupImportPosition } from "@/lib/pickup/csvImport";

/** Ab dieser Generation gilt ein Gerät als „neu". Grenze gehört noch zu „alt". */
export const GENERATIONS_GRENZE = 9;

/** Zustandswert, der einen eigenen Auftrag bekommt — vor jeder Generationsfrage. */
export const ZUSTAND_EIGENER_AUFTRAG = "H";

export type TechnikZeile = PickupImportPosition & {
  /** Rohwert aus „Zustand aktuell" (z. B. "H", "R-A", "R-B"). */
  zustand:    string | null;
  /** Rohwert aus „AfB-Prozessorgeneration" (z. B. "8", "11"). */
  generation: string | null;
};

export type GruppenSchluessel = "ZUSTAND_H" | "GEN_ALT" | "GEN_NEU";

export type Gruppe = {
  key:      GruppenSchluessel;
  /** Überschrift auf der Seite, z. B. „Generation bis 9". */
  titel:    string;
  /**
   * Name des Pickup-Auftrags, z. B. „R-B bis 9".
   *
   * ⚠️ Bewusst so kurz und OHNE Datum: Auf dem Handscanner wurde
   * „Technik 15.09.2026 · Generation bis 9" abgeschnitten, und der
   * unterscheidende Teil stand genau hinten. Wunsch von Frank am 15.09.2026.
   */
  kurzname: string;
  /** Erklärung für die Oberfläche. */
  erklaerung: string;
  zeilen:   TechnikZeile[];
};

export type Aufteilung = {
  gruppen: Gruppe[];
  /**
   * Zeilen, die in keine Gruppe passen: nicht „H" UND ohne lesbare Generation.
   * Werden bewusst NICHT stillschweigend irgendwo einsortiert — sie erscheinen
   * in der Oberfläche und der Mensch entscheidet.
   */
  ohneZuordnung: TechnikZeile[];
};

/**
 * Liest die Generationsangabe als Zahl.
 *
 * Gibt null zurück, wenn das Feld leer oder keine Zahl ist. ⚠️ Bewusst kein
 * Rückfall auf 0: Eine fehlende Angabe würde sonst als „alte Generation"
 * durchgehen und das Gerät landete auf einer Liste, auf die es vielleicht nicht
 * gehört. Lieber sichtbar unzugeordnet lassen.
 */
export function leseGeneration(roh: string | null): number | null {
  if (roh == null) return null;
  const text = roh.trim();
  if (text === "") return null;
  // Deutsche Schreibweise mit Komma tolerieren ("10,0"), obwohl der Export
  // bisher immer ganze Zahlen liefert.
  const zahl = Number(text.replace(",", "."));
  return Number.isFinite(zahl) ? zahl : null;
}

/** Ist das ein Gerät für den eigenen „H"-Auftrag? Vergleich ohne Groß/Klein. */
export function istZustandH(zustand: string | null): boolean {
  return (zustand ?? "").trim().toUpperCase() === ZUSTAND_EIGENER_AUFTRAG;
}

/**
 * Kurzname je Gruppe — so heißen die Abholaufträge UND so zeigt die Sortierhilfe
 * am Zebra (/pickup/sortieren) das Ziel an. Eine Quelle, damit Auftrag und
 * Anzeige nie verschieden heißen.
 */
export const GRUPPEN_KURZNAME: Record<GruppenSchluessel, string> = {
  ZUSTAND_H: "Zustand H",
  // „R-B", weil die übrigen alten Geräte praktisch immer R-B sind (Export
  // 07.09.2026: 18 von 18). Die Seite warnt, wenn ein anderer Zustand dabei ist.
  GEN_ALT:   `R-B bis ${GENERATIONS_GRENZE}`,
  GEN_NEU:   `ab ${GENERATIONS_GRENZE + 1}`,
};

/**
 * Zu welcher Gruppe gehört EIN Gerät? Die Regel von `teileAuf` für ein
 * einzelnes Gerät — „H" zuerst, dann die Generation. null = nicht zuzuordnen
 * (nicht „H" und keine lesbare Generation); das wird nie geraten.
 *
 * Die Sortierhilfe am Zebra ruft das mit den Lagerfuchs-Daten auf
 * (`LogIdStand.aktuellerZustand` / `prozessorGen`).
 */
export function gruppeVon(zustand: string | null, generation: string | number | null): GruppenSchluessel | null {
  if (istZustandH(zustand)) return "ZUSTAND_H";
  const gen = leseGeneration(generation == null ? null : String(generation));
  if (gen === null) return null;
  return gen <= GENERATIONS_GRENZE ? "GEN_ALT" : "GEN_NEU";
}

/**
 * Teilt die eingelesenen Zeilen auf die drei Aufträge auf.
 *
 * Jede Zeile landet in höchstens einer Gruppe. Die Summe aller Gruppen plus
 * `ohneZuordnung` ergibt immer die Eingabemenge.
 */
export function teileAuf(zeilen: TechnikZeile[]): Aufteilung {
  const h:   TechnikZeile[] = [];
  const alt: TechnikZeile[] = [];
  const neu: TechnikZeile[] = [];
  const ohneZuordnung: TechnikZeile[] = [];

  for (const z of zeilen) {
    // Vorrang: „H" zuerst, unabhängig von der Generation (steckt in gruppeVon).
    const g = gruppeVon(z.zustand, z.generation);
    if (g === "ZUSTAND_H")    h.push(z);
    else if (g === "GEN_ALT") alt.push(z);
    else if (g === "GEN_NEU") neu.push(z);
    else                      ohneZuordnung.push(z);
  }

  return {
    gruppen: [
      {
        key:        "ZUSTAND_H",
        titel:      "Zustand H",
        kurzname:   GRUPPEN_KURZNAME.ZUSTAND_H,
        erklaerung: `Zustand aktuell = ${ZUSTAND_EIGENER_AUFTRAG}, unabhängig von der Prozessorgeneration`,
        zeilen:     h,
      },
      {
        key:        "GEN_ALT",
        titel:      `Generation bis ${GENERATIONS_GRENZE}`,
        kurzname:   GRUPPEN_KURZNAME.GEN_ALT,
        erklaerung: `übrige Geräte mit Prozessorgeneration bis einschließlich ${GENERATIONS_GRENZE}`,
        zeilen:     alt,
      },
      {
        key:        "GEN_NEU",
        titel:      `Generation ab ${GENERATIONS_GRENZE + 1}`,
        kurzname:   GRUPPEN_KURZNAME.GEN_NEU,
        erklaerung: `übrige Geräte mit Prozessorgeneration über ${GENERATIONS_GRENZE}`,
        zeilen:     neu,
      },
    ],
    ohneZuordnung,
  };
}

/** Zählt die Zustandswerte im Export — für die Kontrollanzeige vor dem Anlegen. */
export function zaehleZustaende(zeilen: TechnikZeile[]): { wert: string; anzahl: number }[] {
  const m = new Map<string, number>();
  for (const z of zeilen) {
    const w = (z.zustand ?? "").trim() || "(leer)";
    m.set(w, (m.get(w) ?? 0) + 1);
  }
  return [...m.entries()]
    .map(([wert, anzahl]) => ({ wert, anzahl }))
    .sort((a, b) => b.anzahl - a.anzahl || a.wert.localeCompare(b.wert, "de"));
}
