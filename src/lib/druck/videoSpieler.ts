// ── Video-Abspieler für das Druckerbild (Stufe 2, 30.09.2026) ────────────────
//
// Holt per Warte-Abruf die H.264-Bilder von /api/druck/kamera/video, setzt sie mit
// WebCodecs (VideoDecoder, Chrome/Edge) zusammen und zeigt sie im Takt ihrer
// Zeitstempel auf einer Leinwand — mit VORLAUF_MS Puffer, weil die Bilder in
// Paketen (~0,4 s) und mit WLAN-Schwankungen ankommen. Ohne diesen Puffer liefe
// das Bild ruckweise: 12 Bilder auf einmal, dann nichts.
//
// Bewusst ohne React, damit es sich auch außerhalb von Lagernaut prüfen lässt
// (am 30.09.2026 mit einer echten 20-s-Aufnahme des P2S im Browser getestet).
// Reine Rechenteile (entpacken, Bildwahl) sind exportiert und getestet
// (`npm run test:druck`).

/** Vorrat (30.09.2026: 900 → 500 ms, Frank: „noch ein wenig aktueller"). Kleiner = aktueller, aber öfter Ruckler. */
export const VORLAUF_MS = 500;
/** Liegt das neueste Bild so weit vor der Wiedergabe, springt sie nach vorn. */
export const SPRUNG_MS = 3000;
/** Anteil der Vorrats-Abweichung, der je gezeichnetem Takt ausgeglichen wird. */
export const NACHREGELN = 0.004;

export type EmpfangenesBild = { key: boolean; ts: number; daten: Uint8Array };

/** Gegenstück zu packeVideo (Server/Brücke): [u32 n] je Bild [u8 key][f64 ts][u32 len][Daten]. */
export function entpackeVideoPaket(puffer: ArrayBuffer): EmpfangenesBild[] | null {
  const dv = new DataView(puffer);
  if (puffer.byteLength < 4) return null;
  const n = dv.getUint32(0);
  const raus: EmpfangenesBild[] = [];
  let o = 4;
  for (let i = 0; i < n; i++) {
    if (o + 13 > puffer.byteLength) return null;
    const key = dv.getUint8(o) === 1;
    const ts = dv.getFloat64(o + 1);
    const len = dv.getUint32(o + 9);
    o += 13;
    if (o + len > puffer.byteLength) return null;
    raus.push({ key, ts, daten: new Uint8Array(puffer, o, len) });
    o += len;
  }
  return o === puffer.byteLength ? raus : null;
}

/** Index des Bildes, das zur Wiedergabezeit `soll` dran ist (letztes mit ts ≤ soll), sonst -1. Liste aufsteigend. */
export function waehleBild(ts: readonly number[], soll: number): number {
  let treffer = -1;
  for (let i = 0; i < ts.length; i++) {
    if (ts[i]! <= soll) treffer = i;
    else break;
  }
  return treffer;
}

export type SpielerLage = "start" | "laeuft" | "stockt" | "fehler" | "nichtUnterstuetzt";
/** verzugMs: Wanduhr − Zeitstempel des gezeigten Bildes. Nur aussagekräftig, wenn die Uhren von
 *  Brücke-PC und Betrachter-PC übereinstimmen (Windows-Zeitsync) — daher nur zur Diagnose. */
export type SpielerStand = { lage: SpielerLage; meldung?: string; bilderProSekunde?: number; verzugMs?: number };

type Warteschlange = { ts: number; bild: VideoFrame }[];

export class VideoSpieler {
  private aus = false;
  private ab = 0;
  private decoder: VideoDecoder | null = null;
  private codec: string | null = null;
  private brauchtKey = true;
  private schlange: Warteschlange = [];
  private versatz: number | null = null;       // performance.now() − Medienzeit
  private gezeigt: VideoFrame | null = null;
  private letztesBildAm = 0;
  private gezeigtZaehler = 0;
  private zaehlerSeit = 0;
  private abbruch: AbortController | null = null;
  private stand: SpielerStand = { lage: "start" };
  private verzug: number | undefined;
  private gezeigtTs: number | null = null;

  constructor(
    private leinwand: HTMLCanvasElement,
    private beiStand: (s: SpielerStand) => void,
    private url = "/api/druck/kamera/video",
  ) {}

  start(): void {
    if (typeof VideoDecoder === "undefined") { this.melde({ lage: "nichtUnterstuetzt" }); return; }
    this.zaehlerSeit = performance.now();
    void this.abrufen();
    requestAnimationFrame(this.zeichne);
    this.melde({ lage: "start" });
  }

  stop(): void {
    this.aus = true;
    this.abbruch?.abort();
    try { this.decoder?.close(); } catch { /* egal */ }
    for (const e of this.schlange) e.bild.close();
    this.schlange = [];
    this.gezeigt?.close();
    this.gezeigt = null;
  }

  private melde(s: SpielerStand): void {
    if (s.lage === this.stand.lage && s.meldung === this.stand.meldung && s.bilderProSekunde === this.stand.bilderProSekunde && s.verzugMs === this.stand.verzugMs) return;
    this.stand = s;
    this.beiStand(s);
  }

  private async abrufen(): Promise<void> {
    while (!this.aus) {
      // Tab im Hintergrund: nicht abrufen — sonst liefe die Kamera für niemanden.
      if (document.visibilityState !== "visible") { await warte(1000); continue; }
      try {
        this.abbruch = new AbortController();
        const r = await fetch(`${this.url}?ab=${this.ab}`, { cache: "no-store", signal: this.abbruch.signal });
        if (r.status === 200) {
          const bilder = entpackeVideoPaket(await r.arrayBuffer());
          const letzte = Number(r.headers.get("X-Letzte-Nr"));
          const codec = r.headers.get("X-Codec") ?? "avc1.640029";
          // Eine Lücke (Server fängt neu beim Schlüsselbild an) erkennt man daran,
          // dass das erste Bild ein Schlüsselbild ist und nicht direkt anschließt.
          if (bilder) {
            for (const b of bilder) await this.dekodiere(b, codec);
            if (Number.isFinite(letzte) && letzte > 0) this.ab = letzte;
          }
        } else if (r.status === 204) {
          const letzte = Number(r.headers.get("X-Letzte-Nr"));
          if (Number.isFinite(letzte) && letzte < this.ab) this.ab = 0;   // Server neu gestartet
        } else if (r.status === 401 || r.status === 403) {
          this.melde({ lage: "fehler", meldung: "Keine Berechtigung für das Kamerabild." });
          await warte(10_000);
        } else {
          await warte(2000);
        }
      } catch (e) {
        if (this.aus) return;
        this.melde({ lage: "fehler", meldung: e instanceof Error ? e.message : "Abruf fehlgeschlagen" });
        await warte(2000);
      }
    }
  }

  private async dekodiere(b: EmpfangenesBild, codec: string): Promise<void> {
    if (!this.decoder || this.decoder.state === "closed" || codec !== this.codec) {
      if (!b.key) return;
      const geht = await VideoDecoder.isConfigSupported({ codec });
      if (!geht.supported) { this.melde({ lage: "nichtUnterstuetzt" }); this.stop(); return; }
      try { this.decoder?.close(); } catch { /* egal */ }
      this.decoder = new VideoDecoder({
        output: (bild) => this.einreihen(bild),
        error: () => { this.brauchtKey = true; this.codec = null; },   // beim nächsten Schlüsselbild neu
      });
      this.decoder.configure({ codec, optimizeForLatency: true });
      this.codec = codec;
      this.brauchtKey = true;
    }
    if (this.brauchtKey && !b.key) return;
    this.brauchtKey = false;
    try {
      this.decoder.decode(new EncodedVideoChunk({ type: b.key ? "key" : "delta", timestamp: Math.round(b.ts * 1000), data: b.daten }));
    } catch {
      this.brauchtKey = true;
    }
  }

  private einreihen(bild: VideoFrame): void {
    if (this.aus) { bild.close(); return; }
    const ts = bild.timestamp / 1000;
    // Rücksprung = neue Sitzung an der Brücke (sie setzt ihre Zeit neu an der Uhr an).
    // Was von der alten noch wartet, ist veraltet → weg damit, neu einpendeln.
    const zuletzt = this.schlange.length > 0 ? this.schlange[this.schlange.length - 1]!.ts : this.gezeigtTs;
    if (zuletzt !== null && ts < zuletzt - 50) {
      for (const e of this.schlange) e.bild.close();
      this.schlange = [];
      this.versatz = null;
    }
    this.schlange.push({ ts, bild });
    this.schlange.sort((a, b) => a.ts - b.ts);
    this.letztesBildAm = performance.now();
    // Zu viel auf Halde (Tab war kurz weg, Paketstau) → nur die letzten 5 s behalten.
    while (this.schlange.length > 0 && ts - this.schlange[0]!.ts > 5000) this.schlange.shift()!.bild.close();
  }

  private zeichne = (): void => {
    if (this.aus) return;
    const jetzt = performance.now();
    const s = this.schlange;
    if (s.length > 0) {
      const neuestes = s[s.length - 1]!.ts;
      if (this.versatz === null) this.versatz = jetzt - s[0]!.ts + VORLAUF_MS;
      let soll = jetzt - this.versatz;
      // Weit hinterher (Sprung im Zeitstempel, Tab war weg) → nach vorn springen.
      if (neuestes - soll > SPRUNG_MS) { this.versatz = jetzt - neuestes + VORLAUF_MS; soll = jetzt - this.versatz; }
      // Vorrat nachregeln. Gemessen am 30.09.2026: Die Zeitstempel des Druckers laufen
      // minimal schneller als die Uhr am PC — ohne Nachregeln schmolz der Vorrat von
      // 0,9 s auf 0,2 s, danach kam jedes Paket „zu spät" und das Bild ruckte (1–11
      // statt 30 Bilder/s). So bleibt er im Mittel bei VORLAUF_MS, unmerklich.
      this.versatz += (VORLAUF_MS - (neuestes - soll)) * NACHREGELN;
      soll = jetzt - this.versatz;
      const i = waehleBild(s.map((e) => e.ts), soll);
      if (i >= 0) {
        const e = s[i]!;
        for (let k = 0; k < i; k++) s[k]!.bild.close();
        this.schlange = s.slice(i + 1);
        const cv = this.leinwand;
        if (cv.width !== e.bild.displayWidth) cv.width = e.bild.displayWidth;
        if (cv.height !== e.bild.displayHeight) cv.height = e.bild.displayHeight;
        cv.getContext("2d")?.drawImage(e.bild, 0, 0);
        this.verzug = Date.now() - e.ts;
        this.gezeigtTs = e.ts;
        this.gezeigt?.close();
        this.gezeigt = e.bild;
        this.gezeigtZaehler += 1;
      }
    }
    // Stand etwa jede Sekunde melden.
    if (jetzt - this.zaehlerSeit >= 1000) {
      const fps = Math.round((this.gezeigtZaehler * 1000) / (jetzt - this.zaehlerSeit));
      this.gezeigtZaehler = 0; this.zaehlerSeit = jetzt;
      const still = this.letztesBildAm === 0 ? Infinity : jetzt - this.letztesBildAm;
      if (this.stand.lage !== "nichtUnterstuetzt" && !(this.stand.lage === "fehler" && still > 3000)) {
        if (this.letztesBildAm === 0) this.melde({ lage: "start" });
        else if (still > 3000) { this.melde({ lage: "stockt" }); this.versatz = null; }
        else this.melde({ lage: "laeuft", bilderProSekunde: fps, verzugMs: this.verzug === undefined ? undefined : Math.round(this.verzug / 100) * 100 });
      }
    }
    requestAnimationFrame(this.zeichne);
  };
}

function warte(ms: number): Promise<void> {
  return new Promise((ok) => setTimeout(ok, ms));
}
