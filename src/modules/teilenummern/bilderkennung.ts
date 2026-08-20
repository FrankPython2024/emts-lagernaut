import { frage, alsJson, istEingerichtet } from "@/lib/ki/gemini";
import { STANDARD_TEILE } from "@/modules/einlagern/constants";
import { normalisiere, istPlausibel, schlageNach } from "./service";

// ── Ersatzteil aus einem Foto bestimmen ──────────────────────────────────────
//
// Beantwortet genau zwei Fragen: Was ist das für ein Teil, und was steht drauf.
//
// ⚠️ Was hier bewusst NICHT gefragt wird: in welche Geräte das Teil passt.
// Diese Frage kann ein Bildmodell nicht überprüfbar beantworten — es würde eine
// flüssige, plausible und möglicherweise erfundene Liste liefern, und niemand
// könnte ihr ansehen, dass sie falsch ist. Der Teiltyp dagegen ist überprüfbar:
// Die Person hält das Teil in der Hand und sieht sofort, ob „Tastatur" stimmt.
//
// Modelle kommen weiterhin nur aus dem Spendergerät, aus der Nummernsuche oder
// von Hand. Das ist auch die Zusage, die AfB nach außen gegeben hat.

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
  sicherheit:  number;          // 0–100, wie das Modell sich selbst einschätzt
  bemerkung:   string | null;
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
    "- Nenne NIEMALS Gerätemodelle, in die das Teil passen könnte. Das wird hier",
    "  nicht gefragt und wäre geraten.",
    "- bemerkung nur für etwas Auffälliges, etwa sichtbare Beschädigung.",
  ].join("\n");
}

type RohAntwort = {
  teiltyp?:    string | null;
  hersteller?: string | null;
  nummern?:    unknown;
  sicherheit?: unknown;
  bemerkung?:  string | null;
};

export async function erkenneTeil(input: {
  uebersicht:  { base64: string; mimeType: string };
  ausschnitte?: { base64: string; mimeType: string }[];
}): Promise<ErkennungsErgebnis> {
  const leer: ErkennungsErgebnis = {
    ok: false, teiltyp: null, teiltypLabel: null, hersteller: null,
    nummern: [], bekannt: null, sicherheit: 0, bemerkung: null,
  };

  if (!istEingerichtet()) {
    return { ...leer, grund: "Bilderkennung ist nicht eingerichtet (GEMINI_API_KEY fehlt)." };
  }

  // Übersichtsbild zuerst, danach die Ausschnitte. Die Reihenfolge steht auch
  // in der Anweisung — sonst weiß das Modell nicht, was es vor sich hat.
  const bilder = [input.uebersicht, ...(input.ausschnitte ?? [])].slice(0, 4);
  const antwort = await frage(anweisung(), bilder);
  if (!antwort.ok) return { ...leer, grund: antwort.grund };

  const roh = alsJson<RohAntwort>(antwort.text);
  if (!roh) {
    // ⚠️ Den Anfang der Antwort mitgeben. „Antwort war nicht lesbar" allein
    // sagt niemandem, ob das Modell Unsinn geliefert hat, mitten im Satz
    // abgebrochen wurde oder eine Fehlermeldung im Klartext geschickt hat.
    return {
      ...leer,
      grund: `Antwort war nicht lesbar. Anfang der Antwort: ${antwort.text.slice(0, 180)}`,
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

  // ── Kennen wir eine der Nummern schon? ──────────────────────────────────
  // Dann ist die Erkennung nur noch Beiwerk: Was ein Mensch früher bestätigt
  // hat, schlägt jede Modellantwort.
  let bekannt: ErkennungsErgebnis["bekannt"] = null;
  for (const n of nummern) {
    const treffer = await schlageNach(n);
    if (treffer) {
      bekannt = {
        nummer:     treffer.nummer,
        teiltyp:    treffer.teiltyp,
        hersteller: treffer.hersteller,
        modelle:    treffer.modelle.length,
      };
      break;
    }
  }

  return {
    ok:           true,
    teiltyp:      teil?.id    ?? null,
    teiltypLabel: teil?.label ?? null,
    hersteller,
    nummern,
    bekannt,
    sicherheit,
    bemerkung:    typeof roh.bemerkung === "string" ? roh.bemerkung.slice(0, 200) : null,
  };
}
