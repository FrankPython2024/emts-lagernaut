// ── Kamera-Video des Druckers (Stufe 2, 30.09.2026) ──────────────────────────
//
// Die Druckbrücke schickt alle ~0,4 s ein Paket mit den Bildern seitdem (H.264,
// Annex-B, je Bild key/ts/Daten — Form siehe packeVideo/entpackeVideo, gleich in
// tools/druckbruecke/druckbruecke.mjs). Der Server hält nur die letzten Sekunden:
// ab dem vorletzten Schlüsselbild. Zuschauer holen per Warte-Abruf (bis 2,5 s
// offen) alles nach ihrer letzten Nummer; neue Zuschauer beginnen beim letzten
// Schlüsselbild — ohne das kann der Decoder im Browser nichts anfangen.
//
// Gemessen am P2S beim Drucken: 30 Bilder/s, jede Sekunde ein Schlüsselbild
// (~120–145 KB), zusammen ~200–240 KB/s. Die Brücke schickt das nur EINMAL, egal
// wie viele zuschauen, und nur solange jemand zuschaut (VIDEO_NACHFRAGE_MS).
//
// Wie beim Standbild im Prozessspeicher (globalThis): Upload und Abruf sind
// Pages-API-Routen im selben Node-Prozess, ein Neustart verliert nur Sekunden.

export const VIDEO_NACHFRAGE_MS = 30_000;
/** Größtes Paket der Brücke (≈ 7 s Rückstand wirft sie selbst weg). */
export const VIDEO_PAKET_MAX_BYTES = 4_000_000;
/** Deckel für den Puffer — reicht für zwei Schlüsselbild-Abstände auch im Leerlauf. */
export const VIDEO_PUFFER_MAX_BYTES = 12_000_000;
/** Deckel je Antwort an einen Zuschauer. */
export const VIDEO_ANTWORT_MAX_BYTES = 4_000_000;
/** Ist das letzte Bild älter, beginnt ein neues Paket einen frischen Puffer. */
export const VIDEO_VERALTET_MS = 10_000;

export type VideoBildRoh = { key: boolean; ts: number; daten: Buffer };
export type VideoBild = VideoBildRoh & { seq: number };
export type VideoPuffer = { bilder: VideoBild[]; seq: number; bytes: number; codec: string | null; am: number };

export function leererPuffer(): VideoPuffer {
  return { bilder: [], seq: 0, bytes: 0, codec: null, am: 0 };
}

/** [u32 Anzahl] und je Bild [u8 key][f64 ts][u32 Länge][Daten]. */
export function packeVideo(bilder: readonly VideoBildRoh[]): Buffer {
  const teile: Buffer[] = [Buffer.alloc(4)];
  teile[0]!.writeUInt32BE(bilder.length, 0);
  for (const b of bilder) {
    const kopf = Buffer.alloc(13);
    kopf.writeUInt8(b.key ? 1 : 0, 0);
    kopf.writeDoubleBE(b.ts, 1);
    kopf.writeUInt32BE(b.daten.length, 9);
    teile.push(kopf, b.daten);
  }
  return Buffer.concat(teile);
}

/** Gegenstück zu packeVideo. null bei jeder Unstimmigkeit — lieber verwerfen als raten. */
export function entpackeVideo(buf: Buffer): VideoBildRoh[] | null {
  if (buf.length < 4) return null;
  const anzahl = buf.readUInt32BE(0);
  if (anzahl > 5000) return null;
  const raus: VideoBildRoh[] = [];
  let o = 4;
  for (let i = 0; i < anzahl; i++) {
    if (o + 13 > buf.length) return null;
    const key = buf.readUInt8(o) === 1;
    const ts = buf.readDoubleBE(o + 1);
    const laenge = buf.readUInt32BE(o + 9);
    o += 13;
    if (!Number.isFinite(ts) || laenge === 0 || o + laenge > buf.length) return null;
    raus.push({ key, ts, daten: buf.subarray(o, o + laenge) });
    o += laenge;
  }
  return o === buf.length ? raus : null;
}

/**
 * Bilder anhängen und den Puffer kurz halten: ab dem VORLETZTEN Schlüsselbild
 * (ein Zuschauer mitten im Abruf verliert so nichts) und nie über den Byte-Deckel.
 */
export function fuegeHinzu(p: VideoPuffer, neue: readonly VideoBildRoh[], codec: string, jetzt: number): void {
  if (neue.length === 0) return;
  // Lange nichts gekommen (Kamera war aus) → frisch anfangen, sonst spränge der
  // Abspieler über eine Minuten-Lücke in den Zeitstempeln.
  if (p.bilder.length > 0 && jetzt - p.am > VIDEO_VERALTET_MS) { p.bilder = []; p.bytes = 0; }
  for (const b of neue) {
    p.seq += 1;
    p.bilder.push({ ...b, daten: Buffer.from(b.daten), seq: p.seq });
    p.bytes += b.daten.length;
  }
  p.codec = codec;
  p.am = jetzt;
  const keys = p.bilder.reduce<number[]>((a, b, i) => (b.key ? [...a, i] : a), []);
  let ab = keys.length >= 2 ? keys[keys.length - 2]! : keys.length === 1 ? keys[0]! : p.bilder.length;
  // Byte-Deckel: notfalls nur ab dem letzten Schlüsselbild behalten.
  const bytesAb = (i: number) => p.bilder.slice(i).reduce((s, b) => s + b.daten.length, 0);
  if (bytesAb(ab) > VIDEO_PUFFER_MAX_BYTES && keys.length >= 1) ab = keys[keys.length - 1]!;
  if (ab > 0) {
    p.bilder = p.bilder.slice(ab);
    p.bytes = p.bilder.reduce((s, b) => s + b.daten.length, 0);
  }
}

/**
 * Was bekommt ein Zuschauer, der bis `ab` alles hat? Die Bilder danach — außer er
 * ist neu (ab = 0) oder hat eine Lücke (seine nächste Nummer liegt nicht mehr im
 * Puffer): dann ab dem letzten Schlüsselbild, sonst kann er nichts decodieren.
 */
export function bilderFuer(p: VideoPuffer, ab: number): VideoBild[] {
  if (p.bilder.length === 0) return [];
  const erste = p.bilder[0]!.seq;
  const luecke = ab === 0 || ab + 1 < erste || ab > p.seq;
  let start: number;
  if (luecke) {
    start = -1;
    for (let i = p.bilder.length - 1; i >= 0; i--) if (p.bilder[i]!.key) { start = i; break; }
    if (start < 0) return [];
  } else {
    start = ab + 1 - erste;
  }
  const raus: VideoBild[] = [];
  let bytes = 0;
  for (let i = start; i < p.bilder.length; i++) {
    const b = p.bilder[i]!;
    if (raus.length > 0 && bytes + b.daten.length > VIDEO_ANTWORT_MAX_BYTES) break;
    raus.push(b);
    bytes += b.daten.length;
  }
  return raus;
}

// ── Prozessweiter Zustand ────────────────────────────────────────────────────

type Zustand = { puffer: VideoPuffer; gewuenschtBis: number; wartende: Set<() => void> };
const g = globalThis as unknown as { __druckKameraVideo?: Zustand };
function zustand(): Zustand {
  return (g.__druckKameraVideo ??= { puffer: leererPuffer(), gewuenschtBis: 0, wartende: new Set() });
}

export function videoAnfordern(jetzt = Date.now()): void {
  zustand().gewuenschtBis = jetzt + VIDEO_NACHFRAGE_MS;
}
export function videoGewuenscht(jetzt = Date.now()): boolean {
  return zustand().gewuenschtBis > jetzt;
}
export function videoPuffer(): VideoPuffer {
  return zustand().puffer;
}

/** Paket der Brücke übernehmen und alle wartenden Zuschauer wecken. */
export function videoAufnehmen(neue: readonly VideoBildRoh[], codec: string, jetzt = Date.now()): void {
  const z = zustand();
  fuegeHinzu(z.puffer, neue, codec, jetzt);
  const w = [...z.wartende];
  z.wartende.clear();
  for (const f of w) f();
}

/** Bis zu `ms` warten, bis es Bilder nach `ab` gibt. */
export function videoWarten(ab: number, ms: number): Promise<void> {
  const z = zustand();
  if (z.puffer.seq > ab) return Promise.resolve();
  return new Promise((ok) => {
    const fertig = () => { clearTimeout(t); z.wartende.delete(fertig); ok(); };
    const t = setTimeout(fertig, ms);
    z.wartende.add(fertig);
  });
}
