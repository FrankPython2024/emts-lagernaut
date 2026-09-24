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
  /** Bestand aller Artikel dieses Modells und Teiltyps. */
  bestand:     number;
};

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
// DRUCK   = fertig geslict (.gcode.3mf / .gcode) — geht ohne Slicer an den Drucker.
// PROJEKT = Bambu-Studio-Projekt (.3mf) — belegte Platte samt Einstellungen.
// QUELLE  = Konstruktion (STEP, STL, …) — damit sie nicht auf einem PC verloren geht.
export type DateiArt = "DRUCK" | "PROJEKT" | "QUELLE";

const QUELL_ENDUNGEN = [".step", ".stp", ".stl", ".obj", ".f3d", ".scad", ".fcstd", ".iges", ".igs"];

export function dateiArt(dateiname: string): DateiArt | null {
  const n = dateiname.trim().toLowerCase();
  if (n.endsWith(".gcode.3mf") || n.endsWith(".gcode")) return "DRUCK";
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
