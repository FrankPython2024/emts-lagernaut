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
  // „Knapp" nur bei echter Konkurrenz: Bei einer einzigen Anfrage ist ein
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

/** Eine Anfrage samt der Geräte, die für SIE in Frage kommen. */
export type Bewerber<T> = {
  id: number;
  /**
   * Die Kandidaten dieser Anfrage — bereits um das eigene Zielgerät bereinigt.
   * Deshalb können sich die Listen zweier Anfragen unterscheiden.
   */
  kandidaten: T[];
};

/**
 * Wer bekommt welches Spendergerät, wenn es nicht für alle reicht?
 *
 * ⚠️ Anlass (10.09.2026): Drei offene Anfragen für einen P17-Akku, ein einziges
 * Spendergerät — und alle drei Zeilen priesen dasselbe Gerät an. Für den, der
 * die Anfragen abarbeitet, ist das wertlos: Er sieht dreimal eine Zusage, die
 * nur einmal eingelöst werden kann.
 *
 * **Regel: Erst bei echtem Überschuss bleiben die Listen unangetastet.**
 *   • Geräte > Anfragen → jede Anfrage behält ihre volle Kandidatenliste. Es ist
 *     Luft da, und wer auswählt, greift ohnehin zu verschiedenen. Eine
 *     Zuteilung würde hier nur Auswahl wegnehmen.
 *   • Geräte ≤ Anfragen → der Reihe nach bekommt jede Anfrage das erste ihrer
 *     Geräte, das noch frei ist. Wer leer ausgeht, geht leer aus.
 *     ⚠️ Auch bei **genau** aufgehender Zahl wird zugeteilt: Hat eine Anfrage nur
 *     ein brauchbares Gerät und eine andere greift zuerst danach, stünde die
 *     erste sonst ohne da.
 *
 * ⚠️ **Jede Anfrage bringt ihre EIGENE Kandidatenliste mit.** Das ist kein
 * Luxus: Steht das Zielgerät einer Anfrage selbst im Spenderbestand, fehlt es in
 * genau deren Liste und ist für die anderen trotzdem da. Rechnet man die
 * Zuteilung je Anfrage gegen deren eigene Liste (so lief die erste Fassung),
 * kommen zwei Anfragen unabhängig zu unterschiedlichen Ergebnissen und dasselbe
 * Gerät wird zweimal zugesagt — im Test „ein Gerät nie doppelt vergeben"
 * festgehalten.
 *
 * ⚠️ Die Reihenfolge muss **stabil** sein — dieselbe Eingabe, dasselbe
 * Ergebnis. Sonst springt die Zuteilung bei jedem Neuladen der Liste (die alle
 * fünf Sekunden aktualisiert) und niemand traut ihr.
 *
 * `bewerber` kommt bereits sortiert herein (ältester Bedarf zuerst).
 */
export function verteileSpender<T>(
  bewerber: Bewerber<T>[],
  schluessel: (kandidat: T) => string,
): Map<number, T[]> {
  const raus = new Map<number, T[]>();
  if (bewerber.length === 0) return raus;

  // Wie viele verschiedene Geräte stehen insgesamt zur Verfügung?
  const alle = new Set<string>();
  for (const b of bewerber) for (const k of b.kandidaten) alle.add(schluessel(k));

  // ⚠️ Nur bei ECHTEM Überschuss die Listen unangetastet lassen. Bei genau so
  // vielen Geräten wie Anfragen ist es bereits eng: Hat eine Anfrage nur ein
  // einziges brauchbares Gerät (weil ihr eigenes Zielgerät wegfällt) und eine
  // andere greift danach, steht die erste ohne da. Deshalb `>` und nicht `>=`.
  if (alle.size > bewerber.length) {
    for (const b of bewerber) raus.set(b.id, b.kandidaten);
    return raus;
  }

  // Knapp → der Reihe nach je ein noch freies Gerät.
  const vergeben = new Set<string>();
  for (const b of bewerber) {
    const frei = b.kandidaten.find((k) => !vergeben.has(schluessel(k)));
    if (frei === undefined) {
      raus.set(b.id, []);
      continue;
    }
    vergeben.add(schluessel(frei));
    raus.set(b.id, [frei]);
  }
  return raus;
}
