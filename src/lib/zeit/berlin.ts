// ── Zeitrechnung in deutscher Zeit ───────────────────────────────────────────
//
// ⚠️ Der App-Container läuft auf UTC (TZ nicht gesetzt), MySQL speichert UTC.
// `getHours()`, `setHours(0)` und `toISOString().slice(0, 10)` rechnen deshalb
// in UTC — in Sömmerda ist es aber im Sommer zwei, im Winter eine Stunde später.
// Gemessen am 17.09.2026: Die Tageszeit-Grafik der Statistik zeigte die
// Arbeitszeit als 5–14 Uhr statt 7–16 Uhr, und Tagesgrenzen lagen auf 02:00.
//
// Deshalb hier ausdrücklich über `Intl` mit Europe/Berlin — unabhängig davon,
// ob jemand später `TZ` im Container setzt. (Das Setzen allein würde die vielen
// `toISOString`-Stellen um einen ganzen Tag verschieben, statt sie zu heilen.)

const ZONE = "Europe/Berlin";

// sv-SE schreibt Datumsangaben als „2026-09-17" — genau das Schlüsselformat.
const TAG_FMT = new Intl.DateTimeFormat("sv-SE", {
  timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit",
});
const TEILE_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: ZONE, hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
});

function teile(d: Date): { jahr: number; monat: number; tag: number; stunde: number; minute: number; sekunde: number } {
  const p: Record<string, string> = {};
  for (const t of TEILE_FMT.formatToParts(d)) p[t.type] = t.value;
  return {
    jahr: Number(p.year), monat: Number(p.month), tag: Number(p.day),
    // Manche Laufzeiten schreiben Mitternacht als „24" — auf 0 ziehen.
    stunde: Number(p.hour) % 24, minute: Number(p.minute), sekunde: Number(p.second),
  };
}

/** Kalendertag in deutscher Zeit, Format „YYYY-MM-DD". */
export function berlinTag(d: Date): string {
  return TAG_FMT.format(d);
}

/** Stunde 0–23 in deutscher Zeit. */
export function berlinStunde(d: Date): number {
  return teile(d).stunde;
}

/** Wochentag in deutscher Zeit, 0 = Sonntag … 6 = Samstag (wie `getDay`). */
export function berlinWochentag(d: Date): number {
  const [j, m, t] = berlinTag(d).split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(j, m - 1, t)).getUTCDay();
}

/** Jahr und Monat (1–12) in deutscher Zeit. */
export function berlinMonat(d: Date): { jahr: number; monat: number } {
  const t = teile(d);
  return { jahr: t.jahr, monat: t.monat };
}

/** „YYYY-MM-DD" um n Tage verschieben (reine Kalenderrechnung, ohne Zeitzone). */
export function addiereTage(ymd: string, n: number): string {
  const [j, m, t] = ymd.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(j, m - 1, t + n)).toISOString().slice(0, 10);
}

/**
 * Der Zeitpunkt, an dem in Deutschland der Tag `ymd` beginnt (00:00 Ortszeit).
 * Sommerzeit: 22:00 UTC des Vortags, Winterzeit: 23:00 UTC.
 */
export function berlinMitternacht(ymd: string): Date {
  const [j, m, t] = ymd.split("-").map(Number) as [number, number, number];
  const probe = Date.UTC(j, m - 1, t, 0, 0, 0);
  const w = teile(new Date(probe));
  const wanduhr = Date.UTC(w.jahr, w.monat - 1, w.tag, w.stunde, w.minute, w.sekunde);
  // Die Umstellung passiert um 02:00/03:00 — um Mitternacht gilt derselbe
  // Versatz wie zur Probe um 00:00 UTC.
  return new Date(probe - (wanduhr - probe));
}

/** Beginn des Monats (1–12) in deutscher Zeit. */
export function berlinMonatsbeginn(jahr: number, monat: number): Date {
  const j = jahr + Math.floor((monat - 1) / 12);
  const m = ((monat - 1) % 12 + 12) % 12 + 1;
  return berlinMitternacht(`${j}-${String(m).padStart(2, "0")}-01`);
}

/**
 * „Letzte N Tage" — EINE Regel für die ganze Statistik.
 *
 * N Kalendertage einschließlich heute, gerechnet in deutscher Zeit ab 00:00.
 * Bei 7 Tagen am Donnerstag: Freitag der Vorwoche 00:00 bis jetzt.
 *
 * ⚠️ Vorher liefen auf EINER Seite drei Regeln nebeneinander (Mitternacht vor
 * N Tagen = N+1 Tage, „jetzt minus N×24 h", und ein Verlauf ohne den heutigen
 * Tag). Unter derselben Überschrift „Letzte 7 Tage" standen am 17.09.2026
 * 200, 183 und 180 Anfragen.
 */
export function zeitraum(tage: number, jetzt: Date = new Date()): { von: Date; tage: string[] } {
  const n = Math.max(1, Math.floor(tage));
  const heute = berlinTag(jetzt);
  const start = addiereTage(heute, -(n - 1));
  const liste: string[] = [];
  for (let i = 0; i < n; i++) liste.push(addiereTage(start, i));
  return { von: berlinMitternacht(start), tage: liste };
}

/**
 * ISO-Kalenderwoche (Montag als Wochenbeginn, Woche 1 enthält den 4. Januar).
 * ⚠️ Die frühere Rechnung ließ Wochen am Sonntag beginnen und zählte ab dem 1.1.
 * — 2026 zufällig richtig, ab 2027 überall um eins zu hoch.
 */
export function isoKalenderwoche(ymd: string): { jahr: number; kw: number } {
  const [j, m, t] = ymd.split("-").map(Number) as [number, number, number];
  const d = new Date(Date.UTC(j, m - 1, t));
  const wt = d.getUTCDay() || 7;              // Mo=1 … So=7
  d.setUTCDate(d.getUTCDate() + 4 - wt);      // Donnerstag derselben Woche
  const jahr = d.getUTCFullYear();
  const jan1 = Date.UTC(jahr, 0, 1);
  return { jahr, kw: Math.ceil(((d.getTime() - jan1) / 86_400_000 + 1) / 7) };
}
