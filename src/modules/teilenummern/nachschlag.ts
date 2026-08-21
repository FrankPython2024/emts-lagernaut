import { prisma } from "@/core/db/prisma";
import { suche, istEingerichtet, verbrauchHeute, type Fundstelle } from "@/lib/suche";
import { normalisiere, kandidaten } from "./service";
import {
  bereiteStellenVor, gleicheModellAb, vollerName, taugtAlsVorschlag, entferneAllgemeinere,
  type TrefferArt,
} from "./modellAbgleich";

// ── Automatisches Nachschlagen einer Teilenummer ─────────────────────────────
//
// Der Kniff: Das ist KEINE offene Leseaufgabe, sondern ein Abgleich gegen eine
// geschlossene Liste. Gefragt ist nicht „welche Modelle stehen auf dieser
// Seite", sondern „welche UNSERER 1160 Modelle kommen dort vor". Dafür genügt
// stumpfer Textvergleich, es braucht kein Sprachmodell.
//
// ⚠️ Es wird nichts geschrieben. Diese Datei liefert Vorschläge samt
// Fundstellen; übernommen wird erst nach Bestätigung durch einen Menschen.
// Grund: Nach außen ist zugesagt, Kompatibilitäten nur zu pflegen, wenn sie
// sicher sind. Ein Treffer in einer Verkaufsanzeige ist das nicht.

export type Vorschlag = {
  modellId:  number;
  name:      string;
  /** Wie oft der Name in den Fundstellen vorkam — grobes Vertrauensmaß. */
  treffer:   number;
  /** Steht dieses Modell schon als gesicherte Spender-Aussage fest? */
  bereits:   boolean;
  /**
   * WOERTLICH — der volle Name stand so im Text.
   * FAMILIE   — aus einer Sammelangabe wie „440 445R G6 G7" abgeleitet.
   */
  art:       TrefferArt;
  /**
   * Nummern der Fundstellen, die diesen Vorschlag belegen (1-basiert, passend
   * zur Reihenfolge in `fundstellen`).
   *
   * ⚠️ Das ist kein Beiwerk. Ohne Beleg kann ein Mensch einen Vorschlag nicht
   * überprüfen — und dann darf er ihn auch nicht bestätigen.
   */
  belege:    number[];
};

export type NachschlagErgebnis = {
  ok:          boolean;
  grund?:      string;
  /** Kaum eine Fundstelle enthielt die Nummer wirklich — Vorschläge mit Vorsicht. */
  schwach?:    boolean;
  gesucht:     string[];
  fundstellen: Fundstelle[];
  vorschlaege: Vorschlag[];
  /** Spendermodell nicht unter den Funden — starkes Warnsignal. */
  ankerFehlt:  boolean;
  verbrauchHeute: number;
  /**
   * Wo die Zeit geblieben ist, in Millisekunden.
   *
   * Steht in der Oberfläche, damit an der Werkbank sichtbar ist, worauf
   * gewartet wird — und damit sich beim nächsten Mal messen statt raten lässt,
   * ob eine Änderung wirklich etwas gebracht hat.
   */
  dauer: { suche: number; abgleich: number; gesamt: number };
};

/**
 * Kern der Suche — arbeitet auf einer ROHEN Nummer.
 *
 * Bewusst ohne Datenbank-Id: Beim Fotoweg gibt es die Teilenummer noch gar
 * nicht, sie entsteht erst beim Buchen. Trotzdem soll schon vorher stehen, in
 * welche Geräte das Teil passt — sonst müsste man erst einlagern und dann
 * nachschlagen, und das ist die falsche Reihenfolge.
 */
export async function sucheModelleZuNummer(
  nummer: string,
  bekannt: number[] = [],
  spender: number[] = [],
): Promise<NachschlagErgebnis> {
  const beginn = Date.now();
  let sucheMs = 0;
  const tn = { nummer, modelle: [] as { modellId: number; quelle: string }[] };
  const bekanntSet = new Set(bekannt);

  const leer = { gesucht: [], fundstellen: [], vorschlaege: [], ankerFehlt: false };
  const dauer = () => ({ suche: sucheMs, abgleich: Date.now() - beginn - sucheMs, gesamt: Date.now() - beginn });

  if (!istEingerichtet()) {
    return {
      ok: false, ...leer,
      grund: "Keine Suchquelle eingerichtet. Modelle lassen sich weiterhin von Hand eintragen.",
      verbrauchHeute: 0, dauer: dauer(),
    };
  }

  const begriffe = kandidaten(tn.nummer);
  const roh: Fundstelle[] = [];
  let letzterGrund: string | undefined;

  // ⚠️ Gestaffelt suchen, und zwar in dieser Reihenfolge:
  //
  //   1. Nummer in Anführungszeichen — exakt. Liefert nur echte Treffer,
  //      aber eben auch keine, wenn die Nummer so nirgends steht.
  //   2. Dieselbe Nummer ohne Anführungszeichen. Bringt mehr, auch Rauschen;
  //      das fängt der Filter unten wieder ein.
  //
  // Bewusst OHNE Zusatzwort wie „laptop": Das schließt Seiten aus, die
  // „Notebook" schreiben oder auf Deutsch sind. Genau daran ist der erste
  // Versuch gescheitert.
  const versuche: string[] = [];
  for (const b of begriffe) versuche.push(`"${b}"`);
  for (const b of begriffe) versuche.push(b);

  // ⚠️ Die ersten beiden Versuche laufen GLEICHZEITIG.
  //
  // Vorher lief das nacheinander: erst die Nummer in Anführungszeichen, dann,
  // wenn noch nicht genug zusammenkam, die nächste Schreibweise. Bei
  // DA0X8JTB8D0 kamen aus dem ersten Lauf 8 Fundstellen — also immer zu wenig
  // für die Abbruchgrenze, also immer ein zweiter Lauf, also immer zweimal
  // warten. Zwei gleichzeitige Abfragen kosten dieselbe Zeit wie eine.
  //
  // Zwei bleibt die Obergrenze fürs Gleichzeitige: Mehr belastet die eigene
  // Instanz spürbar und bringt beim Abgleich nichts mehr dazu.
  const sucheBeginn = Date.now();
  const gleichzeitig = versuche.slice(0, 2);
  const ergebnisse = await Promise.all(gleichzeitig.map((b) => suche(b)));

  for (const r of ergebnisse) {
    if (!r.ok) { letzterGrund = r.grund; continue; }
    roh.push(...r.fundstellen);
  }

  // Nur wenn beide zusammen zu wenig hergeben, wird nachgelegt — dann aber
  // wieder einzeln, damit nicht ohne Not weitergesucht wird.
  if (roh.length < 4) {
    for (const begriff of versuche.slice(2)) {
      const r = await suche(begriff);
      if (!r.ok) { letzterGrund = r.grund; break; }
      roh.push(...r.fundstellen);
      if (roh.length >= 10) break;
    }
  }
  sucheMs = Date.now() - sucheBeginn;

  // ── Rauschen wegwerfen ──────────────────────────────────────────────────
  // Eine Fundstelle, in der die Nummer nicht einmal vorkommt, sagt nichts über
  // dieses Teil. Modellnamen darin wären reiner Zufall.
  const passtZurNummer = (f: Fundstelle) => {
    const text = normalisiere(`${f.titel} ${f.ausriss}`);
    return begriffe.some((b) => text.includes(b));
  };
  const echte = roh.filter(passtZurNummer);

  // Nur aussortieren, wenn danach noch etwas übrig bleibt. Bleibt nichts,
  // arbeiten wir mit dem Rohmaterial weiter und sagen es dazu — lieber ein
  // schwacher Vorschlag mit Warnung als gar keiner.
  //
  // Dazu Doppelte werfen: Zwei Suchläufe liefern dieselbe Seite gern zweimal.
  // Ungefiltert zählte der Treffer doppelt und die Seite stünde zweimal in
  // der Liste.
  const gesehen = new Set<string>();
  const auswahl = (echte.length >= 2 ? echte : roh)
    .filter((f) => (f.link && gesehen.has(f.link)) ? false : (gesehen.add(f.link), true));

  // ⚠️ Ab hier gilt EINE Liste für Abgleich UND Anzeige.
  //
  // Vorher wurde gegen alle Fundstellen abgeglichen, angezeigt wurden aber nur
  // die ersten acht. Am 20.08.2026 kam so „HP ProBook 440 G7" heraus, während
  // dieser Name in keiner der acht sichtbaren Fundstellen stand — der Beleg lag
  // in einer Fundstelle, die niemand zu sehen bekam. Ein Vorschlag, den man
  // nicht nachprüfen kann, ist für eine Kompatibilität wertlos.
  const fundstellen = auswahl.slice(0, 16);
  const schwach     = echte.length < 2;

  if (fundstellen.length === 0) {
    return {
      ok: false, ...leer, gesucht: begriffe,
      grund: letzterGrund ?? "Nichts gefunden. Diese Nummer scheint im Netz nicht aufzutauchen.",
      verbrauchHeute: await verbrauchHeute(), dauer: dauer(),
    };
  }

  // ── Der eigentliche Abgleich ────────────────────────────────────────────
  // Jede Fundstelle einmal in Wörter zerlegen, dann den gesamten Katalog
  // dagegenhalten. Die Regeln stehen in modellAbgleich.ts — kurz gefasst:
  // erst der volle Name, sonst Zahl und Generation dicht beieinander.
  const stellen = bereiteStellenVor(fundstellen);

  const modelle = await prisma.geraeteModell.findMany({
    where:  { aktiv: true },
    select: { id: true, hersteller: true, modell: true },
  });

  const vorschlaege: Vorschlag[] = [];
  for (const m of modelle) {
    // Einträge, deren Modellname nur der Herstellername ist, sind keine
    // Geräte — und als Suchnadel treffen sie überall. Siehe modellAbgleich.ts.
    if (!taugtAlsVorschlag(m.hersteller, m.modell)) continue;

    const t = gleicheModellAb(m, stellen);
    if (!t) continue;

    vorschlaege.push({
      modellId: m.id,
      name:     vollerName(m.hersteller, m.modell),
      treffer:  t.treffer,
      bereits:  bekanntSet.has(m.id),
      art:      t.art,
      belege:   t.belege,
    });
  }

  // Wörtliche Treffer nach oben: Was ausgeschrieben dastand, ist verlässlicher
  // als was aus einer Sammelangabe abgeleitet wurde.
  vorschlaege.sort((a, b) =>
    (a.art === b.art ? 0 : a.art === "WOERTLICH" ? -1 : 1)
    || b.treffer - a.treffer
    || a.name.localeCompare(b.name),
  );

  // „ThinkPad X1" trifft nur, weil „ThinkPad X1 Carbon Gen 9" ihn enthält.
  // Das ist ein Fund, nicht zwei — also bleibt der genauere stehen.
  const gefiltert = entferneAllgemeinere(vorschlaege);

  // ── Prüfstein: das Spendermodell MUSS vorkommen ─────────────────────────
  // Wenn bekannt ist, aus welchem Gerät das Teil stammt, dieses Modell aber in
  // keiner Fundstelle auftaucht, passt etwas nicht zusammen. Dann ist die
  // Nummer falsch gelesen oder die Fundstellen gehören zu einem anderen Teil.
  const ankerFehlt = spender.length > 0
    && !gefiltert.some((v) => spender.includes(v.modellId));

  return {
    ok: true,
    schwach,
    gesucht: begriffe,
    // Vollständig, nicht gekürzt — die Belegnummern der Vorschläge zeigen
    // hierher und dürfen nicht ins Leere greifen.
    fundstellen,
    vorschlaege: gefiltert.slice(0, 40),
    ankerFehlt,
    verbrauchHeute: await verbrauchHeute(),
    dauer: dauer(),
  };
}

/** Für die Pflegeseite: dieselbe Suche, aber zu einer gespeicherten Nummer. */
export async function schlageAutomatischNach(teilenummerId: number): Promise<NachschlagErgebnis> {
  const tn = await prisma.teilenummer.findUnique({
    where:   { id: teilenummerId },
    include: { modelle: { select: { modellId: true, quelle: true } } },
  });
  if (!tn) throw new Error("Teilenummer nicht gefunden.");

  return sucheModelleZuNummer(
    tn.nummer,
    tn.modelle.map((m) => m.modellId),
    tn.modelle.filter((m) => m.quelle === "SPENDER").map((m) => m.modellId),
  );
}
