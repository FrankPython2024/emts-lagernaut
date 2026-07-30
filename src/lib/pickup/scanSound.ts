"use client";

/**
 * Kurze Scan-Töne über die Web-Audio-API — KEIN Audio-File (analog ping.ts).
 *
 * Hilft dem Picker, das Ergebnis ohne Hinsehen zu hören:
 *   • GEFUNDEN → heller, freundlicher Doppelton (steigend).
 *   • FREMD    → tiefer, dissonanter Buzz (Sägezahn).
 *   • SCHON    → mittlerer, kurzer Doppel-Blip (Warnung).
 *
 * Autoplay-Policy: der Scan (Enter / Button-Klick) ist eine User-Geste, daher
 * darf der AudioContext hier laufen/„resumen".
 */
let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) audioCtx = new Ctor();
  if (audioCtx.state === "suspended") void audioCtx.resume();
  return audioCtx;
}

function ton(
  ctx: AudioContext,
  freq: number,
  start: number,
  dauer: number,
  type: OscillatorType = "sine",
  vol = 0.18,
): void {
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(vol,    start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dauer);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + dauer + 0.02);
}

// Lauter Ton mit RELATIVEM Start (Sekunden ab jetzt) — für die kräftigen
// LogID-Scan-Signale (benötigt / nicht benötigt). Schneller, harter Attack
// (+0.012 s) und hohe Default-Lautstärke, damit der Picker es im Lager hört.
function tonLaut(
  ctx: AudioContext,
  freq: number,
  start: number,
  dauer: number,
  type: OscillatorType = "sine",
  vol = 0.95,
): void {
  const t   = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const g   = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol,    t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dauer);
  osc.connect(g).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dauer + 0.02);
}

// benötigt / grün: helles, steigendes Doppel-„Ding" (B5 → E6), laut.
export function playScanErfolg(): void {
  try {
    const c = getCtx();
    if (!c) return;
    tonLaut(c, 988,  0,    0.13, "sine", 1.0); // B5
    tonLaut(c, 1319, 0.12, 0.18, "sine", 1.0); // E6
  } catch {
    /* Audio nicht verfügbar — bewusst ignorieren */
  }
}

// nicht benötigt / rot: tiefer, harter, fallender Doppel-Buzz (A3 → D3), laut.
export function playScanNichtBenoetigt(): void {
  try {
    const c = getCtx();
    if (!c) return;
    tonLaut(c, 220, 0,    0.20, "sawtooth", 1.0); // A3
    tonLaut(c, 146, 0.17, 0.30, "sawtooth", 1.0); // D3 (tiefer → fallend)
  } catch {
    /* Audio nicht verfügbar — bewusst ignorieren */
  }
}

// Abschluss-Fanfare: aufsteigender Dreiklang (C-E-G-C), klar unterscheidbar vom
// normalen GEFUNDEN-Ping. Wird nur bei der Live-Vervollständigung gespielt.
export function playComplete(): void {
  try {
    const ctx = getCtx();
    if (!ctx) return;
    const t = ctx.currentTime;
    const noten = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
    noten.forEach((f, i) => ton(ctx, f, t + i * 0.12, 0.16, "sine", 0.85));
  } catch {
    /* Audio nicht verfügbar — bewusst ignorieren */
  }
}

// Negativ-Signal für die Colli-Inhaltsprüfung (0 Treffer / Colli unbekannt).
// Bewusst HÖRBAR ANDERS als die LogID-Scan-Töne: zwei klar absteigende Töne
// (G4 → C4) statt des tiefen FREMD-Buzz — „kein Treffer hier".
export function playNegativeSound(): void {
  try {
    const ctx = getCtx();
    if (!ctx) return;
    const t = ctx.currentTime;
    ton(ctx, 392, t,        0.16, "triangle", 0.75); // G4
    ton(ctx, 261, t + 0.16, 0.22, "triangle", 0.75); // C4 (tiefer → absteigend)
  } catch {
    /* Audio nicht verfügbar — bewusst ignorieren */
  }
}

// Positiv-Signal für die Colli-Inhaltsprüfung (≥1 Treffer). Wiederverwendung des
// freundlichen GEFUNDEN-Doppeltons (steigend) für ein konsistentes „Treffer".
export function playPositiveSound(): void {
  playScanSound("GEFUNDEN");
}

// Hauptcolli-Vorabscan (NUR Colli-Aufträge): „Wegweiser"-Töne, bewusst ANDERS als
// die normalen Scan-Töne — der Picker hört sofort „das war ein Wagen", nicht „ein
// Treffer". Es wird nichts abgehakt.
//   • Treffer (≥1 gesuchter Colli im Wagen) → freundlicher, aufsteigender Dreiklang
//     (A4-C#5-E5), klar getrennt vom GEFUNDEN-Doppelton.
//   • Leer (0 gesuchte) → ein einzelner, neutraler Blip (weder auf- noch absteigend).
export function playWagenTreffer(): void {
  try {
    const ctx = getCtx();
    if (!ctx) return;
    const t = ctx.currentTime;
    const noten = [440, 554.37, 659.25]; // A4 C#5 E5 (Dur-Dreiklang, aufsteigend)
    noten.forEach((f, i) => ton(ctx, f, t + i * 0.09, 0.13, "sine", 0.8));
  } catch {
    /* Audio nicht verfügbar — bewusst ignorieren */
  }
}

export function playWagenLeer(): void {
  try {
    const ctx = getCtx();
    if (!ctx) return;
    const t = ctx.currentTime;
    ton(ctx, 523.25, t, 0.18, "sine", 0.7); // C5, einzeln/neutral — „gesehen, weiter"
  } catch {
    /* Audio nicht verfügbar — bewusst ignorieren */
  }
}

export type ScanResult = "GEFUNDEN" | "FREMD" | "SCHON";

export function playScanSound(result: ScanResult): void {
  if (result === "GEFUNDEN") { playScanErfolg(); return; }        // grün / benötigt
  if (result === "FREMD")    { playScanNichtBenoetigt(); return; } // rot / nicht benötigt
  // SCHON / gelb — mittlerer, kurzer Doppel-Blip (gleiche Tonhöhe → klar als
  // „Warnung" erkennbar, weder auf- noch absteigend). Laut für gute Hörbarkeit.
  try {
    const ctx = getCtx();
    if (!ctx) return;
    const t = ctx.currentTime;
    ton(ctx, 620, t,        0.10, "triangle", 0.85);
    ton(ctx, 620, t + 0.15, 0.10, "triangle", 0.85);
  } catch {
    /* Audio nicht verfügbar — bewusst ignorieren */
  }
}
