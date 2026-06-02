"use client";

/**
 * Kurzer Ping-Ton über die Web-Audio-API — kein Audio-File nötig.
 *
 * Autoplay-Policy: Browser erlauben Audio erst nach einer User-Geste. Daher
 * wird `playPing()` beim ersten Klick auf den Notifications-Toggle aufgerufen,
 * was den AudioContext für den Rest der Session „freischaltet".
 *
 * Ton: Sinus, 880 Hz, ~300 ms, sanfter An-/Abschwung (kein Knacken).
 */
let audioCtx: AudioContext | null = null;

export function playPing(): void {
  if (typeof window === "undefined") return;
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    if (!audioCtx) audioCtx = new Ctor();
    // Falls der Context (noch) suspendiert ist — innerhalb der Geste reaktivieren
    if (audioCtx.state === "suspended") void audioCtx.resume();

    const osc  = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.001, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.15,  audioCtx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.3);
  } catch {
    /* Audio nicht verfügbar — bewusst ignorieren */
  }
}
