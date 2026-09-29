// ── Einfaches ZIP lesen/schreiben (nur Node-Bordmittel) ──────────────────────
// Reicht für Office-Dateien (.docx), die hier als Vorlage befüllt werden:
// gespeicherte (0) oder „deflate"-gepackte (8) Einträge, kein ZIP64, keine
// Verschlüsselung. Reihenfolge der Einträge bleibt erhalten.

import zlib from "zlib";

export type ZipEintrag = { name: string; daten: Buffer };

export function leseZip(buf: Buffer): ZipEintrag[] {
  const min = Math.max(0, buf.length - 65557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Keine ZIP-Datei");
  const anzahl = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  const raus: ZipEintrag[] = [];
  for (let n = 0; n < anzahl; n++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) throw new Error("ZIP-Verzeichnis beschädigt");
    const methode = buf.readUInt16LE(pos + 10);
    const groesse = buf.readUInt32LE(pos + 20);
    const nl = buf.readUInt16LE(pos + 28), xl = buf.readUInt16LE(pos + 30), cl = buf.readUInt16LE(pos + 32);
    const lokal = buf.readUInt32LE(pos + 42);
    const name = buf.subarray(pos + 46, pos + 46 + nl).toString("utf8");
    const start = lokal + 30 + buf.readUInt16LE(lokal + 26) + buf.readUInt16LE(lokal + 28);
    const roh = buf.subarray(start, start + groesse);
    const daten = methode === 0 ? Buffer.from(roh) : methode === 8 ? zlib.inflateRawSync(roh) : null;
    if (!daten) throw new Error(`ZIP-Packverfahren ${methode} nicht unterstützt`);
    raus.push({ name, daten });
    pos += 46 + nl + xl + cl;
  }
  return raus;
}

const CRC_TABELLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABELLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function schreibeZip(eintraege: ZipEintrag[]): Buffer {
  const teile: Buffer[] = [];
  const verzeichnis: Buffer[] = [];
  let versatz = 0;
  // Fester Zeitstempel (1.1.2026 00:00) — der Inhalt zählt, nicht die Packzeit.
  const zeit = 0, datum = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const e of eintraege) {
    const name = Buffer.from(e.name, "utf8");
    const gepackt = zlib.deflateRawSync(e.daten);
    const crc = crc32(e.daten);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(zeit, 10); lh.writeUInt16LE(datum, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(gepackt.length, 18); lh.writeUInt32LE(e.daten.length, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(8, 10); ch.writeUInt16LE(zeit, 12); ch.writeUInt16LE(datum, 14); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(gepackt.length, 20); ch.writeUInt32LE(e.daten.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(versatz, 42);
    teile.push(lh, name, gepackt);
    verzeichnis.push(ch, name);
    versatz += lh.length + name.length + gepackt.length;
  }
  const cd = Buffer.concat(verzeichnis);
  const ende = Buffer.alloc(22);
  ende.writeUInt32LE(0x06054b50, 0);
  ende.writeUInt16LE(eintraege.length, 8); ende.writeUInt16LE(eintraege.length, 10);
  ende.writeUInt32LE(cd.length, 12); ende.writeUInt32LE(versatz, 16);
  return Buffer.concat([...teile, cd, ende]);
}
