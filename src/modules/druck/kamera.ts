// ── Kamerabild des Druckers (3D-Druck, Stufe 1 „Standbild", 30.09.2026) ───────
//
// Die Druckbrücke am Laptop schickt Schlüsselbilder (H.264, Annex-B, ~70 KB,
// etwa alle 1,5–4 s) aus dem RTSPS-Strom des P2S hierher; Chrome setzt sie auf
// der Druckerkarte mit WebCodecs zusammen. Der Server speichert nur das JEWEILS
// LETZTE Bild — kein Verlauf, keine Aufzeichnung.
//
// ⚠️ Die Brücke holt nur Bilder, solange jemand zuschaut: Jeder Abruf eines
// Betrachters verlängert die Nachfrage um KAMERA_NACHFRAGE_MS, die Brücke erfährt
// das bei ihrer Meldung (alle 5 s). Sonst liefe der Strom rund um die Uhr durchs
// Gast-WLAN.
//
// Ablage im Prozessspeicher über globalThis — Upload und Abruf sind beides
// Pages-API-Routen im selben Node-Prozess, und ein verlorenes Bild nach einem
// Neustart ist kein Schaden (das nächste kommt in Sekunden). Kein Redis nötig.

export const KAMERA_NACHFRAGE_MS = 30_000;
/** Ein 1080p-Schlüsselbild hat ~50–80 KB; alles weit darüber ist kein Kamerabild. */
export const KAMERA_MAX_BYTES = 1_000_000;

export type KameraBild = { daten: Buffer; codec: string; am: number; nr: number };
type Speicher = { bild: KameraBild | null; gewuenschtBis: number; nr: number };

const g = globalThis as unknown as { __druckKamera?: Speicher };
function speicher(): Speicher {
  return (g.__druckKamera ??= { bild: null, gewuenschtBis: 0, nr: 0 });
}

/** H.264-Codec-Kennung, wie der Browser-Decoder sie erwartet („avc1.641029"). */
export function codecGueltig(codec: unknown): codec is string {
  return typeof codec === "string" && /^avc1\.[0-9a-fA-F]{6}$/.test(codec);
}

/** Beginnt der Inhalt wie ein H.264-Datenstrom (Annex-B-Startcode)? */
export function siehtAusWieH264(daten: Buffer): boolean {
  return daten.length > 8 && daten[0] === 0 && daten[1] === 0 &&
    (daten[2] === 1 || (daten[2] === 0 && daten[3] === 1));
}

/** Ein Betrachter fragt ein Bild ab → die Brücke soll (weiter) liefern. */
export function kameraAnfordern(jetzt = Date.now()): void {
  speicher().gewuenschtBis = jetzt + KAMERA_NACHFRAGE_MS;
}

/** Schaut gerade jemand zu? Steht in der Antwort auf jede Brücken-Meldung. */
export function kameraGewuenscht(jetzt = Date.now()): boolean {
  return speicher().gewuenschtBis > jetzt;
}

export function kameraBildSpeichern(daten: Buffer, codec: string, jetzt = Date.now()): number {
  const s = speicher();
  s.nr += 1;
  s.bild = { daten, codec, am: jetzt, nr: s.nr };
  return s.nr;
}

export function kameraBild(): KameraBild | null {
  return speicher().bild;
}
