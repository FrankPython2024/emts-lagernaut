/**
 * Reichen die gefundenen Spendergeräte für alle offenen Anfragen?
 *
 * ⚠️ Der Fehler, den das behebt (10.09.2026 im Betrieb aufgefallen): Zwei
 * Anfragen für ein ThinkPad P17 Gen 1 brauchten beide einen **Akku**, und beide
 * Zeilen meldeten „1 Verwertungsgerät mit diesem Teil" — dasselbe Gerät. Das
 * eine Notebook hat aber genau einen Akku. Eine der beiden Anfragen wäre leer
 * ausgegangen, und niemand hätte es vorher gesehen.
 *
 * **Ein Spendergerät bedient je Teiltyp genau eine Anfrage.** Deshalb wird hier
 * die Zahl der Geräte gegen die Zahl der offenen Anfragen für **dieselbe
 * Kombination aus Modell und Teiltyp** gestellt.
 *
 * ⚠️ Gezählt werden **Anfragen, nicht Stückzahlen.** Bei den Gummifüßen darf
 * eine Anfrage `menge = 2` haben — ein Notebook hat aber vorne auch zwei Füße,
 * ein Spendergerät deckt diese Anfrage also trotzdem komplett ab. Über die
 * Menge zu rechnen würde hier einen Engpass erfinden, den es nicht gibt.
 *
 * ⚠️ Der Engpass wird **angezeigt, nicht versteckt.** Naheliegend wäre, den
 * Hinweis nur bei einer der beiden Anfragen zu zeigen — aber welcher? Jede Wahl
 * wäre willkürlich, und der andere Techniker stünde ohne Information da. Wer
 * die Anfragen bearbeitet, soll den Engpass sehen und selbst entscheiden.
 *
 * Reine Logik, kein Netz, keine Datenbank — prüfbar über tests/bedarf.test.ts.
 */

export type Deckung = {
  /** Geräte, die dieses Teil noch haben. */
  spender: number;
  /** Offene Anfragen, die auf genau dieses Teil warten. */
  bedarf: number;
  /** Reicht es für alle? */
  reicht: boolean;
  /** Geht genau auf — kein Gerät in Reserve. */
  knapp: boolean;
  /** Kurztext fürs UI. Leer, wenn es nichts zu sagen gibt. */
  text: string;
};

export function bewerteDeckung(spender: number, bedarf: number): Deckung {
  const s = Math.max(0, Math.trunc(spender));
  const b = Math.max(0, Math.trunc(bedarf));

  const reicht = s >= b;
  // „Knapp" nur bei echter Konkurrenz: Bei einer einzigen Anfragen ist ein
  // einziges Gerät der Normalfall und keine Meldung wert.
  const knapp = reicht && b > 1 && s === b;

  let text = "";
  if (b > 1 && !reicht) {
    text =
      s === 0
        ? `${b} offene Anfragen brauchen dieses Teil — kein Gerät gefunden.`
        : `Nur ${s} ${s === 1 ? "Gerät" : "Geräte"} für ${b} offene Anfragen — reicht nicht für alle.`;
  } else if (knapp) {
    text = `${s} Geräte für ${b} offene Anfragen — genau ausreichend, keine Reserve.`;
  }

  return { spender: s, bedarf: b, reicht, knapp, text };
}

/** Soll das UI warnen? Nur bei echter Konkurrenz um dieselben Geräte. */
export function warntDeckung(d: Deckung): boolean {
  return d.text !== "";
}


/**
 * Wer bekommt welches Spendergerät, wenn es nicht für alle reicht?
 *
 * ⚠️ Anlass (10.09.2026): Drei offene Anfragen für einen P17-Akku, ein einziges
 * Spendergerät — und alle drei Zeilen priesen dasselbe Gerät an. Für den, der
 * die Anfragen abarbeitet, ist das wertlos: Er sieht dreimal eine Zusage, die
 * nur einmal eingelöst werden kann.
 *
 * **Regel: Erst bei echter Knappheit wird zugeteilt.**
 *   • Geräte ≥ Anfragen → jede Anfrage sieht ALLE Geräte. Es ist genug da, und
 *     wer auswählt, greift ohnehin zu verschiedenen. Eine Zuteilung würde hier
 *     nur Auswahl wegnehmen.
 *   • Geräte < Anfragen → die ältesten Anfragen bekommen je EIN Gerät, die
 *     übrigen gehen leer aus. Das ist die ehrliche Abbildung: Für sie ist
 *     nichts da.
 *
 * ⚠️ Die Reihenfolge muss **stabil** sein — dieselbe Eingabe, dasselbe
 * Ergebnis. Sonst springt die Zuteilung bei jedem Neuladen der Liste (die alle
 * fünf Sekunden aktualisiert) und niemand traut ihr.
 *
 * `anfrageIds` kommt bereits sortiert herein (ältester Bedarf zuerst).
 */
export function verteileSpender<T>(
  anfrageIds: number[],
  spender: T[],
): Map<number, T[]> {
  const raus = new Map<number, T[]>();
  if (anfrageIds.length === 0) return raus;

  // Genug für alle → keine Zuteilung, jeder sieht alles.
  if (spender.length >= anfrageIds.length) {
    for (const id of anfrageIds) raus.set(id, spender);
    return raus;
  }

  // Knapp → je ein Gerät, älteste Anfrage zuerst. Der Rest bekommt nichts.
  anfrageIds.forEach((id, i) => {
    const s = spender[i];
    raus.set(id, s === undefined ? [] : [s]);
  });
  return raus;
}
