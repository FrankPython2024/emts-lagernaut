/**
 * Defekt-Begriffe aus ReForm auf Teiltypen abbilden.
 *
 * Der Verwertungs-Export („Geräte, die es nicht in den Verkauf geschafft haben")
 * führt je Gerät ein Feld `Defekte`. Es ist zu 100 % gefüllt und benutzt eine
 * feste Auswahlliste — gemessen am Export vom 09.09.2026: **53 verschiedene
 * Begriffe über 7.357 Geräte**, kommagetrennt kombiniert.
 *
 * Diese Tabelle übersetzt sie in die Frage, die im Lager zählt:
 * **Ist das Teil, das ich brauche, in diesem Gerät noch brauchbar?**
 *
 * ⚠️ Ein fehlender Eintrag heißt „kein Defekt VERMERKT", nicht „geprüft in
 * Ordnung". Das ist ein Negativbeleg. Er grenzt den Suchraum von tausenden
 * Geräten auf eine Handvoll ein — er ersetzt nicht das Nachsehen. Wer daraus
 * eine Zusage macht, behauptet mehr, als die Daten hergeben.
 */

/** Wie schwer wiegt ein Defekt für die Wiederverwendung des Teils? */
export type Schwere =
  /** Teil ist hin oder fehlt — als Ersatzteil unbrauchbar. */
  | "HART"
  /** Teil funktioniert, sieht aber gebraucht aus. Für viele Zwecke noch gut. */
  | "KOSMETISCH"
  /** Betrifft kein Bauteil (BIOS-Passwort, Löschung, Fernverwaltung). */
  | "KEIN_TEIL"
  /** Ganzes Gerät fällt aus — kein Teil daraus ist verlässlich. */
  | "TOTAL";

export type DefektRegel = {
  begriff:   string;
  schwere:   Schwere;
  /** Betroffene Teiltypen, exakt wie in `Teiltyp.name` / `Kompatibilitaet.teiltyp`. */
  teiltypen: string[];
};

/**
 * Die vollständige Liste, gemessen am Export vom 09.09.2026.
 * Die Zahl in Klammern ist die Häufigkeit dort — sie sagt, worauf es ankommt.
 */
export const DEFEKT_REGELN: DefektRegel[] = [
  // ── Kein Bauteil betroffen ────────────────────────────────────────────────
  { begriff: "Überdurchschnittliche Gebrauchsspuren/nicht entfernbar", schwere: "KOSMETISCH", teiltypen: ["D Cover"] }, // 2600
  { begriff: "Bios PW",                                        schwere: "KEIN_TEIL", teiltypen: [] }, // 1240
  { begriff: "Löschung aufgrund von BIOS-PW nicht möglich",     schwere: "KEIN_TEIL", teiltypen: [] }, // 222
  { begriff: "Löschung konnte nicht durchgeführt werden.",      schwere: "KEIN_TEIL", teiltypen: [] }, // 116
  { begriff: "Fernverwaltung gesetzt/Weiterverkauf nicht möglich", schwere: "KEIN_TEIL", teiltypen: [] }, // 98
  { begriff: "Aktivierungssperre eingeschaltet. Weiterverkauf nicht möglich.", schwere: "KEIN_TEIL", teiltypen: [] }, // 66
  { begriff: "Löschung nur mit einer nicht freigegebenen Löschmethode möglich.", schwere: "KEIN_TEIL", teiltypen: [] }, // 7
  { begriff: "Datenträger Passwort",                            schwere: "KEIN_TEIL", teiltypen: [] }, // 4
  { begriff: "Power-On Passwort",                               schwere: "KEIN_TEIL", teiltypen: [] }, // 1
  { begriff: "Partnerlogo/Benutzerkennung im Startbildschirm",  schwere: "KEIN_TEIL", teiltypen: [] }, // 19
  { begriff: "nicht datenschutzrelevante Benutzerkennung im Startbildschirm", schwere: "KEIN_TEIL", teiltypen: [] }, // 4
  { begriff: "Tabletstift fehlt",                               schwere: "HART", teiltypen: ["Eingabestift"] }, // 32
  { begriff: "Datenträger Caddy fehlt",                         schwere: "KEIN_TEIL", teiltypen: [] }, // 21
  { begriff: "Laufwerk Defekt",                                 schwere: "KEIN_TEIL", teiltypen: [] }, // 2
  { begriff: "Laufwerk nicht vorhanden/Schacht leer",           schwere: "KEIN_TEIL", teiltypen: [] }, // 2
  // ⚠️ Bewusst KEIN_TEIL: Die Ursache kann alles sein. Daraus „Mainboard defekt"
  // zu machen, würde brauchbare Spender aussortieren, ohne dass es jemand
  // geprüft hat.
  { begriff: "Fehlermeldung beim Startvorgang",                 schwere: "KEIN_TEIL", teiltypen: [] }, // 49

  // ── Ganzes Gerät ──────────────────────────────────────────────────────────
  { begriff: "Keine Funktion / Totalschaden",                   schwere: "TOTAL", teiltypen: [] }, // 376
  { begriff: "Gerät ist ausgeschlachtet / Totalschaden",        schwere: "TOTAL", teiltypen: [] }, // 296
  // „Fehlende Komponenten" sagt nicht, welche — damit ist kein Teil zugesichert.
  { begriff: "Fehlende Komponenten",                            schwere: "TOTAL", teiltypen: [] }, // 349

  // ── Gehäuse ───────────────────────────────────────────────────────────────
  { begriff: "Gehäuse beschädigt (Kratzer/Dellen)",             schwere: "KOSMETISCH", teiltypen: ["D Cover"] }, // 1691
  { begriff: "Gehäuse beschädigt (Risse/Brüche)",               schwere: "HART",       teiltypen: ["D Cover"] }, // 1570
  { begriff: "Gehäuse beschädigt (verzogen/verbogen)",          schwere: "HART",       teiltypen: ["D Cover"] }, // 291
  // Eingebranntes Fremdlogo: technisch heil, aber nicht wiederverwendbar.
  { begriff: "Partnerlogo in Gehäuse gebrannt",                 schwere: "HART",       teiltypen: ["D Cover"] }, // 144
  { begriff: "OR-Caen - Logo du partenaire gravé dans le boîtier", schwere: "HART",    teiltypen: ["D Cover"] }, // 1

  // ── Display ───────────────────────────────────────────────────────────────
  { begriff: "Volldefekt des Displays/Display fehlt",           schwere: "HART",       teiltypen: ["Display", "Displaymodul"] }, // 765
  { begriff: "Beschädigungen am Display",                       schwere: "HART",       teiltypen: ["Display", "Displaymodul"] }, // 511
  { begriff: "Gebrauchsspuren am Display",                      schwere: "KOSMETISCH", teiltypen: ["Display", "Displaymodul"] }, // 1208
  // Scharniere gehören zur Displayeinheit, nicht zum nackten Panel.
  { begriff: "Scharnier defekt",                                schwere: "HART",       teiltypen: ["Displaymodul"] }, // 4

  // ── Akku ──────────────────────────────────────────────────────────────────
  { begriff: "Akku defekt",                                     schwere: "HART", teiltypen: ["Akku"] }, // 755
  { begriff: "Akku fehlt",                                      schwere: "HART", teiltypen: ["Akku"] }, // 328
  { begriff: "Akku sicherheitskritisch defekt/ausgebaut",       schwere: "HART", teiltypen: ["Akku"] }, // 44
  { begriff: "Akkukapazität kritisch",                          schwere: "HART", teiltypen: ["Akku"] }, // 7
  { begriff: "Akkugehäuse beschädigt",                          schwere: "HART", teiltypen: ["Akku"] }, // 5
  { begriff: "Akku sicherheitskritisch defekt/nicht ausbaubar/Löschung nicht möglich", schwere: "HART", teiltypen: ["Akku"] }, // 2
  { begriff: "Akku defekt / beschädigt",                        schwere: "HART", teiltypen: ["Akku"] }, // 1

  // ── Eingabe ───────────────────────────────────────────────────────────────
  { begriff: "Tastatur defekt",                                 schwere: "HART", teiltypen: ["Tastatur"] }, // 682
  { begriff: "Tastatur fehlt",                                  schwere: "HART", teiltypen: ["Tastatur"] }, // 148
  { begriff: "Touchpad defekt",                                 schwere: "HART", teiltypen: ["Touchpad", "Touchpad Buttons"] }, // 98
  // Trackpoint sitzt in der Tastatureinheit.
  { begriff: "Trackpoint fehlt",                                schwere: "HART", teiltypen: ["Tastatur"] }, // 140

  // ── Platinen und Anschlüsse ───────────────────────────────────────────────
  { begriff: "Mainboard defekt",                                schwere: "HART", teiltypen: ["Mainboard"] }, // 395
  { begriff: "Schnittstelle defekt",                            schwere: "HART", teiltypen: ["USB Board", "LAN Board"] }, // 249
  { begriff: "Ladeelektronik defekt",                           schwere: "HART", teiltypen: ["DC IN"] }, // 116
  { begriff: "Netzteilanschluss defekt",                        schwere: "HART", teiltypen: ["DC IN"] }, // 40
  { begriff: "CMOS Batterie leer",                              schwere: "HART", teiltypen: ["BIOS Batterie"] }, // 407
  // Webcam ist bei uns KEIN Teiltyp — Begriff bleibt sichtbar, ordnet aber nichts zu.
  { begriff: "Webcam beschädigt",                               schwere: "KEIN_TEIL", teiltypen: [] }, // 17

  // ── Kühlung ───────────────────────────────────────────────────────────────
  { begriff: "CPU Kühler/Lüfter fehlt/defekt",                  schwere: "HART", teiltypen: ["Thermalmodul", "CPU Lüfter"] }, // 31
  { begriff: "Lüfter defekt",                                   schwere: "HART", teiltypen: ["Thermalmodul", "CPU Lüfter"] }, // 25

  // ── Datenträger und Arbeitsspeicher ───────────────────────────────────────
  // ⚠️ „Datenträger" und „Arbeitsspeicher" sind bei uns **Kategorien** im
  // Komponenten-Zweig, KEINE Teiltypen — niemand fragt sie über eine Anfrage an.
  // Sie ordnen darum nichts zu. Der Begriff selbst bleibt in der Trefferliste
  // sichtbar, die Information geht also nicht verloren.
  { begriff: "Datenträger wurde ausgebaut",                     schwere: "KEIN_TEIL", teiltypen: [] }, // 1244
  { begriff: "kein Datenträger vorhanden",                      schwere: "KEIN_TEIL", teiltypen: [] }, // 1236
  { begriff: "Datenträger defekt",                              schwere: "KEIN_TEIL", teiltypen: [] }, // 48
  { begriff: "Datenträger kann nicht ausgebaut werden",         schwere: "KEIN_TEIL", teiltypen: [] }, // 2
  { begriff: "RAM nicht vorhanden",                             schwere: "KEIN_TEIL", teiltypen: [] }, // 854
  { begriff: "RAM defekt",                                      schwere: "KEIN_TEIL", teiltypen: [] }, // 17
];

/** Nachschlagen ohne Rücksicht auf Groß/Klein und Mehrfach-Leerzeichen. */
const NACH_BEGRIFF = new Map(
  DEFEKT_REGELN.map((r) => [normalisiere(r.begriff), r]),
);

export function normalisiere(begriff: string): string {
  return begriff.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Zerlegt den Inhalt des Feldes `Defekte` in Einzelbegriffe.
 *
 * ReForm trennt mit Komma. Klammern enthalten keine Kommata — geprüft an allen
 * 53 Begriffen —, ein einfacher Split ist also sicher.
 */
export function zerlegeDefekte(roh: string | null | undefined): string[] {
  return (roh ?? "").split(",").map((s) => s.trim()).filter((s) => s.length > 0);
}

export type DefektBefund = {
  begriff: string;
  schwere: Schwere;
  teiltypen: string[];
  /** true = Begriff steht nicht in unserer Tabelle. */
  unbekannt: boolean;
};

/**
 * Bewertet einen einzelnen Begriff.
 *
 * ⚠️ Ein unbekannter Begriff wird NICHT verschluckt. ReForm kann die
 * Auswahlliste erweitern; ein still ignorierter neuer Begriff würde ein Gerät
 * als Spender ausweisen, obwohl gerade das gesuchte Teil hin ist. Unbekanntes
 * gilt darum als „kein Teil zugeordnet", wird aber sichtbar mitgeführt und
 * gehört auf die Pflegeliste.
 */
export function bewerte(begriff: string): DefektBefund {
  const treffer = NACH_BEGRIFF.get(normalisiere(begriff));
  if (!treffer) return { begriff, schwere: "KEIN_TEIL", teiltypen: [], unbekannt: true };
  return { begriff, schwere: treffer.schwere, teiltypen: treffer.teiltypen, unbekannt: false };
}

/** Ist das Gerät als Ganzes unbrauchbar? */
export function istTotalschaden(defekte: string[]): boolean {
  return defekte.some((d) => bewerte(d).schwere === "TOTAL");
}

export type TeilZustand = "FREI" | "KOSMETISCH" | "DEFEKT" | "TOTAL";

/**
 * Wie steht es um EIN Teil in diesem Gerät?
 *
 *   FREI       — kein Defekt vermerkt (Negativbeleg, siehe Kopf der Datei)
 *   KOSMETISCH — funktioniert vermutlich, hat aber Gebrauchsspuren
 *   DEFEKT     — als Ersatzteil unbrauchbar
 *   TOTAL      — ganzes Gerät fällt aus
 */
export function zustandFuerTeiltyp(defekte: string[], teiltyp: string): TeilZustand {
  if (istTotalschaden(defekte)) return "TOTAL";
  let kosmetisch = false;
  for (const d of defekte) {
    const b = bewerte(d);
    if (!b.teiltypen.includes(teiltyp)) continue;
    if (b.schwere === "HART") return "DEFEKT";
    if (b.schwere === "KOSMETISCH") kosmetisch = true;
  }
  return kosmetisch ? "KOSMETISCH" : "FREI";
}

/** Alle Teiltypen, die in diesem Gerät hart defekt sind — für den Import. */
export function harteDefektTeiltypen(defekte: string[]): string[] {
  const raus = new Set<string>();
  for (const d of defekte) {
    const b = bewerte(d);
    if (b.schwere === "HART") for (const t of b.teiltypen) raus.add(t);
  }
  return [...raus].sort();
}
