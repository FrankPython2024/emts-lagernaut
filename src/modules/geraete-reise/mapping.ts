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
  "salestatus",
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

function pick(raw: Record<string, string>, header: string): string | undefined {
  return raw[header] ?? raw[header.trim()];
}

// Übersetzt eine CSV-Zeile in { logId, felder }. logId leer → null (Zeile wird
// vom Importer übersprungen).
export function mappeZeile(raw: Record<string, string>): GemappteZeile | null {
  const logId = str(pick(raw, "LogID"));
  if (!logId) return null;

  // "vorheriges Colli" == "0" gilt als „kein vorheriges Colli".
  const vorherigesColliRoh = strKurz(pick(raw, "vorheriges Colli"));
  const vorherigesColli = vorherigesColliRoh === "0" ? null : vorherigesColliRoh;

  // Plain-VARCHAR(191)-Felder via strKurz (defensiv gekappt). Nur bezeichnung
  // und begruendung sind TEXT-Spalten → str() (volle Länge).
  const felder: StandFelder = {
    hersteller:        strKurz(pick(raw, "Hersteller")),
    bezeichnung:       str(pick(raw, "Bezeichnung")),
    geraeteart:        strKurz(pick(raw, "Geräteart")),
    unterart:          strKurz(pick(raw, "Unterart")),
    seriennummer:      strKurz(pick(raw, "Seriennummer")),
    stellplatz:        strKurz(pick(raw, "Stellplatz")),
    stellplatzStatus:  strKurz(pick(raw, "Stellplatz-Status")),
    lager:             strKurz(pick(raw, "Lager")),
    lagernummer:       strKurz(pick(raw, "Lagernummer")),
    filiale:           strKurz(pick(raw, "Filiale")),
    colli:             strKurz(pick(raw, "Colli")),
    vorherigesColli,
    statusColli:       strKurz(pick(raw, "Status Colli")),
    verbleib:          strKurz(pick(raw, "Verbleib")),
    inVerbleibSeit:    parseDatum(pick(raw, "in Verbleib seit")),
    inVerbleibDurch:   strKurz(pick(raw, "in Verbleib durch")),
    aufLagerGebuchtAm: parseDatum(pick(raw, "auf Lager gebucht am")),
    verweildauerTage:  parseGanzzahl(pick(raw, "Verweildauer auf Lager")),
    letzteAenderungAm: parseDatum(pick(raw, "Letzte Änderung am")),
    refurbished:       parseBool(pick(raw, "refurbished?")),
    refurbishDatum:    parseDatum(pick(raw, "Refurbish-Datum")),
    grading:           strKurz(pick(raw, "Grading")),
    initialesGrading:  strKurz(pick(raw, "Initiales Grading")),
    aktuellerZustand:  strKurz(pick(raw, "Aktueller Zustand")),
    blockiert:         parseBool(pick(raw, "Blockiert")),
    begruendung:       str(pick(raw, "Begründung")),
    blockiertVon:      strKurz(pick(raw, "Blockiert von")),
    blockiertAm:       parseDatum(pick(raw, "Blockiert am")),
    salestatus:        strKurz(pick(raw, "Salestatus")),
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
