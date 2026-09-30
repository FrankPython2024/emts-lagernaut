"use client";

// ── Kamera-Video auf der Druckerkarte (Stufe 2, 30.09.2026) ──────────────────
// Hülle um den VideoSpieler (src/lib/druck/videoSpieler.ts). Der Abruf selbst
// schaltet das Video an der Brücke ein; ist die Anzeige zu oder der Tab im
// Hintergrund, fragt niemand mehr und die Brücke hört auf.
// ⚠️ Beim Drucken liefert der P2S nur ~20–80 KB/s (gemessen) — dann ruckelt es,
// bleibt aber aktuell (die Brücke setzt bei > 3 s Rückstand neu an). Flüssig
// (30 Bilder/s) ist es, wenn der Drucker nichts zu tun hat.

import { useEffect, useRef, useState } from "react";
import { VideoSpieler, type SpielerStand } from "@/lib/druck/videoSpieler";

export function KameraVideo() {
  const leinwand = useRef<HTMLCanvasElement>(null);
  const [stand, setStand] = useState<SpielerStand>({ lage: "start" });

  useEffect(() => {
    const cv = leinwand.current;
    if (!cv) return;
    const spieler = new VideoSpieler(cv, setStand);
    spieler.start();
    return () => spieler.stop();
  }, []);

  if (stand.lage === "nichtUnterstuetzt") {
    return (
      <p className="text-sm text-[#8A5A00] dark:text-[#f7b928]">
        Dieser Browser kann das Kamerabild nicht anzeigen — bitte Chrome oder Edge verwenden.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      <div className="relative rounded-xl overflow-hidden bg-[#18191a] aspect-video">
        <canvas ref={leinwand} className="w-full h-full object-contain" aria-label="Kamera-Video des Druckers" />
        {stand.lage === "start" && (
          <div className="absolute inset-0 flex items-center justify-center text-sm font-bold text-white/80 text-center px-4">
            Video wird gestartet … das erste Bild kommt in etwa 5–10 Sekunden.
          </div>
        )}
        {stand.lage === "fehler" && (
          <div className="absolute inset-0 flex items-center justify-center text-sm font-bold text-white/90 text-center px-4">
            {stand.meldung ?? "Kein Video vom Drucker."} Läuft die Druckbrücke (Version 1.5 oder neuer)?
          </div>
        )}
      </div>
      <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]" aria-live="polite">
        {stand.lage === "laeuft" && <>● Live · {stand.bilderProSekunde ?? 0} Bilder/s{(stand.bilderProSekunde ?? 0) < 15 && " — beim Drucken liefert der Drucker weniger, das Bild bleibt aber aktuell"}</>}
        {stand.lage === "stockt" && <span className="font-bold text-[#8A5A00] dark:text-[#f7b928]">⚠ Video stockt — Drucker liefert gerade nichts, gleich geht es weiter.</span>}
      </div>
    </div>
  );
}
