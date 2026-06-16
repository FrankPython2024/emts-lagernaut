// Geräte-Reise — Spalten-Mapping & Parsing der ReForm-LogID-Exporte.
//
// Der Export ist ;-getrennt, UTF-8, alle Felder in " gequotet. Header sind
// deutsch (mit Umlauten). Hier wird eine CSV-Zeile (Record<string,string> aus
// papaparse mit header:true) in die LogIdStand-Felder übersetzt.
//
// Reine Datenaufbereitung — KEIN Bestandseffekt, kein DB-Zugriff.

// Die aus dem CSV abgeleiteten Stand-Felder (ohne die verwalteten Felder
// logId / erstmalsGesehen / zuletztGesehen / zuletztImportId).
export type StandFelder = {
  hersteller:        string | null;
  bezeichnung:       string | null;
  geraeteart:        string | null;
  unterart:          string | null;
  seriennummer:      string | null;
  stellplatz:        string | null;
  stellplatzStatus:  string | null;
  lager:             string | null;
  lagernummer:       string | null;
  filiale:           string | null;
  colli:             string | null;
  vorherigesColli:   string | null;
  statusColli:       string | null;
  verbleib:          string | null;
  inVerbleibSeit:    Date | null;
  inVerbleibDurch:   string | null;
  aufLagerGebuchtAm: Date | null;
  verweildauerTage:  number | null;
  letzteAenderungAm: Date | null;
  refurbished:       boolean;
  refurbishDatum:    Date | null;
  grading:           string | null;
  initialesGrading:  string | null;
  aktuellerZustand:  string | null;
  blockiert:         boolean;
  begruendung:       string | null;
  blockiertVon:      string | null;
  blockiertAm:       Date | null;
  salestatus:        string | null;
  ek:                number | null;
};

export type GemappteZeile = { logId: string; felder: StandFelder };

// Alle Stand-Felder (für Change-Detection beim Upsert).
export const STAND_FELDER: (keyof StandFelder)[] = [
  "hersteller", "bezeichnung", "geraeteart", "unterart", "seriennummer",
  "stellplatz", "stellplatzStatus", "lager", "lagernummer", "filiale",
  "colli", "vorherigesColli", "statusColli",
  "verbleib", "inVerbleibSeit", "inVerbleibDurch",
  "aufLagerGebuchtAm", "verweildauerTage", "letzteAenderungAm",
  "refurbished", "refurbishDatum",
  "grading", "initialesGrading", "aktuellerZustand",
  "blockiert", "begruendung", "blockiertVon", "blockiertAm",
  "salestatus", "ek",
];

// Schlüsselfelder, deren Änderung als LogIdBewegung festgehalten wird.
export const SCHLUESSEL_FELDER: (keyof StandFelder)[] = [
  "verbleib", "stellplatz", "colli", "lager",
  "grading", "aktuellerZustand", "refurbished", "blockiert",
];

// ── Einzel-Parser ─────────────────────────────────────────────────────────────

// Trimmt; leerer String → null.
function str(v: string | undefined): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

// Datum im Format "YYYY-MM-DD HH:MM:SS.ff" (Zeit/Bruchteile optional) → Date.
// Leer/ungültig → null. Wird als lokale Zeit interpretiert (kein TZ-Suffix im Export).
export function parseDatum(v: string | undefined): Date | null {
  const t = str(v);
  if (!t) return null;
  const m = t.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?$/,
  );
  if (!m) return null;
  const [, y, mo, d, hh, mi, ss, frac] = m;
  const ms = frac ? Number((frac + "000").slice(0, 3)) : 0;
  const date = new Date(
    Number(y), Number(mo) - 1, Number(d),
    Number(hh ?? "0"), Number(mi ?? "0"), Number(ss ?? "0"), ms,
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

// Ganze Zahl; leer/ungültig → null.
export function parseGanzzahl(v: string | undefined): number | null {
  const t = str(v);
  if (!t) return null;
  const n = parseInt(t.replace(/[^\d-]/g, ""), 10);
  return Number.isNaN(n) ? null : n;
}

// "ja/true/1/x/yes/y/wahr" (case-insensitiv) → true, sonst false.
export function parseBool(v: string | undefined): boolean {
  const t = str(v);
  if (!t) return false;
  return ["ja", "true", "1", "x", "yes", "y", "wahr"].includes(t.toLowerCase());
}

// Einkaufswert im deutschen Zahlenformat → number (2 Nachkommastellen) | null.
// Punkt = Tausendertrenner, Komma = Dezimaltrenner. Float-Artefakte werden durch
// das Runden geglättet ("1.841,4999999999998" → 1841.50), negative Werte bleiben
// erhalten ("-19,14" → -19.14). Beispiele: "9,5"→9.5, "1.025"→1025, "734"→734.
export function parseEk(v: string | undefined): number | null {
  const t = str(v);
  if (!t) return null;
  const normalisiert = t.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(normalisiert);
  if (Number.isNaN(n)) return null;
  return Math.round(n * 100) / 100;
}

// Default-Längengrenze für Plain-VARCHAR-Spalten in Prisma/MySQL.
const VARCHAR_MAX = 191;

// Wie str(), aber defensiv auf VARCHAR(191) gekappt — damit ein überlanger
// Ausreißer in einer VARCHAR-Spalte den Import nicht crasht. NICHT für TEXT-
// Spalten (bezeichnung, begruendung) verwenden — die bleiben voll.
function strKurz(v: string | undefined): string | null {
  const t = str(v);
  return t === null ? null : t.slice(0, VARCHAR_MAX);
}

// ── Header-Mapping ──────────────────────────────────────────────────────────────
// CSV-Header → Lookup. Toleriert führende/abschließende Leerzeichen in Headern.

export function pick(raw: Record<string, string>, header: string): string | undefined {
  return raw[header] ?? raw[header.trim()];
}

// Robust gegen verschiedene Export-Formate: probiert mehrere mögliche Header-
// Namen in Prioritäts-Reihenfolge (NEUER Name zuerst, ALTER als Fallback) und
// liefert den ersten tatsächlich vorhandenen Spaltenwert. In einer Datei ist
// jeweils nur ein Format → nur einer der Header existiert.
export function spalte(raw: Record<string, string>, namen: string[]): string | undefined {
  for (const n of namen) {
    const v = pick(raw, n);
    if (v !== undefined) return v;
  }
  return undefined;
}

// Marker für die Fehlteile-CSV: ALLE Zeilen haben Verbleib = "Fehlteile".
export const FEHLTEILE_MARKER = "fehlteile";

// LogID einer Rohzeile (getrimmt) — für die Typ-Erkennung / Zeilenzählung.
export function logIdRoh(raw: Record<string, string>): string {
  return (spalte(raw, ["LogId", "LogID"]) ?? "").trim();
}

// True, wenn die Rohzeile als Fehlteil markiert ist (Verbleib == "Fehlteile").
export function istFehlteilZeile(raw: Record<string, string>): boolean {
  return (spalte(raw, ["Verbleib"]) ?? "").trim().toLowerCase() === FEHLTEILE_MARKER;
}

// Übersetzt eine CSV-Zeile in { logId, felder }. logId leer → null (Zeile wird
// vom Importer übersprungen). Jede Spalte wird über eine Prioritätsliste
// nachgeschlagen (neuer Header-Name zuerst, alter als Fallback).
export function mappeZeile(raw: Record<string, string>): GemappteZeile | null {
  const logId = str(spalte(raw, ["LogId", "LogID"]));
  if (!logId) return null;

  // "vorheriges Colli" == "0" gilt als „kein vorheriges Colli".
  const vorherigesColliRoh = strKurz(spalte(raw, ["vorheriges Colli"]));
  const vorherigesColli = vorherigesColliRoh === "0" ? null : vorherigesColliRoh;

  // Plain-VARCHAR(191)-Felder via strKurz (defensiv gekappt). Nur bezeichnung
  // und begruendung sind TEXT-Spalten → str() (volle Länge).
  const felder: StandFelder = {
    hersteller:        strKurz(spalte(raw, ["Hersteller"])),
    bezeichnung:       str(spalte(raw, ["Bezeichnung"])),
    geraeteart:        strKurz(spalte(raw, ["Geräteart"])),
    unterart:          strKurz(spalte(raw, ["Unterart"])),
    seriennummer:      strKurz(spalte(raw, ["Seriennr.", "Seriennummer"])),
    stellplatz:        strKurz(spalte(raw, ["Stellplatz"])),
    stellplatzStatus:  strKurz(spalte(raw, ["Stellplatz-Status"])),
    lager:             strKurz(spalte(raw, ["Lager"])),
    lagernummer:       strKurz(spalte(raw, ["Lagernummer"])),
    filiale:           strKurz(spalte(raw, ["Filiale"])),
    colli:             strKurz(spalte(raw, ["Colli"])),
    vorherigesColli,
    statusColli:       strKurz(spalte(raw, ["Status Colli"])),
    verbleib:          strKurz(spalte(raw, ["Verbleib"])),
    inVerbleibSeit:    parseDatum(spalte(raw, ["in Verbleib seit"])),
    inVerbleibDurch:   strKurz(spalte(raw, ["in Verbleib durch"])),
    aufLagerGebuchtAm: parseDatum(spalte(raw, ["auf Lager gebucht am"])),
    verweildauerTage:  parseGanzzahl(spalte(raw, ["Lagertage letzter WE", "Verweildauer auf Lager"])),
    letzteAenderungAm: parseDatum(spalte(raw, ["Letzte Änderung am"])),
    refurbished:       parseBool(spalte(raw, ["refurbished?"])),
    refurbishDatum:    parseDatum(spalte(raw, ["Refurbish-Datum"])),
    grading:           strKurz(spalte(raw, ["Grading"])),
    initialesGrading:  strKurz(spalte(raw, ["Initiales Grading"])),
    aktuellerZustand:  strKurz(spalte(raw, ["Zustand aktuell", "Aktueller Zustand"])),
    blockiert:         parseBool(spalte(raw, ["Blockiert"])),
    begruendung:       str(spalte(raw, ["Begründung"])),
    blockiertVon:      strKurz(spalte(raw, ["Blockiert von"])),
    blockiertAm:       parseDatum(spalte(raw, ["Blockiert am"])),
    salestatus:        strKurz(spalte(raw, ["Status", "Status LogID", "Salestatus"])),
    ek:                parseEk(spalte(raw, ["EK"])),
  };

  return { logId, felder };
}

// ── Vergleich & Darstellung (für Change-Detection / Bewegungen) ──────────────────

// Feld-Gleichheit über String | number | boolean | Date | null.
export function feldGleich(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    const ta = a instanceof Date ? a.getTime() : null;
    const tb = b instanceof Date ? b.getTime() : null;
    return ta === tb;
  }
  return (a ?? null) === (b ?? null);
}

// Wert für die Bewegungs-Spalten (vonWert/nachWert) als String | null.
export function darstellen(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? "ja" : "nein";
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

// ── Fehlteile-Mapping ─────────────────────────────────────────────────────────
// Eigene Felder für FehlteilStand (KEINE Diff-/Bewegungs-Logik). logId/
// zuletztImportId/zuletztGesehen werden vom Importer gesetzt.

export type FehlteilFelder = {
  seriennummer:      string | null;
  hersteller:        string | null;
  bezeichnung:       string | null;
  geraeteart:        string | null;
  unterart:          string | null;
  aktuellerZustand:  string | null;
  grading:           string | null;
  sortiment:         string | null;
  aan:               string | null;
  inVerbleibSeit:    Date | null;
  inVerbleibDurch:   string | null;
  aufLagerGebuchtAm: Date | null;
  verweildauerTage:  number | null;
  lager:             string | null;
};

export type GemappteFehlteilZeile = { logId: string; felder: FehlteilFelder };

// Übersetzt eine Fehlteil-CSV-Zeile. logId leer → null (Zeile übersprungen).
export function mappeFehlteil(raw: Record<string, string>): GemappteFehlteilZeile | null {
  const logId = str(spalte(raw, ["LogId", "LogID"]));
  if (!logId) return null;
  return {
    logId,
    felder: {
      seriennummer:      strKurz(spalte(raw, ["Seriennr.", "Seriennummer"])),
      hersteller:        strKurz(spalte(raw, ["Hersteller"])),
      bezeichnung:       str(spalte(raw, ["Bezeichnung"])),       // TEXT → volle Länge
      geraeteart:        strKurz(spalte(raw, ["Geräteart"])),
      unterart:          strKurz(spalte(raw, ["Unterart"])),
      aktuellerZustand:  strKurz(spalte(raw, ["Zustand aktuell", "Aktueller Zustand"])),
      grading:           strKurz(spalte(raw, ["Grading"])),
      sortiment:         strKurz(spalte(raw, ["Sortiment"])),
      aan:               strKurz(spalte(raw, ["AAN"])),
      inVerbleibSeit:    parseDatum(spalte(raw, ["in Verbleib seit"])),
      inVerbleibDurch:   strKurz(spalte(raw, ["in Verbleib durch"])),
      aufLagerGebuchtAm: parseDatum(spalte(raw, ["auf Lager gebucht am"])),
      verweildauerTage:  parseGanzzahl(spalte(raw, ["Lagertage letzter WE", "Verweildauer auf Lager"])),
      lager:             strKurz(spalte(raw, ["Lager"])),
    },
  };
}
