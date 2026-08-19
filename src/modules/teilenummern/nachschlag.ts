import { prisma } from "@/core/db/prisma";
import { suche, istEingerichtet, verbrauchHeute, type Fundstelle } from "@/lib/suche";
import { normalisiere, kandidaten } from "./service";

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
};

export async function schlageAutomatischNach(teilenummerId: number): Promise<NachschlagErgebnis> {
  const tn = await prisma.teilenummer.findUnique({
    where:   { id: teilenummerId },
    include: { modelle: { select: { modellId: true, quelle: true } } },
  });
  if (!tn) throw new Error("Teilenummer nicht gefunden.");

  const leer = { gesucht: [], fundstellen: [], vorschlaege: [], ankerFehlt: false };

  if (!istEingerichtet()) {
    return {
      ok: false, ...leer,
      grund: "Keine Suchquelle eingerichtet. Modelle lassen sich weiterhin von Hand eintragen.",
      verbrauchHeute: 0,
    };
  }

  const begriffe = kandidaten(tn.nummer);
  const roh: Fundstelle[] = [];
  let letzterGrund: string | undefined;

  // ⚠️ Nummer in Anführungszeichen suchen, sonst sucht die Suchmaschine
  // „ungefähr so" und liefert bei langen Ziffernfolgen Paketverfolgungen und
  // Rechnungsnummern. Der Zusatz „laptop" verankert das Umfeld zusätzlich.
  for (const begriff of begriffe) {
    const r = await suche(`"${begriff}" laptop`);
    if (!r.ok) { letzterGrund = r.grund; break; }
    roh.push(...r.fundstellen);
    if (roh.length >= 10) break;
  }

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
  const fundstellen = echte.length >= 2 ? echte : roh;
  const schwach     = echte.length < 2;

  if (fundstellen.length === 0) {
    return {
      ok: false, ...leer, gesucht: begriffe,
      grund: letzterGrund ?? "Nichts gefunden. Diese Nummer scheint im Netz nicht aufzutauchen.",
      verbrauchHeute: await verbrauchHeute(),
    };
  }

  // ── Der eigentliche Abgleich ────────────────────────────────────────────
  // Titel und Ausrisse zu einem Text zusammenschütten, normalisieren, und dann
  // jeden bekannten Modellnamen darin suchen.
  const heuhaufen = normalisiere(
    fundstellen.map((f) => `${f.titel} ${f.ausriss}`).join(" "),
  );

  const modelle = await prisma.geraeteModell.findMany({
    where:  { aktiv: true },
    select: { id: true, hersteller: true, modell: true },
  });

  const bekannt = new Set(tn.modelle.map((m) => m.modellId));
  const spender = tn.modelle.filter((m) => m.quelle === "SPENDER").map((m) => m.modellId);

  const vorschlaege: Vorschlag[] = [];
  for (const m of modelle) {
    // Ohne Hersteller-Präfix suchen: In Anzeigen steht meist „ProBook 440 G6",
    // nicht „HP ProBook 440 G6". Der Hersteller steckt ohnehin im Kontext.
    const nadel = normalisiere(m.modell);
    // Sehr kurze Modellnamen wie „5490" träfen zufällig in Preisen und
    // Artikelnummern. Erst ab sechs Zeichen ist ein Treffer aussagekräftig.
    if (nadel.length < 6) continue;

    let treffer = 0, pos = heuhaufen.indexOf(nadel);
    while (pos !== -1) { treffer++; pos = heuhaufen.indexOf(nadel, pos + nadel.length); }

    if (treffer > 0) {
      vorschlaege.push({
        modellId: m.id,
        name:     `${m.hersteller} ${m.modell}`.trim(),
        treffer,
        bereits:  bekannt.has(m.id),
      });
    }
  }

  vorschlaege.sort((a, b) => b.treffer - a.treffer || a.name.localeCompare(b.name));

  // ── Prüfstein: das Spendermodell MUSS vorkommen ─────────────────────────
  // Wenn bekannt ist, aus welchem Gerät das Teil stammt, dieses Modell aber in
  // keiner Fundstelle auftaucht, passt etwas nicht zusammen. Dann ist die
  // Nummer falsch gelesen oder die Fundstellen gehören zu einem anderen Teil.
  const ankerFehlt = spender.length > 0
    && !vorschlaege.some((v) => spender.includes(v.modellId));

  return {
    ok: true,
    schwach,
    gesucht: begriffe,
    fundstellen: fundstellen.slice(0, 8),
    vorschlaege: vorschlaege.slice(0, 40),
    ankerFehlt,
    verbrauchHeute: await verbrauchHeute(),
  };
}
