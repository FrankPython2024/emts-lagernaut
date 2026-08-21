import { prisma } from "@/core/db/prisma";
import { frage, alsJson, istEingerichtet } from "@/lib/ki/gemini";
import { STANDARD_TEILE } from "@/modules/einlagern/constants";
import { normalisiere, istPlausibel, schlageNach } from "./service";

// ── Ersatzteil aus einem Foto bestimmen ──────────────────────────────────────
//
// Beantwortet genau zwei Fragen: Was ist das für ein Teil, und was steht drauf.
//
// Zusätzlich werden mögliche Geräte genannt — aber unter strengen Auflagen.
//
// ⚠️ Der Teiltyp ist überprüfbar: Die Person hält das Teil in der Hand und
// sieht sofort, ob „Tastatur" stimmt. Eine Geräteliste ist es NICHT. Ein
// Bildmodell nennt auf diese Frage immer etwas, flüssig und überzeugend, auch
// wenn es nichts weiß.
//
// Deshalb drei Auflagen für die Geräte-Vorschläge:
//   1. Sie werden gegen die EIGENE Modelltabelle gefiltert. Was es bei euch
//      nicht gibt, verschwindet — das erledigt die meisten Erfindungen.
//   2. Sie werden nirgends gespeichert. Diese Funktion liefert Anzeige, keine
//      Daten.
//   3. Sie sind in der Oberfläche als unbestätigt gekennzeichnet.
//
// Echte Kompatibilitäten kommen weiterhin nur aus dem Spendergerät, aus der
// Nummernsuche mit Fundstellen oder von Hand. Das ist die Zusage, die AfB nach
// außen gegeben hat, und sie bleibt unangetastet.

const HERSTELLER = ["HP", "Lenovo", "Dell", "Fujitsu", "unbekannt"] as const;

export type ErkennungsErgebnis = {
  ok:          boolean;
  grund?:      string;
  teiltyp:     string | null;   // Kennung aus STANDARD_TEILE oder null
  teiltypLabel: string | null;
  hersteller:  string | null;
  /** Alle lesbaren Zeichenketten, gefiltert und normalisiert. */
  nummern:     string[];
  /** Nummer, die Lagernaut bereits kennt — dann ist alles Weitere überflüssig. */
  bekannt:     { nummer: string; teiltyp: string | null; hersteller: string | null; modelle: number } | null;
  /**
   * Mögliche Geräte, gefiltert gegen die eigene Modelltabelle.
   * ⚠️ UNBESTÄTIGT. Nur Anzeige, wird nirgends gespeichert.
   */
  geraete:     { modellId: number; name: string }[];
  /**
   * Genannte Geräte, die es in unserem Katalog NICHT gibt.
   * Bewusst sichtbar: Sonst lässt sich „hat nichts erkannt" nicht von
   * „alles rausgefiltert" unterscheiden — und man sucht an der falschen Stelle.
   */
  geraeteVerworfen: string[];
  sicherheit:  number;          // 0–100, wie das Modell sich selbst einschätzt
  bemerkung:   string | null;
  /**
   * Wo die Zeit geblieben ist, in Millisekunden — `ki` ist die Anfrage an
   * Gemini, `pruefung` das Abgleichen gegen die eigenen Tabellen.
   *
   * Steht in der Oberfläche, damit an der Werkbank sichtbar ist, worauf
   * gewartet wird, statt nur ein Rad drehen zu sehen.
   */
  dauer: { ki: number; pruefung: number; gesamt: number };
};

function anweisung(): string {
  const liste = STANDARD_TEILE.map((t) => `"${t.id}"`).join(", ");
  return [
    "Du siehst Fotos eines ausgebauten Notebook-Ersatzteils. Das erste Bild zeigt das ganze Teil,",
    "die weiteren sind Ausschnitte von beschrifteten Stellen in voller Auflösung.",
    "",
    "Antworte NUR mit JSON in genau dieser Form:",
    "{",
    '  "teiltyp": <einer dieser Werte oder null>,',
    `  "hersteller": <einer von ${HERSTELLER.map((h) => `"${h}"`).join(", ")}>,`,
    '  "nummern": [<alle lesbaren aufgedruckten Codes als Zeichenketten>],',
    '  "geraete": [<Notebook-Modelle, in die dieses Teil passt — nur wenn du es WIRKLICH weisst, sonst leere Liste>],',
    '  "sicherheit": <0 bis 100>,',
    '  "bemerkung": <ein kurzer Satz auf Deutsch oder null>',
    "}",
    "",
    `Erlaubte Werte für teiltyp: ${liste}`,
    "",
    "Regeln:",
    "- teiltyp nur setzen, wenn du dir sicher bist. Sonst null. Rate nicht.",
    "- Bei nummern ALLE aufgedruckten Codes aufnehmen: Teilenummern, FRU-Nummern,",
    "  Platinenaufdrucke, Modellnummern. Barcodes nicht abtippen, nur Klartext.",
    "- Keine Seriennummern erfinden und keine Zeichen ergänzen, die du nicht siehst.",
    "  Lieber eine Nummer weniger als eine falsche.",
    "- Bei geraete die Notebook-Modelle nennen, in die dieses Teil passt, in der",
    "  Schreibweise des Herstellers (z. B. \"ThinkPad T14 Gen 1\", \"ProBook 440 G6\").",
    "  Nenne ruhig mehrere, wenn ein Teil ueber eine Baureihe hinweg verwendet wird.",
    "  Erfinde aber nichts: Wenn du das Teil nicht zuordnen kannst, leere Liste.",
    "- bemerkung nur für etwas Auffälliges, etwa sichtbare Beschädigung.",
  ].join("\n");
}

type RohAntwort = {
  teiltyp?:    string | null;
  hersteller?: string | null;
  nummern?:    unknown;
  geraete?:    unknown;
  sicherheit?: unknown;
  bemerkung?:  string | null;
};

export async function erkenneTeil(input: {
  uebersicht:  { base64: string; mimeType: string };
  ausschnitte?: { base64: string; mimeType: string }[];
}): Promise<ErkennungsErgebnis> {
  const beginn = Date.now();
  const leer: ErkennungsErgebnis = {
    ok: false, teiltyp: null, teiltypLabel: null, hersteller: null,
    nummern: [], bekannt: null, geraete: [], geraeteVerworfen: [], sicherheit: 0, bemerkung: null,
    dauer: { ki: 0, pruefung: 0, gesamt: 0 },
  };

  if (!istEingerichtet()) {
    return { ...leer, grund: "Bilderkennung ist nicht eingerichtet (GEMINI_API_KEY fehlt)." };
  }

  // Übersichtsbild zuerst, danach die Ausschnitte. Die Reihenfolge steht auch
  // in der Anweisung — sonst weiß das Modell nicht, was es vor sich hat.
  const bilder = [input.uebersicht, ...(input.ausschnitte ?? [])].slice(0, 4);
  const antwort = await frage(anweisung(), bilder);
  const kiMs = antwort.dauerMs;
  const dauer = () => ({ ki: kiMs, pruefung: Date.now() - beginn - kiMs, gesamt: Date.now() - beginn });

  if (!antwort.ok) return { ...leer, grund: antwort.grund, dauer: dauer() };

  const roh = alsJson<RohAntwort>(antwort.text);
  if (!roh) {
    // ⚠️ Den Anfang der Antwort mitgeben. „Antwort war nicht lesbar" allein
    // sagt niemandem, ob das Modell Unsinn geliefert hat, mitten im Satz
    // abgebrochen wurde oder eine Fehlermeldung im Klartext geschickt hat.
    return {
      ...leer,
      grund: `Antwort war nicht lesbar. Anfang der Antwort: ${antwort.text.slice(0, 180)}`,
      dauer: dauer(),
    };
  }

  // ── Alles gegen die eigene Wirklichkeit prüfen ──────────────────────────
  // Was nicht in unsere Listen passt, wird verworfen statt übernommen.
  const teil = STANDARD_TEILE.find((t) => t.id === roh.teiltyp);
  const hersteller = HERSTELLER.includes(roh.hersteller as typeof HERSTELLER[number])
    && roh.hersteller !== "unbekannt"
      ? roh.hersteller as string
      : null;

  const nummern = Array.isArray(roh.nummern)
    ? Array.from(new Set(
        roh.nummern
          .filter((n): n is string => typeof n === "string")
          .map(normalisiere)
          // Dieselbe Plausibilitätsprüfung wie beim Scannen: mindestens fünf
          // Zeichen, mindestens eine Ziffer. Wirft „REV", „MADE IN CHINA" und
          // ähnliche Etikettentexte weg.
          .filter(istPlausibel),
      )).slice(0, 8)
    : [];

  const sicherheit = typeof roh.sicherheit === "number"
    ? Math.max(0, Math.min(100, Math.round(roh.sicherheit)))
    : 0;

  // ── Geräte gegen die eigene Tabelle prüfen ──────────────────────────────
  // Nur was es bei euch wirklich gibt, wird angezeigt. Ein erfundenes oder
  // ein nie geführtes Modell fällt hier heraus, ohne dass jemand es bemerken
  // muss. Verglichen wird mit und ohne Hersteller-Präfix, weil das Modell mal
  // „ThinkPad T14 Gen 1" und mal „Lenovo ThinkPad T14 Gen 1" schreibt.
  const geraete: { modellId: number; name: string }[] = [];
  const genannt = Array.isArray(roh.geraete)
    ? roh.geraete.filter((g): g is string => typeof g === "string" && g.trim().length > 2)
    : [];
  const verworfen: string[] = [];

  if (genannt.length > 0) {
    const alle = await prisma.geraeteModell.findMany({
      where:  { aktiv: true },
      select: { id: true, hersteller: true, modell: true },
    });

    // ⚠️ NICHT auf exakte Gleichheit prüfen. Das Modell schreibt „ThinkPad T14
    // Gen 1", im Katalog steht vielleicht „T14 Gen 1" oder „ThinkPad T14 G1".
    // Ein Vergleich auf Gleichheit hat deshalb alles verworfen, und weil nichts
    // angezeigt wurde, sah es aus wie „hat nichts erkannt".
    //
    // Stattdessen: Steckt der eine Name im anderen? Das trifft beide
    // Richtungen und ist bei Modellnamen zuverlässig genug, weil sie lang und
    // eigen sind.
    for (const g of genannt) {
      const gesucht = normalisiere(g);
      if (gesucht.length < 5) { verworfen.push(g); continue; }

      const treffer = alle.find((m) => {
        const kurz = normalisiere(m.modell);
        const voll = normalisiere(`${m.hersteller} ${m.modell}`);
        if (kurz.length < 5) return false;
        return gesucht.includes(kurz) || kurz.includes(gesucht)
            || gesucht === voll || voll.includes(gesucht);
      });

      if (treffer) {
        const name = `${treffer.hersteller} ${treffer.modell}`.trim();
        if (!geraete.some((x) => x.modellId === treffer.id)) {
          geraete.push({ modellId: treffer.id, name });
        }
      } else {
        verworfen.push(g);
      }
    }
  }

  // ── Kennen wir eine der Nummern schon? ──────────────────────────────────
  // Dann ist die Erkennung nur noch Beiwerk: Was ein Mensch früher bestätigt
  // hat, schlägt jede Modellantwort.
  //
  // ⚠️ GLEICHZEITIG nachschlagen, nicht nacheinander. Auf einem Etikett
  // stehen bis zu acht lesbare Codes; einzeln abgefragt waren das acht
  // Datenbank-Rundreisen hintereinander, während jemand vor dem Bildschirm
  // wartet. Die Reihenfolge bleibt trotzdem gewahrt: Es gewinnt die erste
  // Nummer aus der Liste, die einen Treffer hat — nicht die schnellste Abfrage.
  const treffer = await Promise.all(nummern.map((n) => schlageNach(n)));
  const ersterTreffer = treffer.find(Boolean);

  const bekannt: ErkennungsErgebnis["bekannt"] = ersterTreffer
    ? {
        nummer:     ersterTreffer.nummer,
        teiltyp:    ersterTreffer.teiltyp,
        hersteller: ersterTreffer.hersteller,
        modelle:    ersterTreffer.modelle.length,
      }
    : null;

  return {
    ok:           true,
    teiltyp:      teil?.id    ?? null,
    teiltypLabel: teil?.label ?? null,
    hersteller,
    nummern,
    bekannt,
    geraete: geraete.slice(0, 12),
    geraeteVerworfen: verworfen.slice(0, 8),
    sicherheit,
    bemerkung:    typeof roh.bemerkung === "string" ? roh.bemerkung.slice(0, 200) : null,
    dauer: dauer(),
  };
}
