// ── Wegführung im Pickup ──────────────────────────────────────────────────────
//
// Beantwortet am Handgerät die Frage „Wo gehe ich als Nächstes hin?" — vorher
// zeigte die Scan-Seite nur eine Colli-Liste nach Menge, der Stellplatz stand
// klein unter jedem Gerät. Gemessen am 23.09.2026 an „Richard 179" (179 Geräte,
// 115 Collis, 31 Stellplätze): Start am hinteren Ende, dann hin und her
// (07-32 → 07-30 → 07-32 → 07-30 → 07-28 → 07-30 → 07-32 → 07-08 …),
// 92 Minuten für 48 Geräte.
//
// Drei Regeln, alle reine Funktionen (Test: `npm run test:route`):
//
// 1. LAUFREIHENFOLGE (`ordneWeg`). ⚠️ In der Halle liegen die Reihen HL-06 und
//    HL-07 GEGENÜBER (Frank, 23.09.2026) — sie bilden einen Gang und werden in
//    einem Durchgang abgelaufen, links und rechts im Wechsel nach Platznummer.
//    Paarbildung: Gang = ⌊Reihe / 2⌋ (06+07, 08+09 …). Das ist aus EINEM Paar
//    abgeleitet; stimmt es für andere Reihen nicht, nur `gangVon` anpassen.
//    Aufeinanderfolgende Gänge in Schlangenlinie (einer hinauf, der nächste
//    herunter). Andere Stellplatz-Formate (ETL-…, Broker) natürlich sortiert.
//
// 2. 80/20 (`planeRunden`). Wunsch Frank: dort anfangen, wo die meisten
//    LogIDs liegen. Die Stellplätze mit den meisten offenen Geräten bilden die
//    HAUPTRUNDE, bis sie zusammen 80 % der Geräte tragen; der Rest (meist
//    Einzelstücke verstreut) kommt als RESTRUNDE zum Schluss.
//
// 3. NÄCHSTER HALT (`naechsterHalt`). Start = vollster offener Stellplatz der
//    Hauptrunde. Danach immer der NÄCHSTGELEGENE offene Stellplatz derselben
//    Runde (Abstand in der Laufreihenfolge), bei Gleichstand in der bisherigen
//    Laufrichtung weiter. Wer woanders scannt, wird dort abgeholt — der Halt
//    folgt dem Menschen, nicht umgekehrt.

export type Runden = {
  /** Stellplätze der Hauptrunde (zusammen ≥ 80 % der offenen Geräte). */
  haupt: Set<string>;
  /** Anteil der Geräte, den die Hauptrunde trägt (0–1). */
  anteilHaupt: number;
};

/** Ab so vielen Stellplätzen lohnt eine Trennung in Haupt- und Restrunde. */
const MIN_HALTE_FUER_RUNDEN = 4;
export const HAUPTRUNDE_ANTEIL = 0.8;

type Zerlegt = { prefix: string; zahlen: number[] };

/** „HL-07-08-02" → { prefix: "HL", zahlen: [7, 8, 2] } */
export function zerlegeStellplatz(sp: string): Zerlegt {
  const teile = sp.trim().toUpperCase().split(/[-\s_/.]+/).filter(Boolean);
  const text: string[] = [];
  const zahlen: number[] = [];
  for (const t of teile) {
    if (/^\d+$/.test(t)) zahlen.push(Number(t));
    else text.push(t);
  }
  return { prefix: text.join("-"), zahlen };
}

/** Gegenüberliegende Hochregal-Reihen teilen sich einen Gang (06+07, 08+09 …). */
export function gangVon(reihe: number): number {
  return Math.floor(reihe / 2);
}

function istHochregal(z: Zerlegt): boolean {
  return z.prefix === "HL" && z.zahlen.length >= 2;
}

function vergleicheZahlen(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? -1) - (b[i] ?? -1);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Laufreihenfolge der Stellplätze. „" (ohne Stellplatz) steht immer am Ende.
 * Stabil: gleiche Eingabe → gleiche Reihenfolge, unabhängig von der Eingabefolge.
 */
export function ordneWeg(stellplaetze: string[]): string[] {
  const eindeutig = [...new Set(stellplaetze)];
  const z = new Map(eindeutig.map((s) => [s, zerlegeStellplatz(s)]));

  // Schlangenlinie: Richtung je Gang nach seiner Position unter den VORHANDENEN
  // Gängen — sonst liefe man bei Lücken (Gang 3 und 5) zweimal in dieselbe Richtung.
  const gaenge = [...new Set(
    eindeutig.map((s) => z.get(s)!).filter(istHochregal).map((t) => gangVon(t.zahlen[0]!)),
  )].sort((a, b) => a - b);
  const aufwaerts = new Map(gaenge.map((g, i) => [g, i % 2 === 0]));

  return eindeutig.sort((a, b) => {
    if (a === "" || b === "") return a === "" ? (b === "" ? 0 : 1) : -1;
    const za = z.get(a)!, zb = z.get(b)!;
    const p = za.prefix.localeCompare(zb.prefix, "de");
    if (p !== 0) return p;
    if (istHochregal(za) && istHochregal(zb)) {
      const [ra, pa, ...resta] = za.zahlen as [number, number, ...number[]];
      const [rb, pb, ...restb] = zb.zahlen as [number, number, ...number[]];
      const ga = gangVon(ra), gb = gangVon(rb);
      if (ga !== gb) return ga - gb;
      if (pa !== pb) return aufwaerts.get(ga) ? pa - pb : pb - pa;
      if (ra !== rb) return ra - rb; // gegenüber: erst die eine, dann die andere Seite
      return vergleicheZahlen(resta, restb);
    }
    const d = vergleicheZahlen(za.zahlen, zb.zahlen);
    return d !== 0 ? d : a.localeCompare(b, "de");
  });
}

/**
 * 80/20: vollste Stellplätze zuerst, bis 80 % der offenen Geräte abgedeckt sind.
 * Bei wenigen Stellplätzen gibt es keine Restrunde — da lohnt die Trennung nicht.
 */
export function planeRunden(offen: Map<string, number>, weg: string[], anteil = HAUPTRUNDE_ANTEIL): Runden {
  const kandidaten = [...offen.entries()].filter(([, n]) => n > 0);
  const gesamt = kandidaten.reduce((s, [, n]) => s + n, 0);
  if (gesamt === 0) return { haupt: new Set(), anteilHaupt: 0 };
  if (kandidaten.length < MIN_HALTE_FUER_RUNDEN) {
    return { haupt: new Set(kandidaten.map(([k]) => k)), anteilHaupt: 1 };
  }
  const idx = new Map(weg.map((k, i) => [k, i]));
  kandidaten.sort((a, b) => b[1] - a[1] || (idx.get(a[0]) ?? 0) - (idx.get(b[0]) ?? 0));
  const haupt = new Set<string>();
  let summe = 0;
  for (const [k, n] of kandidaten) {
    if (summe >= anteil * gesamt) break;
    haupt.add(k);
    summe += n;
  }
  return { haupt, anteilHaupt: summe / gesamt };
}

/**
 * Welcher Stellplatz ist jetzt dran?
 *  • Der aktuelle, solange dort noch etwas offen ist.
 *  • Ohne aktuellen Halt: der vollste offene Stellplatz der Hauptrunde.
 *  • Sonst: der nächstgelegene offene der laufenden Runde (Hauptrunde, bis sie
 *    leer ist, dann Restrunde), bei Gleichstand in Laufrichtung.
 * `null` = nichts mehr offen.
 */
export function naechsterHalt(args: {
  weg: string[];
  offen: Map<string, number>;
  haupt: Set<string>;
  aktuell: string | null;
  richtung: 1 | -1;
}): string | null {
  const { weg, offen, haupt, aktuell, richtung } = args;
  const istOffen = (k: string) => (offen.get(k) ?? 0) > 0;
  if (aktuell !== null && istOffen(aktuell)) return aktuell;

  const offeneHaupt = weg.filter((k) => haupt.has(k) && istOffen(k));
  const pool = offeneHaupt.length > 0 ? offeneHaupt : weg.filter(istOffen);
  if (pool.length === 0) return null;

  const aktIdx = aktuell === null ? -1 : weg.indexOf(aktuell);
  if (aktIdx < 0) {
    // Start: dort, wo am meisten liegt. Gleichstand → früher auf dem Weg.
    return pool.reduce((best, k) => ((offen.get(k) ?? 0) > (offen.get(best) ?? 0) ? k : best), pool[0]!);
  }
  const imPool = new Set(pool);
  for (let d = 1; d < weg.length; d++) {
    const vor = weg[aktIdx + d * richtung];
    if (vor !== undefined && imPool.has(vor)) return vor;
    const zurueck = weg[aktIdx - d * richtung];
    if (zurueck !== undefined && imPool.has(zurueck)) return zurueck;
  }
  return pool[0]!;
}

/** Laufrichtung eines Wechsels von `von` nach `nach` (für den Gleichstand). */
export function richtungVon(weg: string[], von: string | null, nach: string, bisher: 1 | -1): 1 | -1 {
  if (von === null) return bisher;
  const d = weg.indexOf(nach) - weg.indexOf(von);
  return d > 0 ? 1 : d < 0 ? -1 : bisher;
}
