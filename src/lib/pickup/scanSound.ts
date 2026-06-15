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

// Abschluss-Fanfare: aufsteigender Dreiklang (C-E-G-C), klar unterscheidbar vom
// normalen GEFUNDEN-Ping. Wird nur bei der Live-Vervollständigung gespielt.
export function playComplete(): void {
  try {
    const ctx = getCtx();
    if (!ctx) return;
    const t = ctx.currentTime;
    const noten = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
    noten.forEach((f, i) => ton(ctx, f, t + i * 0.12, 0.16, "sine", 0.2));
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
    ton(ctx, 392, t,        0.16, "triangle", 0.22); // G4
    ton(ctx, 261, t + 0.16, 0.22, "triangle", 0.22); // C4 (tiefer → absteigend)
  } catch {
    /* Audio nicht verfügbar — bewusst ignorieren */
  }
}

// Positiv-Signal für die Colli-Inhaltsprüfung (≥1 Treffer). Wiederverwendung des
// freundlichen GEFUNDEN-Doppeltons (steigend) für ein konsistentes „Treffer".
export function playPositiveSound(): void {
  playScanSound("GEFUNDEN");
}

export type ScanResult = "GEFUNDEN" | "FREMD" | "SCHON";

export function playScanSound(result: ScanResult): void {
  try {
    const ctx = getCtx();
    if (!ctx) return;
    const t = ctx.currentTime;
    if (result === "GEFUNDEN") {
      ton(ctx, 880,  t,        0.10, "sine");
      ton(ctx, 1320, t + 0.10, 0.16, "sine");
    } else if (result === "SCHON") {
      ton(ctx, 620, t,        0.09, "triangle");
      ton(ctx, 620, t + 0.14, 0.09, "triangle");
    } else {
      // FREMD — tief + dissonant
      ton(ctx, 160, t, 0.38, "sawtooth", 0.22);
      ton(ctx, 150, t, 0.38, "sawtooth", 0.16);
    }
  } catch {
    /* Audio nicht verfügbar — bewusst ignorieren */
  }
}
