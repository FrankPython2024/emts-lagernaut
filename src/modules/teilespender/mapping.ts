// Verwertungs-Export → VerwertungsGeraet.
//
// Der Export listet Geräte, die es NICHT in den regulären Verkauf geschafft
// haben. Er ist ;-getrennt, UTF-8 mit BOM, alle Felder gequotet, 57 Spalten.
// Gemessen am Export vom 09.09.2026: 7.357 Zeilen, alle Geräteart „Notebook",
// alle im Lager Sömmerda, keins im Brokershop.
//
// Reine Datenaufbereitung — kein DB-Zugriff, kein Bestandseffekt.

import { zerlegeGeraetename, schildSchluessel } from "@/lib/geraete/schildName";
import { parseDatum, parseGanzzahl, parseBool, parseEk, spalte } from "@/modules/geraete-reise/mapping";

/** Die aus dem CSV abgeleiteten Felder (ohne die verwalteten Import-Felder). */
export type SpenderFelder = {
  hersteller: string | null;
  bezeichnung: string | null;
  modellKey: string;
  geraeteart: string | null;
  unterart: string | null;
  snr: string | null;
  zustand: string | null;
  defekteRoh: string | null;
  bemerkung: string | null;
  verwertungFrei: boolean;
  stellplatz: string | null;
  colli: string | null;
  lager: string | null;
  lagernummer: string | null;
  prozessor: string | null;
  prozessorGen: number | null;
  ek: number | null;
  aufLagerGebuchtAm: Date | null;
  verweildauerTage: number | null;
};

export type GemappteSpenderZeile = { logId: string; felder: SpenderFelder };

/** Alle Felder — für die Änderungserkennung beim Upsert. */
export const SPENDER_FELDER: (keyof SpenderFelder)[] = [
  "hersteller", "bezeichnung", "modellKey", "geraeteart", "unterart", "snr",
  "zustand", "defekteRoh", "bemerkung", "verwertungFrei",
  "stellplatz", "colli", "lager", "lagernummer",
  "prozessor", "prozessorGen", "ek", "aufLagerGebuchtAm", "verweildauerTage",
];

const VARCHAR_MAX = 191;

function str(v: string | undefined): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function strKurz(v: string | undefined): string | null {
  const t = str(v);
  return t === null ? null : t.slice(0, VARCHAR_MAX);
}

/**
 * Die Spalten, an denen dieser Export zu erkennen ist.
 *
 * `Defekte` trägt die ganze Auswertung, `Refurbishment nicht möglich` trennt
 * die zerlegbaren Geräte von denen, die noch verkauft werden sollen. Fehlt eine
 * davon, ist es eine andere Exportart — dann wird nichts geschrieben.
 *
 * ⚠️ Geprüft wird die SPALTE, nicht ihr Inhalt. Eine umbenannte Spalte liefert
 * sonst überall `undefined`, der Import läuft scheinbar sauber durch und ab da
 * gilt jedes Gerät als defektfrei und nicht freigegeben.
 */
export const PFLICHT_SPALTEN = ["LogId", "Defekte", "Refurbishment nicht möglich", "Bezeichnung"] as const;

/** Welche der Pflichtspalten fehlen in dieser Datei? Leer = in Ordnung. */
export function fehlendeSpalten(header: string[]): string[] {
  const da = new Set(header.map((h) => h.replace(/^﻿/, "").trim()));
  return PFLICHT_SPALTEN.filter((s) => !da.has(s));
}

/** LogID einer Rohzeile — für Zeilenzählung und Vorprüfung. */
export function logIdRoh(raw: Record<string, string>): string {
  return (spalte(raw, ["LogId", "LogID"]) ?? "").trim();
}

/**
 * Übersetzt eine CSV-Zeile. Ohne LogID → null (Zeile wird übersprungen).
 */
export function mappeSpenderZeile(raw: Record<string, string>): GemappteSpenderZeile | null {
  const logId = logIdRoh(raw);
  if (!logId) return null;

  const hersteller = strKurz(spalte(raw, ["Hersteller"]));
  const bezeichnung = str(spalte(raw, ["Bezeichnung"]));

  // Der Suchschlüssel. Ohne ihn findet die Teilesuche praktisch nichts: Der
  // Export schreibt „ThinkPad L14 Gen 2 20X1S3T400", die Anfrage heißt
  // „Lenovo - ThinkPad L14 Gen 2". Gemessen an 934 echten Anfragen am
  // 09.09.2026 — über den Schlüssel 97,3 % Treffer, über den rohen Namen 0,1 %.
  const modellKey = schildSchluessel(zerlegeGeraetename(bezeichnung ?? "", hersteller));

  return {
    logId,
    felder: {
      hersteller,
      bezeichnung,
      modellKey: modellKey.slice(0, VARCHAR_MAX),
      geraeteart: strKurz(spalte(raw, ["Geräteart"])),
      unterart: strKurz(spalte(raw, ["Unterart"])),
      snr: strKurz(spalte(raw, ["SNR", "Seriennummer"])),
      zustand: strKurz(spalte(raw, ["Zustand", "Zustand aktuell"])),
      defekteRoh: str(spalte(raw, ["Defekte"])),
      // ⚠️ Der Vorgänger-Mapper liest hier „Begründung" — diese Spalte gibt es
      // im Export nicht, sie heißt „Bemerkung".
      bemerkung: str(spalte(raw, ["Bemerkung"])),
      // Leerer Wert gilt bewusst als NICHT freigegeben (14 Fälle im Export vom
      // 09.09.2026). Lieber ein Spender zu wenig als ein zerlegtes Gerät, das
      // noch hätte verkauft werden sollen.
      verwertungFrei: parseBool(spalte(raw, ["Refurbishment nicht möglich"])),
      stellplatz: strKurz(spalte(raw, ["Stellplatz"])),
      colli: strKurz(spalte(raw, ["Colli"])),
      lager: strKurz(spalte(raw, ["Lager"])),
      lagernummer: strKurz(spalte(raw, ["Lagernummer"])),
      prozessor: strKurz(spalte(raw, ["Prozessor"])),
      prozessorGen: parseGanzzahl(spalte(raw, ["AfB-Prozessorgeneration"])),
      ek: parseEk(spalte(raw, ["EK"])),
      aufLagerGebuchtAm: parseDatum(spalte(raw, ["auf Lager gebucht am"])),
      verweildauerTage: parseGanzzahl(spalte(raw, ["Verweildauer auf Lager"])),
    },
  };
}

/** Vergleich für die Änderungserkennung (Date und null sauber behandelt). */
export function feldGleich(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a === null || a === undefined) return b === null || b === undefined;
  return a === b;
}
