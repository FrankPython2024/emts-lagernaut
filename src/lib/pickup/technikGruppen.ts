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
  /** Kurzname für den Auftragsnamen, z. B. „Zustand H". */
  titel:    string;
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
    // Vorrang: „H" zuerst, unabhängig von der Generation.
    if (istZustandH(z.zustand)) { h.push(z); continue; }

    const gen = leseGeneration(z.generation);
    if (gen === null) { ohneZuordnung.push(z); continue; }

    if (gen <= GENERATIONS_GRENZE) alt.push(z);
    else                            neu.push(z);
  }

  return {
    gruppen: [
      {
        key:        "ZUSTAND_H",
        titel:      "Zustand H",
        erklaerung: `Zustand aktuell = ${ZUSTAND_EIGENER_AUFTRAG}, unabhängig von der Prozessorgeneration`,
        zeilen:     h,
      },
      {
        key:        "GEN_ALT",
        titel:      `Generation bis ${GENERATIONS_GRENZE}`,
        erklaerung: `übrige Geräte mit Prozessorgeneration bis einschließlich ${GENERATIONS_GRENZE}`,
        zeilen:     alt,
      },
      {
        key:        "GEN_NEU",
        titel:      `Generation ab ${GENERATIONS_GRENZE + 1}`,
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
