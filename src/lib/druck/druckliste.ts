// ── 3D-Druck: Druckliste und Dateiarten (Sep 2026) ──────────────────────────
//
// Gemessen am 24.09.2026: Als „3D-Druck" gebucht wurden 799 Füße für 7 Modelle,
// fast alles liegt noch auf Lager. Gefragt wurden in 90 Tagen Füße für 45 Modelle.
// Die Druckliste stellt deshalb Nachfrage gegen Bestand und Vorlagen:
//   • „Jetzt drucken"      — Vorlage da, Bestand reicht nicht.
//   • „Konstruieren lohnt" — gefragt, aber keine Vorlage.
// ⚠️ Beide Listen rechnen mit UNGEDECKTER Nachfrage, nicht mit der Nachfrage
// allein: U7411 Fuß hinten hatte 7 Anfragen, aber 230 Stück auf Lager — nach
// Anfragen sortiert stand er ganz oben. Der Bestand kommt auch aus alten
// Drucken ohne Kennzeichnung (E14: 370 Stück Eingang ohne „3D-Druck").
//
// Reine Logik, Test: `npm run test:druck`.

/** Teiltypen, für die „Konstruieren lohnt sich" überhaupt gerechnet wird. */
export const DRUCK_TEILTYPEN_STANDARD = ["Füße vorne", "Füße hinten"] as const;

/** Nachfrage je Modell und Teiltyp (Schlüssel wie in der Teilespender-Suche). */
export type BedarfZeile = {
  key:         string;
  teiltyp:     string;
  /** Anzeigename, z. B. „Lenovo ThinkPad E14 Gen 4". */
  name:        string;
  /** Anfragen im Zeitraum (ohne Storno, ohne Test-Modus). */
  anfragen:    number;
  /** Stück im Zeitraum (Füße-Anfragen können menge 2 haben). */
  stueck:      number;
  /** Stück in noch offenen Anfragen (NEU, BEDARF, IN_BEARBEITUNG). */
  offenStueck: number;
  /** Bestand dieses Modells und Teiltyps — geteilte Artikel anteilig (siehe verteileBestand). */
  bestand:     number;
  /** Bestandsgruppen (Artikel samt Pool-Partner), an denen die Zeile hängt. */
  gruppen?:    number[];
};

// ── Bestand verteilen (Audit 30.09.2026) ─────────────────────────────────────
// ⚠️ Vorher zählte jede Zeile den vollen Bestand ihrer Artikel. Hängt ein Artikel
// an zwei Modellen (E14 Gen 2 und Gen 3, 79 Stück), stand er in BEIDEN Zeilen
// mit 79 — bei je 60 Stück Bedarf erschien keine Lücke, obwohl 120 > 79.
// Und der Ersatzteil-Pool (vorne ↔ hinten baugleich, src/lib/artikel/pool.ts)
// fehlte ganz: „hinten" 0 Stück hieß „Jetzt drucken", obwohl das Techniker-
// Portal aus den 200 Stück „vorne" bedient.
// Jetzt: Artikel und Pool-Partner bilden EINE Bestandsgruppe, und deren Bestand
// wird auf alle Zeilen, die daran hängen, nach ihrer Nachfrage verteilt (ohne
// Nachfrage zu gleichen Teilen). Zusammen ergibt das genau den echten Bestand.

export type ArtikelBestand = { id: number; bestand: number; poolPartnerId: number | null };

/** Gruppe eines Artikels: mit Pool-Partner die kleinere Id der beiden. */
export function bestandsGruppe(a: ArtikelBestand, alle: ReadonlyMap<number, ArtikelBestand>): number {
  const p = a.poolPartnerId;
  return p != null && alle.has(p) ? Math.min(a.id, p) : a.id;
}

export function verteileBestand(
  links: readonly { zeile: string; artikelId: number }[],
  artikel: ReadonlyMap<number, ArtikelBestand>,
  gewicht: (zeile: string) => number,
): { jeZeile: Map<string, number>; gruppenJeZeile: Map<string, number[]>; gruppeBestand: Map<number, number> } {
  const gruppeBestand = new Map<number, number>();
  const zeilenJeGruppe = new Map<number, Set<string>>();
  const gruppenJeZeile = new Map<string, number[]>();
  for (const { zeile, artikelId } of links) {
    const a = artikel.get(artikelId);
    if (!a) continue;
    const g = bestandsGruppe(a, artikel);
    if (!gruppeBestand.has(g)) {
      const mitglieder = new Set([a.id, ...(a.poolPartnerId != null && artikel.has(a.poolPartnerId) ? [a.poolPartnerId] : [])]);
      gruppeBestand.set(g, [...mitglieder].reduce((s, id) => s + Math.max(0, artikel.get(id)!.bestand), 0));
    }
    const z = zeilenJeGruppe.get(g) ?? new Set<string>();
    z.add(zeile);
    zeilenJeGruppe.set(g, z);
    const gl = gruppenJeZeile.get(zeile) ?? [];
    if (!gl.includes(g)) gl.push(g);
    gruppenJeZeile.set(zeile, gl);
  }
  const roh = new Map<string, number>();
  for (const [g, zeilen] of zeilenJeGruppe) {
    const bestand = gruppeBestand.get(g) ?? 0;
    const liste = [...zeilen];
    const summe = liste.reduce((s, z) => s + Math.max(0, gewicht(z)), 0);
    for (const z of liste) {
      const anteil = summe > 0 ? Math.max(0, gewicht(z)) / summe : 1 / liste.length;
      roh.set(z, (roh.get(z) ?? 0) + bestand * anteil);
    }
  }
  // Abrunden: nie mehr Bestand versprechen, als da ist (lieber ein Stück mehr drucken).
  const jeZeile = new Map([...roh].map(([z, b]) => [z, Math.floor(b + 1e-9)]));
  return { jeZeile, gruppenJeZeile, gruppeBestand };
}

export type VorlageKurz = {
  id:              number;
  name:            string;
  teiltypen:       string[];
  modellKeys:      string[];
  stueckProPlatte: number | null;
};

export type DruckZeile = BedarfZeile & {
  vorlageId:    number;
  vorlageName:  string;
  /** So viele Stück fehlen für offene Anfragen plus Vorrat. */
  fehlt:        number;
  /** Druckplatten dafür (nur mit bekannter Stückzahl je Platte). */
  platten:      number | null;
  /** Wie viele Tage reicht der Bestand beim bisherigen Verbrauch? null = kein Verbrauch. */
  reichweiteTage: number | null;
};

export type KonstruierZeile = BedarfZeile & {
  /** Ungedeckt: Vorrat + offen − Bestand. 0 = Bestand reicht (vorerst). */
  fehlt:          number;
  reichweiteTage: number | null;
};

export type Druckliste = {
  drucken:      DruckZeile[];
  konstruieren: KonstruierZeile[];
  /** Modell+Teiltyp mit Vorlage, deren Bestand reicht. */
  versorgt:     number;
};

export function planeDruckliste(
  bedarf: BedarfZeile[],
  vorlagen: VorlageKurz[],
  opts: { tage: number; vorratTage: number; minAnfragenKonstruieren: number },
): Druckliste {
  const vorlageFuer = (key: string, teiltyp: string) =>
    vorlagen.find((v) => v.modellKeys.includes(key) && v.teiltypen.includes(teiltyp));

  const drucken: DruckZeile[] = [];
  const konstruieren: KonstruierZeile[] = [];
  let versorgt = 0;

  for (const b of bedarf) {
    const v = vorlageFuer(b.key, b.teiltyp);
    const proTag = b.stueck / Math.max(1, opts.tage);
    const vorrat = Math.ceil(proTag * opts.vorratTage);
    const fehlt = Math.max(0, vorrat + b.offenStueck - b.bestand);
    const reichweiteTage = proTag > 0 ? Math.floor(b.bestand / proTag) : null;
    if (v) {
      if (fehlt === 0) { versorgt++; continue; }
      drucken.push({
        ...b,
        vorlageId:      v.id,
        vorlageName:    v.name,
        fehlt,
        platten:        v.stueckProPlatte && v.stueckProPlatte > 0 ? Math.ceil(fehlt / v.stueckProPlatte) : null,
        reichweiteTage,
      });
    } else if (b.anfragen >= opts.minAnfragenKonstruieren) {
      konstruieren.push({ ...b, fehlt, reichweiteTage });
    }
  }

  drucken.sort((a, b) => b.fehlt - a.fehlt || a.name.localeCompare(b.name));
  // Ungedeckt zuerst; bei gedeckter Nachfrage die mit der kürzesten Reichweite.
  konstruieren.sort((a, b) =>
    b.fehlt - a.fehlt
    || (a.reichweiteTage ?? Infinity) - (b.reichweiteTage ?? Infinity)
    || b.stueck - a.stueck
    || a.name.localeCompare(b.name));
  return { drucken, konstruieren, versorgt };
}

// ── Dateiarten ───────────────────────────────────────────────────────────────
// DRUCK   = fertig geslict (.gcode.3mf) — geht ohne Slicer an den Drucker. Reines .gcode
//           nimmt die Druckbrücke nicht (sie braucht Platte + Filamente aus der .3mf) —
//           seit dem Audit 30.09.2026 deshalb auch beim Hochladen abgelehnt.
// PROJEKT = Bambu-Studio-Projekt (.3mf) — belegte Platte samt Einstellungen.
// QUELLE  = Konstruktion (STEP, STL, …) — damit sie nicht auf einem PC verloren geht.
export type DateiArt = "DRUCK" | "PROJEKT" | "QUELLE";

const QUELL_ENDUNGEN = [".step", ".stp", ".stl", ".obj", ".f3d", ".scad", ".fcstd", ".iges", ".igs"];

export function dateiArt(dateiname: string): DateiArt | null {
  const n = dateiname.trim().toLowerCase();
  if (n.endsWith(".gcode.3mf")) return "DRUCK";
  if (n.endsWith(".3mf")) return "PROJEKT";
  if (QUELL_ENDUNGEN.some((e) => n.endsWith(e))) return "QUELLE";
  return null;
}

export const DATEI_ART_TEXT: Record<DateiArt, string> = {
  DRUCK:   "Druckdatei (geslict)",
  PROJEKT: "Bambu-Studio-Projekt",
  QUELLE:  "Konstruktion",
};

/** Obergrenze je Datei. MySQL erlaubt 64 MB je Paket; Luft für den Rest der Anfrage. */
export const DATEI_MAX_BYTES = 40 * 1024 * 1024;

/** Teiltypen einer Vorlage liegen als Text „Füße vorne|Füße hinten" in der DB. */
export function teiltypenAus(text: string | null | undefined): string[] {
  return (text ?? "").split("|").map((t) => t.trim()).filter((t) => t.length > 0);
}
export function teiltypenText(liste: string[]): string {
  return [...new Set(liste.map((t) => t.trim()).filter((t) => t.length > 0))].join("|");
}
