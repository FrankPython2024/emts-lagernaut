"use client";

// ── Kamerabild auf der Druckerkarte (Stufe 1 „Standbild", 30.09.2026) ────────
// Holt alle 2 s das neueste Schlüsselbild (H.264) von /api/druck/kamera und
// setzt es mit WebCodecs (VideoDecoder) auf einer Leinwand zusammen. Jedes Bild
// ist für sich vollständig (SPS/PPS davor) — kein Videostrom, kein Verlauf.
// Erst der Abruf hier schaltet die Kamera an der Brücke ein; ist die Anzeige zu
// (oder der Tab im Hintergrund), fragt niemand mehr und die Brücke hört auf.

import { useEffect, useRef, useState } from "react";

const TAKT_MS = 2000;
type Lage = "start" | "warte" | "bild" | "alt" | "fehler" | "nichtUnterstuetzt";

export function KameraBild() {
  const leinwand = useRef<HTMLCanvasElement>(null);
  const [lage, setLage] = useState<Lage>("start");
  const [alterS, setAlterS] = useState<number | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("VideoDecoder" in window)) { setLage("nichtUnterstuetzt"); return; }
    let aus = false;
    let nr = 0;
    let codec: string | null = null;
    let dec: VideoDecoder | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const seit = Date.now();

    const neuerDecoder = (c: string) => {
      try { dec?.close(); } catch { /* egal */ }
      dec = new VideoDecoder({
        output: (f) => {
          const cv = leinwand.current;
          if (cv) {
            if (cv.width !== f.displayWidth) cv.width = f.displayWidth;
            if (cv.height !== f.displayHeight) cv.height = f.displayHeight;
            cv.getContext("2d")?.drawImage(f, 0, 0);
          }
          f.close();
        },
        error: (e) => { setFehler(e.message); codec = null; },   // beim nächsten Bild neu aufsetzen
      });
      dec.configure({ codec: c, optimizeForLatency: true });
      codec = c;
    };

    const runde = async () => {
      if (aus) return;
      // Tab im Hintergrund: nicht abrufen — sonst liefe die Kamera für niemanden.
      if (document.visibilityState === "visible") {
        try {
          const r = await fetch(`/api/druck/kamera?nach=${nr}`, { cache: "no-store" });
          const alter = Number(r.headers.get("X-Alter-Ms"));
          if (Number.isFinite(alter) && r.headers.get("X-Alter-Ms") !== null) setAlterS(Math.round(alter / 1000));
          if (r.status === 200) {
            const c = r.headers.get("X-Codec") ?? "avc1.640029";
            const daten = new Uint8Array(await r.arrayBuffer());
            nr = Number(r.headers.get("X-Bild-Nr")) || nr + 1;
            if (!dec || dec.state === "closed" || codec !== c) {
              const geht = await VideoDecoder.isConfigSupported({ codec: c });
              if (!geht.supported) { setLage("nichtUnterstuetzt"); return; }
              neuerDecoder(c);
            }
            dec!.decode(new EncodedVideoChunk({ type: "key", timestamp: nr * 1_000_000, data: daten }));
            setFehler(null);
            setLage(alter > 30_000 ? "alt" : "bild");
          } else if (r.status === 204) {
            if (nr === 0) setLage(Date.now() - seit > 20_000 ? "fehler" : "warte");
            else if (Number.isFinite(alter) && alter > 30_000) setLage("alt");
          } else {
            setFehler(`Abruf fehlgeschlagen (${r.status})`);
            setLage("fehler");
          }
        } catch (e) {
          setFehler(e instanceof Error ? e.message : "Abruf fehlgeschlagen");
        }
      }
      timer = setTimeout(runde, TAKT_MS);
    };
    void runde();
    return () => {
      aus = true;
      if (timer) clearTimeout(timer);
      try { dec?.close(); } catch { /* egal */ }
    };
  }, []);

  if (lage === "nichtUnterstuetzt") {
    return (
      <p className="text-sm text-[#8A5A00] dark:text-[#f7b928]">
        Dieser Browser kann das Kamerabild nicht anzeigen — bitte Chrome oder Edge verwenden.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      <div className="relative rounded-xl overflow-hidden bg-[#18191a] aspect-video">
        <canvas ref={leinwand} role="img" className="w-full h-full object-contain" aria-label="Kamerabild des Druckers" />
        {(lage === "start" || lage === "warte") && (
          <div className="absolute inset-0 flex items-center justify-center text-sm font-bold text-white/80 text-center px-4">
            Kamera wird eingeschaltet … das erste Bild kommt in etwa 10 Sekunden.
          </div>
        )}
        {lage === "fehler" && (
          <div className="absolute inset-0 flex items-center justify-center text-sm font-bold text-white/90 text-center px-4">
            Kein Bild vom Drucker. Läuft die Druckbrücke am Laptop?
          </div>
        )}
      </div>
      <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
        {lage === "alt" ? (
          <span className="font-bold text-[#8A5A00] dark:text-[#f7b928]">⚠ Bild ist {alterS} s alt — die Brücke schickt gerade keine neuen.</span>
        ) : lage === "bild" ? (
          <>Standbild, erneuert sich alle paar Sekunden{alterS != null ? ` · aufgenommen vor ${alterS} s` : ""}</>
        ) : null}
        {fehler && lage !== "fehler" && <span className="ml-1 text-[#c01818] dark:text-[#ff6b6b]">({fehler})</span>}
      </div>
    </div>
  );
}
