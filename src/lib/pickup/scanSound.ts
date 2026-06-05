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
