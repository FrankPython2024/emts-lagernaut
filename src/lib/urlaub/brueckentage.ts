// ── Urlaubsplanung: Wann lohnt sich Urlaub am meisten? (Brückentage) ────────
//
// Sucht Zeiträume, in denen wenige Urlaubstage zusammen mit Wochenenden,
// Feiertagen (Thüringen) und betriebsfreien Tagen (24./31.12.) möglichst viele
// freie Tage AM STÜCK ergeben. Wunsch Frank, 29.09.2026.
//
// Regeln:
//  • Urlaub deckt einen zusammenhängenden Block von Arbeitstagen; die freie Zeit
//    wächst links und rechts über angrenzende Wochenenden/freie Tage hinaus.
//  • Nur Blöcke, die einen freien Tag UNTER DER WOCHE enthalten (Feiertag oder
//    betriebsfrei an Mo–Fr). Ein gewöhnlicher Montag mit Wochenende ist kein Tipp
//    — sonst stünde jede Woche des Jahres in der Liste.
//  • Bewertung: freie Tage je Urlaubstag, bei Gleichstand mehr freie Tage.
//  • Je Anlass (erster Feiertag unter der Woche im Block) die STUFEN, bei denen
//    sich mehr Urlaub lohnt: Eine Stufe kommt nur dazu, wenn die zusätzlichen
//    Urlaubstage mehr freie Tage bringen als sich selbst. Weihnachten 2026:
//    1 Tag → 5 frei, 3 → 11, 6 → 16; 2, 4, 5, 7 … Tage bringen nur je +1 und
//    fallen weg. Dazu die Untergrenze MIN_FAKTOR. (Erste Fassung zeigte nur „günstigste + längste" und verschluckte
//    damit genau die 3-Tage-Stufe, um die es meistens geht.)
//
// Reine Logik, Test: `npm run test:urlaub`.

import { addiereTage } from "@/lib/zeit/berlin";
import { feiertag, istArbeitstag, tageZwischen, ueberschneiden, wochentag, type Zeitraum } from "./tage";

export type Vorschlag = {
  urlaubVon:   string;
  urlaubBis:   string;
  freiVon:     string;
  freiBis:     string;
  urlaubstage: number;
  freieTage:   number;
  /** Freie Tage je Urlaubstag. */
  faktor:      number;
  /** Namen der freien Tage unter der Woche im Block. */
  anlass:      string[];
};

/**
 * Untergrenze: mindestens doppelt so viele freie Tage wie Urlaubstage. Darunter
 * kommt der Gewinn nur noch aus Wochenenden (10 Urlaubstage → 17 frei nach
 * Neujahr 2027) — das kann man jederzeit haben und ist kein Tipp.
 */
export const MIN_FAKTOR = 2;

const istFreierWerktag = (t: string) => !!feiertag(t) && wochentag(t) !== 0 && wochentag(t) !== 6;

export function besteZeitpunkte(args: {
  /** Frühester Urlaubstag (z. B. morgen). */
  von: string;
  /** Spätester Urlaubstag (z. B. 31.12.). Die freie Zeit darf darüber hinausreichen. */
  bis: string;
  maxUrlaubstage: number;
  /** Diese Zeiträume dürfen nicht berührt werden (eigene Einträge, ggf. die der anderen). */
  sperren?: Zeitraum[];
  anzahl?: number;
}): Vorschlag[] {
  const max = Math.max(1, Math.floor(args.maxUrlaubstage));
  const arbeit = tageZwischen(args.von, args.bis).filter(istArbeitstag);
  const kandidaten: (Vorschlag & { gruppe: string })[] = [];

  for (let i = 0; i < arbeit.length; i++) {
    for (let j = i; j < arbeit.length && j - i + 1 <= max; j++) {
      const urlaubVon = arbeit[i]!;
      const urlaubBis = arbeit[j]!;
      if (args.sperren?.some((s) => ueberschneiden({ von: urlaubVon, bis: urlaubBis }, s))) continue;
      // Freie Zeit ausdehnen — links nicht vor den frühesten Tag (Vergangenes zählt nicht).
      let freiVon = urlaubVon;
      while (addiereTage(freiVon, -1) >= args.von && !istArbeitstag(addiereTage(freiVon, -1))) freiVon = addiereTage(freiVon, -1);
      let freiBis = urlaubBis;
      for (let n = 0; n < 20 && !istArbeitstag(addiereTage(freiBis, 1)); n++) freiBis = addiereTage(freiBis, 1);
      const block = tageZwischen(freiVon, freiBis);
      const anlassTage = block.filter(istFreierWerktag);
      if (anlassTage.length === 0) continue;
      const urlaubstage = j - i + 1;
      kandidaten.push({
        urlaubVon, urlaubBis, freiVon, freiBis, urlaubstage,
        freieTage: block.length,
        faktor: block.length / urlaubstage,
        anlass: anlassTage.map((t) => feiertag(t)!),
        gruppe: anlassTage[0]!,
      });
    }
  }

  const besser = (a: Vorschlag, b: Vorschlag) =>
    b.faktor - a.faktor || b.freieTage - a.freieTage || a.urlaubVon.localeCompare(b.urlaubVon);
  const gruppen = new Map<string, typeof kandidaten>();
  for (const k of kandidaten) gruppen.set(k.gruppe, [...(gruppen.get(k.gruppe) ?? []), k]);

  const raus: Vorschlag[] = [];
  for (const liste of gruppen.values()) {
    // Bester Block je Anzahl Urlaubstage …
    const jeStufe = new Map<number, Vorschlag>();
    for (const k of liste) {
      const alt = jeStufe.get(k.urlaubstage);
      if (!alt || besser(k, alt) < 0) jeStufe.set(k.urlaubstage, k);
    }
    // … und davon nur die Stufen, an denen sich mehr Urlaub lohnt.
    let zuletztTage = 0, zuletztFrei = 0;
    for (const n of [...jeStufe.keys()].sort((a, b) => a - b)) {
      const k = jeStufe.get(n)!;
      if (k.freieTage - zuletztFrei > n - zuletztTage && k.faktor >= MIN_FAKTOR) {
        const { gruppe: _g, ...v } = k as Vorschlag & { gruppe: string };
        raus.push(v);
        zuletztTage = n;
        zuletztFrei = k.freieTage;
      }
    }
  }
  return raus.sort(besser).slice(0, args.anzahl ?? 12);
}
