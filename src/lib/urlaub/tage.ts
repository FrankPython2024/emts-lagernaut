// ── Urlaubsplanung: Arbeitstage, Feiertage Thüringen, Urlaubskonto ───────────
//
// Alles über reine Datums-Texte „JJJJ-MM-TT", nie über Uhrzeiten: Ein Urlaubstag
// ist ein Kalendertag, keine Zeitspanne — so kann keine Zeitzone einen Tag
// verschieben (der Container läuft auf UTC, siehe Statistik-Regel 2).
//
// Gezählt werden Arbeitstage Mo–Fr ohne gesetzliche Feiertage in THÜRINGEN
// (Standort Sömmerda). Nicht enthalten: Fronleichnam (nur in Teilen des
// Eichsfelds) sowie 24.12./31.12. (keine gesetzlichen Feiertage).
//
// Reine Logik, Test: `npm run test:urlaub`.

import { addiereTage } from "@/lib/zeit/berlin";

export const ABWESENHEIT_ARTEN = ["URLAUB", "KRANK", "SCHULUNG", "GLEITZEIT", "SONSTIGES"] as const;
export type AbwesenheitArt = (typeof ABWESENHEIT_ARTEN)[number];
export const ART_TEXT: Record<AbwesenheitArt, string> = {
  URLAUB: "Urlaub", KRANK: "Krank", SCHULUNG: "Schulung", GLEITZEIT: "Gleitzeit", SONSTIGES: "Sonstiges",
};
export const STATUS = ["GEPLANT", "GENEHMIGT"] as const;
export type UrlaubStatus = (typeof STATUS)[number];

/** Nur Urlaub zählt aufs Urlaubskonto. */
export const zaehltAufsKonto = (art: string) => art === "URLAUB";

const ymd = (j: number, m: number, t: number) =>
  `${j}-${String(m).padStart(2, "0")}-${String(t).padStart(2, "0")}`;

/** Ostersonntag (gregorianisch, Anonymer Algorithmus nach Meeus/Jones/Butcher). */
export function ostersonntag(jahr: number): string {
  const a = jahr % 19, b = Math.floor(jahr / 100), c = jahr % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const monat = Math.floor((h + l - 7 * m + 114) / 31);
  const tag = ((h + l - 7 * m + 114) % 31) + 1;
  return ymd(jahr, monat, tag);
}

const cache = new Map<number, Map<string, string>>();

/** Gesetzliche Feiertage in Thüringen: Datum → Name. */
export function feiertageThueringen(jahr: number): Map<string, string> {
  const vorhanden = cache.get(jahr);
  if (vorhanden) return vorhanden;
  const ostern = ostersonntag(jahr);
  const f = new Map<string, string>([
    [ymd(jahr, 1, 1), "Neujahr"],
    [addiereTage(ostern, -2), "Karfreitag"],
    [addiereTage(ostern, 1), "Ostermontag"],
    [ymd(jahr, 5, 1), "Tag der Arbeit"],
    [addiereTage(ostern, 39), "Christi Himmelfahrt"],
    [addiereTage(ostern, 50), "Pfingstmontag"],
    [ymd(jahr, 10, 3), "Tag der Deutschen Einheit"],
    [ymd(jahr, 10, 31), "Reformationstag"],
    [ymd(jahr, 12, 25), "1. Weihnachtstag"],
    [ymd(jahr, 12, 26), "2. Weihnachtstag"],
  ]);
  // Weltkindertag ist in Thüringen seit 2019 gesetzlicher Feiertag.
  if (jahr >= 2019) f.set(ymd(jahr, 9, 20), "Weltkindertag");
  cache.set(jahr, f);
  return f;
}

export function feiertag(tag: string): string | null {
  return feiertageThueringen(Number(tag.slice(0, 4))).get(tag) ?? null;
}

/** 0 = Sonntag … 6 = Samstag */
export function wochentag(tag: string): number {
  const [j, m, t] = tag.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(j, m - 1, t)).getUTCDay();
}

export function istArbeitstag(tag: string): boolean {
  const w = wochentag(tag);
  return w !== 0 && w !== 6 && !feiertag(tag);
}

export function istGueltigesDatum(tag: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tag)) return false;
  return addiereTage(tag, 0) === tag;
}

/** Alle Kalendertage von … bis (einschließlich). Schutz gegen Endlosschleifen. */
export function tageZwischen(von: string, bis: string): string[] {
  const raus: string[] = [];
  for (let t = von; t <= bis && raus.length < 800; t = addiereTage(t, 1)) raus.push(t);
  return raus;
}

export type Zeitraum = { von: string; bis: string; halberTag?: boolean };

/**
 * Arbeitstage eines Eintrags, auf Wunsch nur die in einem Jahr (Urlaub über
 * Silvester zählt in beide Jahre anteilig). Ein halber Tag gibt es nur bei
 * EINEM Tag (von = bis); fällt er auf ein Wochenende/einen Feiertag, zählt 0.
 */
export function arbeitstage(z: Zeitraum, jahr?: number): number {
  let n = 0;
  for (const t of tageZwischen(z.von, z.bis)) {
    if (jahr != null && Number(t.slice(0, 4)) !== jahr) continue;
    if (istArbeitstag(t)) n++;
  }
  if (z.halberTag && z.von === z.bis) return n * 0.5;
  return n;
}

/** Überschneiden sich zwei Zeiträume an mindestens einem ARBEITStag? */
export function ueberschneiden(a: Zeitraum, b: Zeitraum): boolean {
  const von = a.von > b.von ? a.von : b.von;
  const bis = a.bis < b.bis ? a.bis : b.bis;
  if (von > bis) return false;
  return tageZwischen(von, bis).some(istArbeitstag);
}

export type KontoEintrag = Zeitraum & { art: string; status: string };
export type Konto = {
  anspruch:   number;
  uebertrag:  number;
  genehmigt:  number;
  geplant:    number;
  /** Anspruch + Übertrag − genehmigt − geplant: so viel lässt sich noch verplanen. */
  verfuegbar: number;
};

export function urlaubskonto(args: { anspruch: number; uebertrag: number; eintraege: KontoEintrag[]; jahr: number }): Konto {
  let genehmigt = 0, geplant = 0;
  for (const e of args.eintraege) {
    if (!zaehltAufsKonto(e.art)) continue;
    const t = arbeitstage(e, args.jahr);
    if (e.status === "GENEHMIGT") genehmigt += t;
    else geplant += t;
  }
  return {
    anspruch: args.anspruch,
    uebertrag: args.uebertrag,
    genehmigt,
    geplant,
    verfuegbar: args.anspruch + args.uebertrag - genehmigt - geplant,
  };
}
