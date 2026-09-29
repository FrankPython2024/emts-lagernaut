/**
 * Gleiche Teile bündeln — mehrere offene Anfragen, die dasselbe Teil für
 * dasselbe Gerätemodell wollen.
 *
 * Anlass (Frank, 29.09.2026): Sechs Anfragen nach einem Akku für das Dell
 * Latitude 7490, von drei Technikern zwischen 05:29 und 10:01 Uhr gestellt.
 * Die Liste sortiert nach Eingang, dazwischen lagen zwölf andere Zeilen —
 * dass „6 Akkus fehlen", sah man nirgends.
 *
 * ⚠️ Gleich = derselbe MODELLSCHLÜSSEL (wie im Teilespender, aus der
 * Roh-Bezeichnung des Zielgeräts) + derselbe Teiltyp. Nie über `geraeteName`:
 * „ThinkPad" und „Thinkpad" wären zwei Bündel, und ein „Latitude 7320
 * Detachable" (dort zu „Latitude 7320" gekürzt) landete beim normalen 7320 —
 * anderes Gerät, anderer Akku.
 *
 * Reine Logik, keine Datenbank — Test: `npm run test:gleicheteile`.
 */

export const OFFENE_STATUS = ["NEU", "IN_BEARBEITUNG", "BEDARF"] as const;

/** Ab so vielen offenen Anfragen wird gebündelt. */
export const MIN_BUENDEL = 2;

export type BuendelAnfrage = {
  id:               number;
  teil:             string;
  /** Modellschlüssel des Zielgeräts; leer = unbekannt, wird nie gebündelt. */
  schluessel:       string;
  status:           string;
  istSonderAnfrage: boolean;
  testModus:        boolean;
  datum:            Date | string;
};

export type Buendel = {
  /** `<modellschlüssel>|<teil>` — stabil über Neuladen hinweg. */
  key:        string;
  schluessel: string;
  /** Teiltyp in der Schreibweise der ältesten Anfrage. */
  teil:       string;
  /** Älteste zuerst. */
  anfrageIds: number[];
};

/** Teiltyp vergleichbar machen: Groß/klein und doppelte Leerzeichen egal. */
export function teilSchluessel(teil: string): string {
  return teil.trim().toLowerCase().replace(/\s+/g, " ");
}

function zeit(d: Date | string): number {
  return new Date(d).getTime();
}

/**
 * Bündelt offene Anfragen. Sonderanfragen (Freitext, nicht vergleichbar),
 * Test-Anfragen und erledigte bleiben draußen.
 *
 * Reihenfolge: meiste Anfragen zuerst, bei Gleichstand die älteste — wer am
 * längsten wartet, steht oben.
 */
export function buendele(anfragen: BuendelAnfrage[]): Buendel[] {
  const offen = new Set<string>(OFFENE_STATUS);
  const map = new Map<string, BuendelAnfrage[]>();
  for (const a of anfragen) {
    if (a.istSonderAnfrage || a.testModus || !offen.has(a.status)) continue;
    const teil = teilSchluessel(a.teil);
    if (!a.schluessel || !teil) continue;
    const key = `${a.schluessel}|${teil}`;
    const liste = map.get(key);
    if (liste) liste.push(a); else map.set(key, [a]);
  }

  const raus: (Buendel & { aeltest: number })[] = [];
  for (const [key, liste] of map) {
    if (liste.length < MIN_BUENDEL) continue;
    liste.sort((x, y) => zeit(x.datum) - zeit(y.datum) || x.id - y.id);
    raus.push({
      key,
      schluessel: liste[0]!.schluessel,
      teil:       liste[0]!.teil.trim(),
      anfrageIds: liste.map((a) => a.id),
      aeltest:    zeit(liste[0]!.datum),
    });
  }
  raus.sort((a, b) => b.anfrageIds.length - a.anfrageIds.length || a.aeltest - b.aeltest || a.key.localeCompare(b.key));
  return raus.map(({ aeltest: _a, ...b }) => b);
}

/**
 * Auf das zuschneiden, was die Liste gerade zeigt (Techniker-, Status-,
 * „Meine"-Filter). Ein Bündel, von dem nur noch eine Anfrage sichtbar ist,
 * fällt weg — sonst stünde „1× Akku" als Bündel da.
 */
export function sichtbareBuendel(buendel: Buendel[], sichtbar: ReadonlySet<number>): Buendel[] {
  const raus: Buendel[] = [];
  for (const b of buendel) {
    const ids = b.anfrageIds.filter((id) => sichtbar.has(id));
    if (ids.length >= MIN_BUENDEL) raus.push({ ...b, anfrageIds: ids });
  }
  return raus;
}
