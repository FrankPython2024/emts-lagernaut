/**
 * Wie alt sind die Spender-Daten — und ab wann darf man ihnen nicht mehr trauen?
 *
 * Der Verwertungsbestand wird von Hand aus ReForm exportiert und hochgeladen.
 * Ein automatischer Abruf ist **nicht erlaubt** (die AfB-IT hat den früheren
 * Playwright-Weg beanstandet). Damit hängt die Datenqualität an einer
 * Gewohnheit — und eine Gewohnheit braucht eine sichtbare Anzeige, sonst läuft
 * irgendwann jemand zu einem Karton, den es nicht mehr gibt.
 *
 * ⚠️ Die Schwellen sind VORLÄUFIG und bewusst großzügig. Grundlage ist die
 * Verweildauer im Export vom 09.09.2026 (2.905 Geräte mit Angabe):
 * Median **148 Tage**, 75 % über 76 Tage, nur 2 Geräte höchstens eine Woche im
 * Haus. Der Bestand bewegt sich also sehr langsam.
 *
 * ⚠️ Was diese Messung NICHT sagt: wie schnell Geräte den Bestand *verlassen*.
 * Das lässt sich aus einer einzelnen Momentaufnahme nicht ablesen. Der **zweite
 * Import** liefert die Zahl frei Haus — `VerwertungsImport.anzahlAusgeschieden`
 * gegen die Zahl der Tage seit dem letzten Import. Danach gehören diese
 * Schwellen nachgerechnet statt geraten.
 *
 * Reine Logik, kein Netz, keine Datenbank — prüfbar über tests/frische.test.ts.
 */

/** Bis hierhin gilt der Bestand als aktuell. */
export const FRISCH_TAGE = 10;
/** Ab hier ein deutlicher Hinweis, aber noch benutzbar. */
export const ALT_TAGE = 21;

export type Frische = {
  /** Alter in vollen Tagen. null = es gab noch nie einen Import. */
  tage: number | null;
  stufe: "OHNE_DATEN" | "FRISCH" | "ALTERND" | "ALT";
  /** Ein Satz, der ohne Vorwissen verständlich ist. */
  text: string;
  /** Soll die Oberfläche warnen? */
  warnen: boolean;
};

/** Volle Tage zwischen zwei Zeitpunkten (nie negativ). */
export function tageSeit(zeitpunkt: Date, jetzt: Date = new Date()): number {
  const ms = jetzt.getTime() - zeitpunkt.getTime();
  return ms <= 0 ? 0 : Math.floor(ms / 86_400_000);
}

export function bewerteFrische(letzterImport: Date | null, jetzt: Date = new Date()): Frische {
  if (!letzterImport) {
    return {
      tage: null,
      stufe: "OHNE_DATEN",
      text: "Es wurde noch kein Verwertungs-Export eingelesen.",
      warnen: true,
    };
  }

  const tage = tageSeit(letzterImport, jetzt);
  const wann = tage === 0 ? "heute" : tage === 1 ? "gestern" : `vor ${tage} Tagen`;

  if (tage <= FRISCH_TAGE) {
    return { tage, stufe: "FRISCH", text: `Daten vom Stand ${wann}.`, warnen: false };
  }
  if (tage <= ALT_TAGE) {
    return {
      tage,
      stufe: "ALTERND",
      text: `Daten sind ${wann} eingelesen worden — ein frischer Export wäre gut.`,
      warnen: true,
    };
  }
  return {
    tage,
    stufe: "ALT",
    text: `Daten sind ${tage} Tage alt. Einzelne Geräte können inzwischen weg sein — vor dem Losgehen neu einlesen.`,
    warnen: true,
  };
}
