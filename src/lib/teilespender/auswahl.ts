/**
 * Welche Spendergeräte muss ich holen, um alle gesuchten Teile zu bekommen?
 *
 * Ein Techniker fragt für dasselbe Notebook oft mehrere Teile zusammen an
 * (Tastatur + Touchpad + D-Cover). Ein einziges Verwertungsgerät desselben
 * Modells hat meist alle. Diese Funktion sucht die **kleinste Zahl von Kartons**,
 * die zusammen alles abdecken — damit jemand einmal losläuft statt dreimal.
 *
 * Reine Logik, kein Netz, keine Datenbank — prüfbar über tests/auswahl.test.ts.
 */

export type Abdeckung = {
  /** Kennung des Geräts (LogID). */
  logId: string;
  /** Welche der gesuchten Teiltypen dieses Gerät vermutlich noch hat. */
  deckt: string[];
  /** Davon die mit vermerkten Gebrauchsspuren — bei Gleichstand unerwünscht. */
  mitSpuren?: string[];
};

/**
 * Greedy-Auswahl: immer das Gerät nehmen, das die meisten NOCH OFFENEN Teile
 * bringt.
 *
 * ⚠️ Bewusst greedy und nicht optimal. Das kleinste vollständige Set zu finden
 * ist das Mengenüberdeckungsproblem — für eine Handvoll Kartons wäre der
 * Unterschied bestenfalls ein Karton, der Code aber deutlich schwerer zu
 * prüfen. Greedy liefert hier verlässlich das, was ein Mensch auch wählen
 * würde.
 *
 * Bei Gleichstand entscheidet: weniger Gebrauchsspuren, dann die Reihenfolge
 * der Eingabeliste (die vom Aufrufer nach Laufweg sortiert ist). Damit ist das
 * Ergebnis **stabil** — zweimal aufgerufen kommt dasselbe heraus, sonst
 * springen bei jedem Neuladen die Häkchen.
 */
export function waehleWenigsteWege(
  geraete: Abdeckung[],
  gesucht: string[],
): string[] {
  const offen = new Set(gesucht);
  const auswahl: string[] = [];
  const genommen = new Set<string>();

  while (offen.size > 0) {
    let bestes: Abdeckung | null = null;
    let bestesNeu = 0;
    let bestesSpuren = 0;

    for (const g of geraete) {
      if (genommen.has(g.logId)) continue;
      const neu = g.deckt.filter((t) => offen.has(t)).length;
      if (neu === 0) continue;
      const spuren = (g.mitSpuren ?? []).filter((t) => offen.has(t)).length;
      // Streng größer: Bei Gleichstand gewinnt der frühere Eintrag, damit die
      // Reihenfolge der Eingabeliste den Ausschlag gibt.
      if (neu > bestesNeu || (neu === bestesNeu && bestes !== null && spuren < bestesSpuren)) {
        bestes = g;
        bestesNeu = neu;
        bestesSpuren = spuren;
      }
    }

    // Kein Gerät bringt noch etwas Neues — der Rest ist schlicht nicht da.
    if (!bestes) break;

    auswahl.push(bestes.logId);
    genommen.add(bestes.logId);
    for (const t of bestes.deckt) offen.delete(t);
  }

  return auswahl;
}

/** Was deckt eine Auswahl zusammen ab? */
export function abgedeckteTeile(geraete: Abdeckung[], auswahl: Iterable<string>): Set<string> {
  const gewaehlt = new Set(auswahl);
  const raus = new Set<string>();
  for (const g of geraete) {
    if (!gewaehlt.has(g.logId)) continue;
    for (const t of g.deckt) raus.add(t);
  }
  return raus;
}
