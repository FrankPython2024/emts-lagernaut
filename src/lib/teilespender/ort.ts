/**
 * Wo steht das Gerät — und wie sicher ist das?
 *
 * Für jedes Spendergerät gibt es **zwei** unabhängige Ortsangaben:
 *   • aus dem **Verwertungs-Export** (`VerwertungsGeraet`)
 *   • aus dem **Lagerfuchs** (`LogIdStand`)
 * Beide werden von Hand importiert, in eigenem Rhythmus, und jede trägt je
 * Gerät ein `zuletztGesehen`.
 *
 * ⚠️ Warum das nötig ist: Der Ort veraltet schnell. Gemessen am 10.09.2026 an
 * den 5.376 freigegebenen Spendern — die beiden Importe lagen nur **2 Tage**
 * auseinander, und trotzdem wichen bei **580 Geräten (10,8 %)** Stellplatz oder
 * Colli voneinander ab. Über 90 Tage hat **59 %** des Bestands mindestens
 * einmal den Platz gewechselt; dabei ziehen Stellplatz und Colli fast immer
 * gemeinsam um (5.258 von 5.611 Colli-Wechseln am selben Tag) — die Geräte
 * werden also **umgepackt**, nicht nur umgestellt. Ein „stabiler Karton", auf
 * den man sich verlassen könnte, existiert nicht.
 *
 * ⚠️ Ein automatischer Abruf aus ReForm ist **nicht erlaubt** (AfB-IT). Das
 * Beste, was ohne ihn geht, ist deshalb: je Gerät die **jüngere** der beiden
 * Angaben nehmen und einen Widerspruch **nicht verschweigen**, sondern beide
 * Orte nennen. Wer zwei Adressen bekommt, sucht an zwei Stellen — wer eine
 * falsche bekommt, läuft umsonst und glaubt dem System beim nächsten Mal nicht.
 *
 * Reine Logik, kein Netz, keine Datenbank — prüfbar über tests/ort.test.ts.
 */

export type OrtQuelle = "VERWERTUNG" | "LAGERFUCHS";

export type Ortsangabe = {
  stellplatz: string | null;
  colli: string | null;
  /** Wann diese Angabe zuletzt bestätigt wurde. */
  standAm: Date;
};

export type Ort = {
  stellplatz: string | null;
  colli: string | null;
  quelle: OrtQuelle;
  standAm: Date;
  /**
   * Die andere Quelle sagt etwas anderes. null = beide einig (oder es gibt nur
   * eine). Ist das gesetzt, gehört es ins UI — beide Stellen sind zu prüfen.
   */
  abweichung: (Ortsangabe & { quelle: OrtQuelle }) | null;
};

/** Zwei Ortsangaben gelten als gleich, wenn Fach UND Karton übereinstimmen. */
export function gleicherOrt(a: Ortsangabe, b: Ortsangabe): boolean {
  return norm(a.stellplatz) === norm(b.stellplatz) && norm(a.colli) === norm(b.colli);
}

function norm(v: string | null): string {
  return (v ?? "").trim().toLowerCase();
}

/**
 * Entscheidet, welche Angabe gilt.
 *
 * Regel: die **jüngere** gewinnt. Bei exakt gleichem Stand gewinnt der
 * Verwertungs-Export — er ist die Quelle, aus der die Spenderliste überhaupt
 * entsteht, und ein Gleichstand ist praktisch nur bei „beide sagen dasselbe"
 * zu erwarten.
 *
 * ⚠️ Eine fehlende Ortsangabe (beide Felder leer) ist **kein** gültiger Stand.
 * Sonst überschriebe ein frischer Import mit leerem Feld eine ältere, aber
 * brauchbare Adresse — und die Liste zeigte „—" statt eines Regals.
 */
export function besterOrt(
  verwertung: Ortsangabe | null,
  lagerfuchs: Ortsangabe | null,
): Ort | null {
  const v = brauchbar(verwertung) ? verwertung : null;
  const l = brauchbar(lagerfuchs) ? lagerfuchs : null;

  if (!v && !l) return null;
  if (v && !l) return { ...v, quelle: "VERWERTUNG", abweichung: null };
  if (!v && l) return { ...l, quelle: "LAGERFUCHS", abweichung: null };

  const vv = v!;
  const ll = l!;
  const verwertungGewinnt = vv.standAm.getTime() >= ll.standAm.getTime();
  const sieger = verwertungGewinnt ? vv : ll;
  const andere = verwertungGewinnt ? ll : vv;
  const siegerQuelle: OrtQuelle = verwertungGewinnt ? "VERWERTUNG" : "LAGERFUCHS";
  const andereQuelle: OrtQuelle = verwertungGewinnt ? "LAGERFUCHS" : "VERWERTUNG";

  return {
    stellplatz: sieger.stellplatz,
    colli: sieger.colli,
    quelle: siegerQuelle,
    standAm: sieger.standAm,
    abweichung: gleicherOrt(vv, ll) ? null : { ...andere, quelle: andereQuelle },
  };
}

function brauchbar(o: Ortsangabe | null): o is Ortsangabe {
  return o !== null && (norm(o.stellplatz) !== "" || norm(o.colli) !== "");
}

/** Kurztext für die Anzeige, z. B. „ETL-HL-7-7-2 · Colli 3.186.244". */
export function ortText(o: Pick<Ortsangabe, "stellplatz" | "colli">): string {
  const teile = [o.stellplatz, o.colli ? `Colli ${o.colli}` : null].filter(
    (t): t is string => Boolean(t && t.trim()),
  );
  return teile.length > 0 ? teile.join(" · ") : "—";
}
