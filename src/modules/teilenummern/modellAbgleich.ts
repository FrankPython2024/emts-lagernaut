import { normalisiere } from "./normalisierung";

// ── Modellnamen in Fundstellen wiedererkennen ────────────────────────────────
//
// Warum es diese Datei gibt — belegt am HP-USB-Board DA0X8JTB8D0 (20.08.2026):
//
// Der frühere Abgleich klebte den Text zusammen (Leerzeichen raus) und suchte
// darin den Modellnamen als Stück, also „PROBOOK440G6". In acht echten
// Fundstellen kam dieses Stück NULL Mal vor — obwohl fünf davon das Board
// ausdrücklich einem ProBook 440 G6 zuordnen. Der Grund:
//
//   „HP ProBook 440 445R G6 G7 ZHAN 66 Pro 14 G2"
//   „for HP 440 G6 440 G7 / 450 G6 450 G7 / 445 G6 445 G7 / 455 G6 455 G7"
//   „For HP ProBook 440 450 G6"
//
// Händler schreiben FAMILIEN, keine Einzelmodelle: Zahlen und Generationen
// stehen als Liste nebeneinander, und die Serie („ProBook") fehlt meistens
// ganz. Wir suchten nach Sätzen, im Netz stehen Listen.
//
// Deshalb wird hier auf Wortebene verglichen statt auf zusammengeklebtem Text:
// Ein Modell zerfällt in Serie („ProBook"), Zahl („440") und Generation
// („G6"); ein Treffer liegt vor, wenn Zahl und Generation nah beieinander in
// derselben Fundstelle stehen.
//
// ⚠️ Zwei Trefferarten, und die Unterscheidung ist wichtig:
//   WOERTLICH — der vollständige Name stand wirklich da. Verlässlich.
//   FAMILIE   — aus einer Sammelangabe abgeleitet. Meist richtig, aber eben
//               abgeleitet. Muss im UI erkennbar sein und darf nicht
//               vorausgewählt werden.
//
// Es wird weiterhin NICHTS geschrieben. Nach außen ist zugesagt, Kompatibili-
// täten nur zu pflegen, wenn sie sicher sind — der Klick eines Menschen bleibt
// dazwischen.

export type TrefferArt = "WOERTLICH" | "FAMILIE";

export type Textstelle = { titel: string; ausriss: string };

export type AbgleichTreffer = {
  art:     TrefferArt;
  /** Wie oft der Name vorkam — grobes Vertrauensmaß. */
  treffer: number;
  /** 1-basierte Nummern der Fundstellen, die diesen Vorschlag belegen. */
  belege:  number[];
};

/**
 * Wie weit Zahl und Generation auseinanderstehen dürfen.
 *
 * Drei Wörter, und die Zahl ist an echten Daten gemessen:
 *   „440 445R G6 G7"  — Abstand 440→G7 ist 3, muss durchkommen.
 *   „445 G6 66 14 G2" — Abstand 445→G2 ist 4, darf NICHT durchkommen,
 *                       sonst entsteht aus „ZHAN 66 Pro 14 G2" ein
 *                       ProBook 445 G2. (Fundstelle 6 und 8 zu DA0X8JTB8D0.)
 *
 * Der Preis dieser Enge: Eine sehr lange Aufzählung wie „440 445 450 455 G6"
 * verliert das erste Glied. Verschmerzbar — solche Listen nennen dasselbe
 * Modell fast immer noch an anderer Stelle, und ein verpasster Vorschlag ist
 * harmloser als ein erfundener.
 */
const FENSTER = 3;

/** Zerlegt Text in Wörter aus Buchstaben und Ziffern — groß, ohne Zeichensatz-Ballast. */
export function tokenisiere(roh: string): string[] {
  const aus: string[] = [];
  for (const t of roh.toUpperCase().split(/[^A-Z0-9]+/)) {
    if (!t) continue;
    // „440G6" ohne Leerzeichen kommt vor und wäre sonst ein einziges Wort,
    // das weder als Zahl noch als Generation erkannt wird.
    const geteilt = t.match(/^(\d{2,5})(G\d{1,2})$/);
    if (geteilt) { aus.push(geteilt[1], geteilt[2]); continue; }
    aus.push(t);
  }
  return aus;
}

/** Sieht das Wort aus wie die tragende Modellzahl? („440", „5490", „15U") */
function istZahl(t: string): boolean {
  return /^\d{2,5}[A-Z]{0,2}$/.test(t)
    && t.length >= 3
    && (t.match(/\d/g)?.length ?? 0) >= 2;
}

/** Generationskürzel: G4 … G12. */
function istGeneration(t: string): boolean {
  return /^G\d{1,2}$/.test(t);
}

export type ModellKern = {
  /** Serienwörter, z. B. ["PROBOOK"] oder ["PROBOOK", "X360"]. */
  serie: string[];
  /** Die tragende Zahl, z. B. "440" — null, wenn keine erkennbar ist. */
  zahl:  string | null;
  /** Generationskürzel, z. B. "G6" — null bei Modellen ohne Generation. */
  gen:   string | null;
};

/**
 * „ProBook 440 G6" → { serie: ["PROBOOK"], zahl: "440", gen: "G6" }
 *
 * ⚠️ Modelle wie „ThinkPad T480s" haben keine eigenständige Zahl (T480S ist
 * ein Wort) und bekommen deshalb keinen Familien-Abgleich. Für sie bleibt es
 * beim wörtlichen Vergleich, so wie bisher. Lieber ehrlich nichts finden als
 * über eine erfundene Regel etwas Falsches.
 */
export function zerlegeModell(modell: string): ModellKern {
  const serie: string[] = [];
  let zahl: string | null = null;
  let gen:  string | null = null;

  for (const t of tokenisiere(modell)) {
    if (!gen  && istGeneration(t)) { gen  = t; continue; }
    if (!zahl && istZahl(t))       { zahl = t; continue; }
    serie.push(t);
  }
  return { serie, zahl, gen };
}

export type VorbereiteteStelle = { tokens: string[]; glue: string };

/**
 * Einmal je Suche vorbereiten, nicht je Modell.
 *
 * Der Abgleich läuft über den gesamten Katalog (rund 1160 Modelle). Würde der
 * Text für jedes Modell neu zerlegt, wären das über tausend Durchläufe pro
 * Fundstelle.
 */
export function bereiteStellenVor(stellen: Textstelle[]): VorbereiteteStelle[] {
  return stellen.map((s) => {
    const text = `${s.titel} ${s.ausriss}`;
    return { tokens: tokenisiere(text), glue: normalisiere(text) };
  });
}

/** Zählt, wie oft `nadel` in `heu` steckt. */
function zaehleStueck(heu: string, nadel: string): number {
  let anzahl = 0, pos = heu.indexOf(nadel);
  while (pos !== -1) { anzahl++; pos = heu.indexOf(nadel, pos + nadel.length); }
  return anzahl;
}

/**
 * Familien-Treffer in EINER Fundstelle zählen.
 *
 * Regel, je nach Bauart des Modellnamens:
 *   mit Generation  — Zahl und Generation stehen höchstens FENSTER Wörter
 *                     auseinander („440 … G6"). Die Serie darf fehlen, denn im
 *                     Handel steht meist nur „HP 440 G6".
 *   ohne Generation — dann trägt die Zahl allein zu wenig („5490" träfe in
 *                     jeder Preisangabe), also muss ein Serienwort in
 *                     Reichweite stehen („Latitude 5480 5490 5590").
 */
function familienTreffer(kern: ModellKern, tokens: string[]): number {
  if (!kern.zahl) return 0;

  const partner = kern.gen ? [kern.gen] : kern.serie.filter((s) => s.length >= 4);
  if (partner.length === 0) return 0;

  let anzahl = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] !== kern.zahl) continue;
    const von = Math.max(0, i - FENSTER);
    const bis = Math.min(tokens.length - 1, i + FENSTER);
    for (let j = von; j <= bis; j++) {
      if (j !== i && partner.includes(tokens[j])) { anzahl++; break; }
    }
  }
  return anzahl;
}

/**
 * Ein Katalogmodell gegen alle Fundstellen halten.
 *
 * Liefert null, wenn nichts passt. Sonst die Trefferart, die Anzahl und die
 * Nummern der belegenden Fundstellen — damit im UI neben jedem Vorschlag
 * steht, woher er stammt. Ohne diesen Beleg ist ein Vorschlag für den
 * Menschen nicht überprüfbar, und dann darf er auch nicht bestätigt werden.
 */
export function gleicheModellAb(
  modell: { hersteller: string; modell: string },
  stellen: VorbereiteteStelle[],
): AbgleichTreffer | null {
  const kern  = zerlegeModell(modell.modell);
  const nadel = normalisiere(modell.modell);
  const marke = tokenisiere(modell.hersteller)[0] ?? "";

  let woertlich = 0, familie = 0;
  const belegeWoertlich = new Set<number>();
  const belegeFamilie   = new Set<number>();

  stellen.forEach((s, i) => {
    // Wörtlich: der vollständige Name stand wirklich da. Sehr kurze Namen wie
    // „5490" bleiben ausgeschlossen — die träfen zufällig in Artikelnummern.
    if (nadel.length >= 6) {
      const n = zaehleStueck(s.glue, nadel);
      if (n > 0) { woertlich += n; belegeWoertlich.add(i + 1); }
    }

    // Familie: nur, wenn der Hersteller in derselben Fundstelle vorkommt.
    // Ohne diese Klammer würde „440 G6" auch dort zählen, wo von einem ganz
    // anderen Hersteller die Rede ist.
    if (marke && s.tokens.includes(marke)) {
      const n = familienTreffer(kern, s.tokens);
      if (n > 0) { familie += n; belegeFamilie.add(i + 1); }
    }
  });

  if (woertlich > 0) {
    return {
      art:     "WOERTLICH",
      treffer: woertlich,
      belege:  Array.from(belegeWoertlich).sort((a, b) => a - b),
    };
  }
  if (familie > 0) {
    return {
      art:     "FAMILIE",
      treffer: familie,
      belege:  Array.from(belegeFamilie).sort((a, b) => a - b),
    };
  }
  return null;
}
