"use client";

// Geräteerkennung fürs Pickup-Scannen: Mobil (Smartphone/Tablet) vs. Handscanner
// (Keyboard-Wedge). Da Wedge-Scanner wie eine Tastatur aussehen, ist die
// Auto-Erkennung NIE sicher → erkannter Modus wird sichtbar angezeigt und kann
// manuell umgeschaltet werden (Fallback).
//
//   • Mobil-Heuristik: User-Agent (Android/iOS), navigator.maxTouchPoints > 0,
//     schmale Viewport-Breite.
//   • Wedge-Heuristik: sehr kurze Inter-Key-Abstände (Burst, < BURST_MS) mit
//     abschließendem Enter — statt menschlichem Tippen.

import { useCallback, useEffect, useRef, useState } from "react";

export type ScannerDevice = "mobil" | "handscanner";

const BURST_MS    = 40; // Inter-Key-Abstand, unter dem wir von Maschine ausgehen
const BURST_MIN   = 3;  // so viele schnelle Tasten vor Enter = Scan

function erkenneInitial(): ScannerDevice {
  if (typeof navigator === "undefined") return "handscanner";
  const ua       = navigator.userAgent || "";
  const mobilUA  = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  const touch    = (navigator.maxTouchPoints ?? 0) > 0;
  const schmal   = typeof window !== "undefined" && window.innerWidth < 768;
  return mobilUA || touch || schmal ? "mobil" : "handscanner";
}

export function useScannerMode() {
  // Auf dem Server/erstem Render deterministisch "handscanner" (kein Hydration-
  // Mismatch); echte Erkennung im Effect nachziehen.
  const [mode, setModeState] = useState<ScannerDevice>("handscanner");
  const [manuell, setManuell] = useState(false);

  const manuellRef = useRef(false);
  const lastKeyRef = useRef(0);
  const burstRef   = useRef(0);

  useEffect(() => {
    if (!manuellRef.current) setModeState(erkenneInitial());
  }, []);

  const setMode = useCallback((m: ScannerDevice) => {
    manuellRef.current = true;
    setManuell(true);
    setModeState(m);
  }, []);

  // An das Scan-Eingabefeld hängen: erkennt den Wedge-Burst und stellt (sofern
  // nicht manuell festgelegt) automatisch auf "handscanner".
  const onInputKeyDown = useCallback((e: React.KeyboardEvent) => {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const dt  = now - lastKeyRef.current;
    lastKeyRef.current = now;

    if (e.key === "Enter") {
      if (burstRef.current >= BURST_MIN && !manuellRef.current) setModeState("handscanner");
      burstRef.current = 0;
      return;
    }
    if (e.key.length === 1) {
      if (dt < BURST_MS) burstRef.current += 1;
      else               burstRef.current = 0;
    }
  }, []);

  return { mode, setMode, manuell, onInputKeyDown };
}
