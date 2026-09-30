// ── Lagernaut-Druckbrücke (3D-Druck Paket 3: Status + Drucken) ─────────────
//
// Läuft auf dem PC beim Drucker (Bambu Lab P2S) und verbindet ihn mit Lagernaut:
//
//     Lagernaut-Server ◄── meldet sich alle 5 s (nur ausgehend) ── Brücke ──► Drucker im LAN
//
// Der Zugangscode des Druckers steht nur in der Einstellungsdatei auf diesem PC.
// Lokal lauscht die Brücke nur auf 127.0.0.1 (/status, /roh zur Fehlersuche und
// als Sperre gegen einen zweiten Start).
//
// Drucker-Zertifikat (1.6.0, Audit 30.09.2026): Der P2S zeigt auf allen Ports
// (8883/990/322) dasselbe Zertifikat — CN = Seriennummer, Aussteller „BBL Device
// CA N7-V2", gültig bis 2036. Die Brücke merkt sich beim ersten Kontakt seinen
// Fingerabdruck und verweigert danach jede Verbindung mit einem anderen. Vorher
// ging der Zugangscode an jeden, der sich im Gast-WLAN als Drucker ausgab.
//
// Voraussetzung am Drucker: „Nur LAN" + „Entwicklermodus" (Einstellungen → WLAN).
// Protokoll: MQTT über TLS, Port 8883, Benutzer „bblp", Passwort = Zugangscode,
// Status unter device/<Seriennummer>/report.
//
// Bewusst OHNE Zusatzpakete (nur Node.js): eine Datei, überall startbar,
// später als .exe verpackbar. Das Nötigste an MQTT 3.1.1 steht deshalb unten
// selbst drin (Verbinden, Abonnieren, Senden, Ping).
//
// Drucken von JEDEM PC (Stufe 3, 24.09.2026): Die Brücke meldet sich alle 5 s bei
// Lagernaut (NUR ausgehend, wie ein Browser — der Laptop hängt im „öffentlichen"
// Gast-WLAN, eingehend blockt die Firewall) und holt dabei höchstens einen
// Druckauftrag ab. Anmeldung mit dem Brücken-Schlüssel aus Lagernaut
// („Druckbrücke koppeln"), eingetragen als „brueckenSchluessel" in der
// Einstellungsdatei. Ohne Schlüssel läuft nur die Statusanzeige am Laptop.
// Den früheren lokalen Druckweg (POST /drucken aus dem Browser) gibt es nicht
// mehr — es gibt EINEN Weg, und der kennt die Plattensperre.
//
// Drucken: Die Brücke holt die geslicte Datei (.gcode.3mf) bei Lagernaut
// und legt sie per FTPS (Port 990,
// implizites TLS, vsFTPd) in den internen Speicher /cache und startet sie per
// MQTT „project_file". Gemessen am P2S am 24.09.2026: Bambu Studio legt seine
// Druckdateien genau dort ab, und der Datenkanal verlangt DIESELBE TLS-Sitzung
// wie die Anmeldung (sonst ECONNRESET) — und die Verschlüsselung des
// Datenkanals beginnt erst NACH dem Befehl (LIST/STOR), nicht vorher.
//
// Kamera (1.4.0 Standbild, 1.5.0 Video): nur solange in Lagernaut jemand zuschaut
// — siehe „Kamera" unten.
//
// Starten:  node druckbruecke.mjs      (oder „Druckbruecke starten.cmd")
// Test:     npm run test:bruecke       (Paket-Kodierung + Statusauswertung)

import tls from "node:tls";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

export const VERSION = "1.6.0";
// Endcodes für laufen.cmd (Autostart mit Neustart nach Absturz): Bei diesen beiden
// hilft ein Neustart nichts — dann NICHT im Kreis neu starten.
export const ENDE_EINSTELLUNGEN = 2;
export const ENDE_LAEUFT_SCHON = 3;
/** Standard-Adresse von Lagernaut (Drucken von jedem PC über den Server). */
export const LAGERNAUT_STANDARD = "https://emts-lagernaut.duckdns.org";
/** Alle so viele ms meldet sich die Brücke bei Lagernaut. */
export const MELDE_TAKT_MS = 5000;
/** Größte Druckdatei, die die Brücke annimmt. */
export const MAX_DRUCKDATEI = 60 * 1024 * 1024;
/** So lange läuft die Kamera nach der letzten Nachfrage aus Lagernaut weiter. */
export const KAMERA_NACHLAUF_MS = 20_000;
/** Mindestabstand zwischen zwei Uploads (die Kamera liefert ohnehin nur alle ~3–4 s). */
export const KAMERA_UPLOAD_ABSTAND_MS = 1_500;
/** Video: so oft geht ein Paket an Lagernaut (bestimmt die Verzögerung mit; 1.5.1: 400 → 250 ms). */
export const VIDEO_TAKT_MS = 250;
/** Video: mehr Rückstand als das (≈ 7 s bei 200 KB/s) → verwerfen und springen. */
export const VIDEO_RUECKSTAND_BYTES = 1_500_000;
/** In diesen Zuständen darf ein neuer Druck starten. */
export const STARTBEREIT = ["IDLE", "FINISH", "FAILED"];
export const STANDARD_PORT = 17350;
// Für Tests über DRUCKBRUECKE_EINSTELLUNGEN auf eine andere Datei umlenkbar.
export const EINSTELLUNGEN = process.env.DRUCKBRUECKE_EINSTELLUNGEN || path.join(os.homedir(), ".lagernaut-druckbruecke.json");
/** Gemerkter Fingerabdruck des Drucker-Zertifikats (kein Geheimnis). Löschen = neu lernen. */
export const ZERTIFIKAT_DATEI = EINSTELLUNGEN.replace(/\.json$/i, "") + "-zertifikat.json";
/** Ein Druckauftrag (Anmelden + Übertragen) darf höchstens so lange dauern — Lagernaut gibt nach 5 min auf. */
export const DRUCK_FRIST_MS = 4 * 60_000;
/** Kommt so lange nichts vom Drucker (auch keine Ping-Antwort), gilt die Verbindung als tot. */
export const DRUCKER_STILL_MS = 75_000;
/** Größtes MQTT-Paket, das wir annehmen (ein Komplettbericht hat ~10 KB). */
export const MQTT_MAX_PAKET = 1024 * 1024;
const ERLAUBT_STANDARD = ["https://emts-lagernaut.duckdns.org", "http://localhost:3000"];

// ── MQTT 3.1.1: Pakete bauen und zerlegen (reine Funktionen, getestet) ────────

/** Restlänge als MQTT-Varint (1–4 Byte). */
export function kodiereLaenge(n) {
  const bytes = [];
  do {
    let b = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) b |= 0x80;
    bytes.push(b);
  } while (n > 0);
  return Buffer.from(bytes);
}

function mqttText(s) {
  const b = Buffer.from(s, "utf8");
  const l = Buffer.alloc(2);
  l.writeUInt16BE(b.length);
  return Buffer.concat([l, b]);
}

function paket(kopf, rumpf) {
  return Buffer.concat([Buffer.from([kopf]), kodiereLaenge(rumpf.length), rumpf]);
}

export function baueConnect({ clientId, benutzer, passwort, keepAlive = 60 }) {
  const ka = Buffer.alloc(2);
  ka.writeUInt16BE(keepAlive);
  const variabel = Buffer.concat([
    mqttText("MQTT"),
    Buffer.from([0x04]),        // Protokollstufe 4 = MQTT 3.1.1
    Buffer.from([0xc2]),        // Benutzer + Passwort + saubere Sitzung
    ka,
  ]);
  return paket(0x10, Buffer.concat([variabel, mqttText(clientId), mqttText(benutzer), mqttText(passwort)]));
}

export function baueSubscribe(paketId, thema) {
  const id = Buffer.alloc(2);
  id.writeUInt16BE(paketId);
  return paket(0x82, Buffer.concat([id, mqttText(thema), Buffer.from([0x00])]));
}

export function bauePublish(thema, nutzlast) {
  return paket(0x30, Buffer.concat([mqttText(thema), Buffer.from(nutzlast, "utf8")]));
}

export const PINGREQ = Buffer.from([0xc0, 0x00]);

/**
 * Zerlegt einen Empfangspuffer in vollständige Pakete. Unvollständiges bleibt
 * als `rest` stehen — TLS liefert Daten in beliebigen Stücken.
 */
export function zerlegePakete(puffer) {
  const pakete = [];
  let pos = 0;
  while (pos + 2 <= puffer.length) {
    let laenge = 0, faktor = 1, i = pos + 1, fertig = false;
    for (let n = 0; n < 4 && i < puffer.length; n++, i++) {
      const b = puffer[i];
      laenge += (b & 0x7f) * faktor;
      faktor *= 128;
      if ((b & 0x80) === 0) { fertig = true; i++; break; }
    }
    // 4 Längenbytes ohne Ende oder absurde Länge = kaputter Strom → Verbindung neu.
    if (!fertig && i - pos - 1 >= 4) return { pakete, rest: puffer.subarray(pos), kaputt: true };
    if (fertig && laenge > MQTT_MAX_PAKET) return { pakete, rest: puffer.subarray(pos), kaputt: true };
    if (!fertig || i + laenge > puffer.length) break;
    const typ = puffer[pos] >> 4;
    const flags = puffer[pos] & 0x0f;
    pakete.push({ typ, flags, rumpf: puffer.subarray(i, i + laenge) });
    pos = i + laenge;
  }
  return { pakete, rest: puffer.subarray(pos) };
}

/** PUBLISH-Rumpf → { thema, nutzlast }. */
export function lesePublish(flags, rumpf) {
  if (rumpf.length < 2) return { thema: "", nutzlast: "" };
  const tl = rumpf.readUInt16BE(0);
  const thema = rumpf.subarray(2, 2 + tl).toString("utf8");
  const qos = (flags >> 1) & 0x03;
  const start = 2 + tl + (qos > 0 ? 2 : 0);
  return { thema, nutzlast: rumpf.subarray(start).toString("utf8") };
}

export const CONNACK_TEXT = {
  1: "Protokollversion abgelehnt",
  2: "Client-Kennung abgelehnt",
  3: "Drucker nimmt gerade keine Verbindung an",
  4: "Zugangscode falsch",
  5: "Nicht berechtigt — Zugangscode falsch oder Entwicklermodus aus",
};

// ── Druckerzustand ────────────────────────────────────────────────────────────

/**
 * Tiefes Zusammenführen: Die P-Serie schickt nach dem ersten Komplettbericht
 * nur noch geänderte Felder. Listen (z. B. hms) werden ersetzt, nicht gemischt.
 */
export function fuehreZusammen(ziel, neu) {
  for (const [k, v] of Object.entries(neu ?? {})) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
    if (v && typeof v === "object" && !Array.isArray(v) && ziel[k] && typeof ziel[k] === "object" && !Array.isArray(ziel[k])) {
      fuehreZusammen(ziel[k], v);
    } else {
      ziel[k] = v;
    }
  }
  return ziel;
}

const ZUSTAND_TEXT = {
  IDLE: "bereit", PREPARE: "bereitet vor", SLICING: "bereitet vor", RUNNING: "druckt",
  PAUSE: "pausiert", FINISH: "fertig", FAILED: "abgebrochen",
};

const zahl = (v) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

function spuleAus(vs) {
  const t = Array.isArray(vs) ? vs[0] : null;
  if (!t || typeof t !== "object") return null;
  const typ = typeof t.tray_type === "string" && t.tray_type ? t.tray_type : null;
  const farbe = typeof t.tray_color === "string" && t.tray_color ? `#${t.tray_color.slice(0, 6)}` : null;
  return typ || farbe ? { typ, farbe } : null;
}

/** Rohbericht (print-Objekt) → das, was Lagernaut anzeigt. */
export function fasseStatus(p) {
  if (!p || typeof p !== "object") return null;
  const zustand = typeof p.gcode_state === "string" ? p.gcode_state.toUpperCase() : null;
  const datei = (typeof p.subtask_name === "string" && p.subtask_name) || (typeof p.gcode_file === "string" && p.gcode_file) || null;
  const hms = Array.isArray(p.hms) ? p.hms : [];
  return {
    zustand,
    zustandText:  zustand ? (ZUSTAND_TEXT[zustand] ?? zustand.toLowerCase()) : "unbekannt",
    datei,
    fortschritt:  zahl(p.mc_percent),
    restMinuten:  zahl(p.mc_remaining_time),
    schicht:      zahl(p.layer_num),
    schichten:    zahl(p.total_layer_num),
    duese:        zahl(p.nozzle_temper),
    dueseZiel:    zahl(p.nozzle_target_temper),
    bett:         zahl(p.bed_temper),
    bettZiel:     zahl(p.bed_target_temper),
    fehlercode:   zahl(p.print_error) || null,
    meldungen:    hms.length,
    // Externe Spule (P2S ohne AMS): print.vir_slot[0] — für den Material-Hinweis.
    spule:        spuleAus(p.vir_slot),
    // Druckerkarte (1.5.1): Arbeitsschritt (stg_cur) und geplante Schritte (stg),
    // Tempo-Stufe, Innenlicht, WLAN, Platte der Druckdatei. Klartext macht Lagernaut.
    stufe:        zahl(p.stg_cur),
    stufen:       Array.isArray(p.stg) ? p.stg.map(zahl).filter((n) => n !== null).slice(0, 40) : [],
    tempo:        zahl(p.spd_lvl),
    licht:        Array.isArray(p.lights_report) ? p.lights_report.some((l) => l?.node === "chamber_light" && l?.mode === "on") : null,
    wlan:         typeof p.wifi_signal === "string" ? zahl(p.wifi_signal.replace(/dBm/i, "")) : zahl(p.wifi_signal),
    platte:       zahl(p.plate_idx),
  };
}

// ── Druckdatei prüfen ─────────────────────────────────────────────────────────

/**
 * Platten in einer geslicten .gcode.3mf (ein ZIP): die Einträge
 * „Metadata/plate_N.gcode". Exportiert man in Bambu Studio Platte 2, heißt der
 * Eintrag plate_2 — „plate_1" fest anzunehmen würde dann ins Leere zeigen.
 * Liest nur das Inhaltsverzeichnis am Dateiende, entpackt nichts.
 */
export function findePlatten(buf) {
  const min = Math.max(0, buf.length - 65557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null; // kein ZIP
  const anzahl = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  const platten = [];
  for (let n = 0; n < anzahl && pos + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) break;
    const nl = buf.readUInt16LE(pos + 28), xl = buf.readUInt16LE(pos + 30), cl = buf.readUInt16LE(pos + 32);
    const name = buf.subarray(pos + 46, pos + 46 + nl).toString("utf8");
    const m = /^Metadata\/plate_(\d+)\.gcode$/.exec(name);
    if (m) platten.push({ eintrag: name, nummer: Number(m[1]) });
    pos += 46 + nl + xl + cl;
  }
  return platten.sort((a, b) => a.nummer - b.nummer);
}

/** Einen Eintrag aus dem ZIP lesen (gespeichert oder „deflate"). null = nicht da/unlesbar. */
export function leseZipEintrag(buf, gesucht) {
  const min = Math.max(0, buf.length - 65557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const anzahl = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < anzahl && pos + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) return null;
    const methode = buf.readUInt16LE(pos + 10);
    const groesse = buf.readUInt32LE(pos + 20);
    const nl = buf.readUInt16LE(pos + 28), xl = buf.readUInt16LE(pos + 30), cl = buf.readUInt16LE(pos + 32);
    const lokal = buf.readUInt32LE(pos + 42);
    const name = buf.subarray(pos + 46, pos + 46 + nl).toString("utf8");
    if (name === gesucht) {
      if (lokal + 30 > buf.length || buf.readUInt32LE(lokal) !== 0x04034b50) return null;
      const start = lokal + 30 + buf.readUInt16LE(lokal + 26) + buf.readUInt16LE(lokal + 28);
      const daten = buf.subarray(start, start + groesse);
      try {
        if (methode === 0) return Buffer.from(daten);
        // Deckel: gelesen werden nur kleine Metadaten — eine präparierte Datei darf den Speicher nicht füllen.
        if (methode === 8) return zlib.inflateRawSync(daten, { maxOutputLength: 16 * 1024 * 1024 });
      } catch { return null; }
      return null;
    }
    pos += 46 + nl + xl + cl;
  }
  return null;
}

/**
 * Welche Filamente (1-basiert) benutzt diese Platte? Aus Metadata/slice_info.config
 * („<filament id="2" …/>" im Block der Platte). null = nicht lesbar.
 * Gebraucht für die Spulen-Zuordnung im Startbefehl — siehe druckBefehl.
 */
export function filamenteDerPlatte(buf, plattenNummer) {
  const roh = leseZipEintrag(buf, "Metadata/slice_info.config");
  if (!roh) return null;
  const xml = roh.toString("utf8");
  for (const block of xml.split(/<plate>/).slice(1)) {
    const idx = /<metadata\s+key="index"\s+value="(\d+)"/.exec(block);
    if (idx && Number(idx[1]) !== plattenNummer) continue;
    const ids = [...block.matchAll(/<filament\s[^>]*\bid="(\d+)"/g)].map((m) => Number(m[1])).filter((n) => n > 0);
    if (ids.length) return [...new Set(ids)].sort((a, b) => a - b);
  }
  return null;
}

/** Dateiname auf dem Drucker: nur sichere Zeichen, je Vorlage fest (überschreibt den letzten). */
export function druckerDateiname(name, vorlageId) {
  const ascii = String(name ?? "")
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/Ä/g, "Ae").replace(/Ö/g, "Oe").replace(/Ü/g, "Ue").replace(/ß/g, "ss")
    .replace(/\.gcode\.3mf$/i, "")
    .replace(/[^A-Za-z0-9 ._-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "druck";
  const id = Number.isInteger(vorlageId) && vorlageId > 0 ? `_L${vorlageId}` : "";
  return `${ascii}${id}.gcode.3mf`;
}

/**
 * Spulen-Zuordnung für Drucker mit EINER Düse ohne AMS (P2S): alles von der
 * externen Spule. Die Firmware will je Filament des Projekts einen Eintrag —
 * die benutzten zeigen auf den virtuellen Platz (ams_id 255, slot 0), die
 * übrigen sind „ungültig" (255/255). Im flachen ams_mapping lehnt sie rohe
 * Platznummern ab und will -1.
 * ⚠️ 24.09.2026, erster Druck aus Lagernaut: mit use_ams false und LEERER
 * Zuordnung blieb der P2S bei 0 % mit 07FF-8012 „Zuordnungstabelle des AMS
 * konnte nicht abgerufen werden" stehen. Zwei-Düsen-Drucker (H2D) bräuchten
 * für die linke Spule ams_id 254 — hier nicht vorgesehen.
 */
export function spulenZuordnung(filamente) {
  const ids = Array.isArray(filamente) && filamente.length ? filamente : [1];
  const laenge = Math.max(...ids);
  const benutzt = new Set(ids);
  return {
    ams_mapping:  Array.from({ length: laenge }, () => -1),
    ams_mapping2: Array.from({ length: laenge }, (_, i) =>
      benutzt.has(i + 1) ? { ams_id: 255, slot_id: 0 } : { ams_id: 255, slot_id: 255 }),
  };
}

/** Der MQTT-Befehl, der eine Datei aus /cache startet (lokaler Druck: Ids immer 0). */
export function druckBefehl({ datei, platte, titel, sequenz, filamente }) {
  const zuordnung = spulenZuordnung(filamente);
  return {
    print: {
      sequence_id:    String(sequenz),
      command:        "project_file",
      param:          platte,
      project_id:     "0",
      profile_id:     "0",
      task_id:        "0",
      subtask_id:     "0",
      subtask_name:   titel,
      file:           datei,
      url:            `ftp:///cache/${datei}`,
      md5:            "",
      timelapse:      false,
      bed_type:       "auto",
      bed_levelling:  true,
      flow_cali:      false,
      vibration_cali: false,
      layer_inspect:  false,
      use_ams:        false, // kein AMS am P2S (ams_exist_bits 0) — Filament von der externen Spule
      ams_mapping:    zuordnung.ams_mapping,
      ams_mapping2:   zuordnung.ams_mapping2,
    },
  };
}

// ── Drucker-Zertifikat prüfen (1.6.0) ─────────────────────────────────────────

/**
 * Reine Regel: CN muss die Seriennummer sein; ist ein Fingerabdruck gemerkt, muss
 * er stimmen. Liefert { fehler } oder { merken: fp } (erster Kontakt) oder {}.
 */
export function pruefeZertifikat(cert, seriennummer, gemerkt) {
  const cn = cert?.subject?.CN;
  const fp = cert?.fingerprint256;
  if (!cn || !fp) return { fehler: "Drucker zeigt kein Zertifikat." };
  if (String(cn).toUpperCase() !== String(seriennummer).toUpperCase()) {
    return { fehler: `Gegenstelle ist nicht der Drucker ${seriennummer} (Zertifikat für „${cn}").` };
  }
  if (!gemerkt) return { merken: fp };
  if (gemerkt !== fp) {
    return { fehler: `Zertifikat des Druckers hat sich geändert — Verbindung verweigert. Wurde der Drucker getauscht oder zurückgesetzt: Datei ${ZERTIFIKAT_DATEI} löschen und die Brücke neu starten.` };
  }
  return {};
}

function leseGemerkt() {
  try { return JSON.parse(fs.readFileSync(ZERTIFIKAT_DATEI, "utf8")).fingerabdruck ?? null; } catch { return null; }
}

/** Prüft die Gegenstelle einer TLS-Verbindung zum Drucker. null = in Ordnung, sonst Fehlertext. */
export function druckerZertifikatFehler(socket, e) {
  const erg = pruefeZertifikat(socket.getPeerCertificate(), e.seriennummer, leseGemerkt());
  if (erg.fehler) return erg.fehler;
  if (erg.merken) {
    try {
      fs.writeFileSync(ZERTIFIKAT_DATEI, JSON.stringify({ seriennummer: e.seriennummer, fingerabdruck: erg.merken, gemerktAm: new Date().toISOString() }, null, 2), "utf8");
      console.log(new Date().toLocaleTimeString("de-DE"), `Drucker-Zertifikat gemerkt (${ZERTIFIKAT_DATEI})`);
    } catch (err) {
      return `Drucker-Zertifikat konnte nicht gespeichert werden: ${err.message}`;
    }
  }
  return null;
}

/** Wartet auf `p`, höchstens `ms` — danach Fehler mit `text` (vorher `beiAblauf` zum Aufräumen). */
export function mitFrist(p, ms, text, beiAblauf) {
  let t;
  return Promise.race([
    p,
    new Promise((_, fehler) => { t = setTimeout(() => { try { beiAblauf?.(); } catch { /* egal */ } fehler(new Error(text)); }, ms); }),
  ]).finally(() => clearTimeout(t));
}

// ── FTPS (implizites TLS, Port 990) ───────────────────────────────────────────

export class FtpsSitzung {
  constructor(e) {
    this.e = e;
    this.text = "";
    this.antworten = [];
    this.wartende = [];
  }

  oeffnen() {
    return new Promise((ok, fehler) => {
      const s = tls.connect({ host: this.e.druckerIp, port: 990, rejectUnauthorized: false, timeout: 15000 });
      this.s = s;
      s.on("session", (t) => { this.sitzung = t; });
      s.on("data", (d) => this.empfange(d));
      s.on("timeout", () => s.destroy(new Error("FTP: Drucker antwortet nicht")));
      s.on("error", (err) => { fehler(err); this.wartende.splice(0).forEach((w) => w.fehler(err)); });
      s.on("secureConnect", async () => {
        try {
          const zfehler = druckerZertifikatFehler(s, this.e);
          if (zfehler) { s.destroy(); throw new Error(zfehler); }
          s.setTimeout(0);
          await this.erwarte("220");
          await this.befehl("USER bblp", "331");
          await this.befehl(`PASS ${this.e.zugangscode}`, "230");
          await this.befehl("PBSZ 0", "200");
          await this.befehl("PROT P", "200");
          await this.befehl("TYPE I", "200");
          ok();
        } catch (err) { fehler(err); }
      });
    });
  }

  empfange(d) {
    this.text += d.toString("utf8");
    // Eine Antwort ist fertig, sobald eine Zeile „NNN " (mit Leerzeichen) kommt.
    let m;
    while ((m = /^(\d{3}) .*\r?\n/m.exec(this.text))) {
      const ende = m.index + m[0].length;
      const antwort = { code: m[1], text: this.text.slice(0, ende).trim() };
      this.text = this.text.slice(ende);
      const w = this.wartende.shift();
      if (w) w.ok(antwort); else this.antworten.push(antwort);
    }
  }

  naechste(ms = 20000) {
    const a = this.antworten.shift();
    if (a) return Promise.resolve(a);
    return new Promise((ok, fehler) => {
      const w = { ok: (x) => { clearTimeout(t); ok(x); }, fehler: (x) => { clearTimeout(t); fehler(x); } };
      const t = setTimeout(() => { this.wartende = this.wartende.filter((x) => x !== w); fehler(new Error("FTP: keine Antwort")); }, ms);
      this.wartende.push(w);
    });
  }

  async erwarte(code, ms) {
    const a = await this.naechste(ms);
    if (!a.code.startsWith(code)) throw new Error(`FTP: ${a.text.replace(/^\d{3} /, "")}`);
    return a;
  }

  async befehl(zeile, code, ms) {
    this.s.write(zeile + "\r\n");
    return code ? this.erwarte(code, ms) : this.naechste(ms);
  }

  /** Datenkanal: PASV öffnen, Befehl schicken, DANN verschlüsseln lassen. */
  async daten(zeile, senden) {
    const pasv = await this.befehl("PASV", "227");
    const m = /(\d+),(\d+),(\d+),(\d+),(\d+),(\d+)/.exec(pasv.text);
    if (!m) throw new Error("FTP: keine Datenverbindung angeboten");
    const port = Number(m[5]) * 256 + Number(m[6]);
    // timeout = Stille auf dem Datenkanal (Lesen UND Schreiben), nicht Gesamtdauer.
    const d = tls.connect({ host: this.e.druckerIp, port, rejectUnauthorized: false, session: this.sitzung ?? this.s.getSession(), timeout: 30_000 });
    const teile = [];
    d.on("data", (x) => teile.push(x));
    let datenFehler = null;
    d.on("error", (err) => { datenFehler = err; });
    d.on("timeout", () => d.destroy(new Error("Datenkanal: Drucker antwortet nicht")));
    const zu = new Promise((ok) => d.on("close", ok));
    // ⚠️ 1.6.0 (Audit 30.09.2026): Vorher wartete das nur auf „secureConnect". Brach
    // der Kanal VOR dem Handshake ab (ECONNRESET, WLAN), kam das nie — die Brücke hing
    // für immer, und jeder spätere Auftrag wurde still verworfen.
    const verschluesselt = new Promise((ok, fehler) => {
      d.once("secureConnect", ok);
      zu.then(() => fehler(datenFehler ?? new Error("Datenkanal vor dem Senden geschlossen")));
    });
    verschluesselt.catch(() => { /* nur relevant, wenn gesendet wird */ });
    try {
      const start = await this.befehl(zeile);
      if (!/^1\d\d$/.test(start.code)) throw new Error(`FTP: ${start.text.replace(/^\d{3} /, "")}`);
      if (senden) {
        await verschluesselt;
        d.end(senden);
      }
    } catch (err) {
      d.destroy();
      throw err;
    }
    await zu;
    if (datenFehler) throw new Error(`FTP-Datenkanal: ${datenFehler.message}`);
    await this.erwarte("226", 180_000);
    return Buffer.concat(teile);
  }

  hochladen(pfad, inhalt) { return this.daten(`STOR ${pfad}`, inhalt); }
  holen(pfad) { return this.daten(`RETR ${pfad}`); }
  loeschen(pfad) { return this.befehl(`DELE ${pfad}`, "250"); }
  async liste(pfad) { return (await this.daten(`LIST ${pfad}`)).toString("utf8"); }

  schliessen() {
    try { this.s?.write("QUIT\r\n"); } catch { /* egal */ }
    this.s?.end();
  }
}

// ── Einstellungen ─────────────────────────────────────────────────────────────

export function leseEinstellungen(datei = EINSTELLUNGEN) {
  if (!fs.existsSync(datei)) {
    fs.writeFileSync(datei, JSON.stringify({
      druckerIp: "192.168.x.x",
      seriennummer: "HIER_SERIENNUMMER",
      zugangscode: "HIER_ZUGANGSCODE",
      lagernautUrl: LAGERNAUT_STANDARD,
      brueckenSchluessel: "HIER_SCHLUESSEL_AUS_LAGERNAUT",
      port: STANDARD_PORT,
      erlaubteSeiten: ERLAUBT_STANDARD,
    }, null, 2), "utf8");
    return { fehlt: `Einstellungsdatei angelegt: ${datei} — bitte IP, Seriennummer und Zugangscode eintragen und neu starten.` };
  }
  let e;
  try {
    e = JSON.parse(fs.readFileSync(datei, "utf8").replace(/^\uFEFF/, ""));
  } catch (err) {
    return { fehlt: `Einstellungsdatei ist kein gültiges JSON (${datei}): ${err.message}` };
  }
  const fehlend = ["druckerIp", "seriennummer", "zugangscode"].filter((k) => !e[k] || String(e[k]).startsWith("HIER_") || String(e[k]).includes("x.x"));
  if (fehlend.length) return { fehlt: `In ${datei} fehlt noch: ${fehlend.join(", ")}` };
  // Der Brücken-Schlüssel geht im Kopf jeder Anfrage mit — nie unverschlüsselt ins Netz.
  const url = String(e.lagernautUrl || LAGERNAUT_STANDARD).trim();
  if (!/^https:\/\//i.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(url)) {
    return { fehlt: `lagernautUrl muss mit https:// beginnen (steht: ${url})` };
  }
  return {
    druckerIp:      String(e.druckerIp).trim(),
    seriennummer:   String(e.seriennummer).trim(),
    zugangscode:    String(e.zugangscode).trim(),
    lagernautUrl:   String(e.lagernautUrl || LAGERNAUT_STANDARD).trim().replace(/\/+$/, ""),
    // Leer oder Platzhalter = Drucken über Lagernaut aus.
    brueckenSchluessel: typeof e.brueckenSchluessel === "string" && e.brueckenSchluessel.trim() && !e.brueckenSchluessel.startsWith("HIER_")
      ? e.brueckenSchluessel.trim() : null,
    port:           Number(e.port) || STANDARD_PORT,
    erlaubteSeiten: Array.isArray(e.erlaubteSeiten) && e.erlaubteSeiten.length ? e.erlaubteSeiten : ERLAUBT_STANDARD,
  };
}

// ── Verbindung zum Drucker ────────────────────────────────────────────────────

class DruckerVerbindung {
  constructor(e) {
    this.e = e;
    this.zustand = { verbindung: "getrennt", fehler: null, seit: null, letzterBericht: null };
    this.roh = {};
    this.socket = null;
    this.wartezeit = 2000;
    this.ping = null;
    this.pushall = null;
    this.lauscher = new Set();
  }

  log(...a) { console.log(new Date().toLocaleTimeString("de-DE"), ...a); }

  starten() {
    this.zustand.verbindung = "verbinde";
    const s = tls.connect({ host: this.e.druckerIp, port: 8883, rejectUnauthorized: false, timeout: 15000 });
    this.socket = s;
    let puffer = Buffer.alloc(0);
    this.letzteDaten = Date.now();

    s.on("secureConnect", () => {
      const zfehler = druckerZertifikatFehler(s, this.e);
      if (zfehler) {
        this.zustand.fehler = zfehler;
        this.log("⚠", zfehler);
        this.wartezeit = Math.max(this.wartezeit, 60_000);
        s.destroy();
        return;
      }
      s.setTimeout(0);
      // Antwortet der Drucker nicht auf die Anmeldung, nicht ewig auf „verbinde" stehen.
      this.connackUhr = setTimeout(() => s.destroy(new Error("Drucker bestätigt die Anmeldung nicht")), 10_000);
      s.write(baueConnect({
        clientId: `lagernaut-${crypto.randomBytes(3).toString("hex")}`,
        benutzer: "bblp",
        passwort: this.e.zugangscode,
      }));
    });
    s.on("timeout", () => s.destroy(new Error("Drucker antwortet nicht (Zeitüberschreitung)")));
    s.on("data", (d) => {
      this.letzteDaten = Date.now();
      puffer = Buffer.concat([puffer, d]);
      const { pakete, rest, kaputt } = zerlegePakete(puffer);
      if (kaputt || rest.length > MQTT_MAX_PAKET) { s.destroy(new Error("Unlesbare Daten vom Drucker")); return; }
      puffer = Buffer.from(rest);
      for (const p of pakete) {
        // Ein kaputtes Paket darf nie die ganze Brücke beenden.
        try { this.verarbeite(p); } catch (err) { this.log("⚠ Meldung des Druckers nicht lesbar:", err.message); }
      }
    });
    s.on("error", (err) => { this.zustand.fehler = err.message; });
    s.on("close", () => {
      clearInterval(this.ping);
      clearInterval(this.pushall);
      clearTimeout(this.connackUhr);
      // Alten Stand nicht über die Trennung retten — sonst entscheidet Lagernaut
      // nach dem Wiederverbinden über einen Zustand von vorhin.
      this.roh = {};
      if (this.zustand.verbindung === "verbunden") this.log("Verbindung zum Drucker getrennt");
      this.zustand.verbindung = "getrennt";
      const w = this.wartezeit;
      this.wartezeit = Math.min(60_000, this.wartezeit * 2);
      setTimeout(() => this.starten(), w);
    });
  }

  verarbeite({ typ, flags, rumpf }) {
    if (typ === 2) { // CONNACK
      clearTimeout(this.connackUhr);
      const rc = rumpf[1];
      if (rc !== 0) {
        this.zustand.fehler = CONNACK_TEXT[rc] ?? `Verbindung abgelehnt (Code ${rc})`;
        this.log("⚠", this.zustand.fehler);
        this.wartezeit = Math.max(this.wartezeit, 30_000); // falscher Code: nicht im Sekundentakt klopfen
        this.socket.destroy();
        return;
      }
      this.zustand = { ...this.zustand, verbindung: "verbunden", fehler: null, seit: new Date().toISOString() };
      this.wartezeit = 2000;
      this.log("✓ Mit dem Drucker verbunden");
      this.socket.write(baueSubscribe(1, `device/${this.e.seriennummer}/report`));
      this.fordereKomplettAn();
      // Ping alle 30 s; kommt 75 s gar nichts (auch keine Ping-Antwort), ist der
      // Drucker weg (z. B. ausgeschaltet ohne sauberes Trennen) → neu verbinden.
      this.ping = setInterval(() => {
        if (Date.now() - this.letzteDaten > DRUCKER_STILL_MS) { this.socket?.destroy(new Error("Drucker antwortet nicht mehr")); return; }
        this.socket?.write(PINGREQ);
      }, 30_000);
      // Die P-Serie schickt danach nur Änderungen — selten einen Komplettbericht holen.
      this.pushall = setInterval(() => this.fordereKomplettAn(), 10 * 60_000);
    } else if (typ === 3) { // PUBLISH
      const { nutzlast } = lesePublish(flags, rumpf);
      let j;
      try { j = JSON.parse(nutzlast); } catch { return; /* kein JSON — ignorieren */ }
      fuehreZusammen(this.roh, j);
      this.zustand.letzterBericht = new Date().toISOString();
      for (const l of this.lauscher) l(j);
    }
    // SUBACK (9) und PINGRESP (13) brauchen keine Antwort.
  }

  fordereKomplettAn() {
    this.socket?.write(bauePublish(`device/${this.e.seriennummer}/request`,
      JSON.stringify({ pushing: { sequence_id: String(Date.now() % 100000), command: "pushall" } })));
  }

  sende(obj) {
    if (this.zustand.verbindung !== "verbunden" || !this.socket) throw new Error("Keine Verbindung zum Drucker");
    this.socket.write(bauePublish(`device/${this.e.seriennummer}/request`, JSON.stringify(obj)));
  }

  /**
   * Druck starten und auf die Antwort warten. Der Drucker quittiert mit
   * print.command = "project_file" (result/reason) und wechselt dann auf
   * PREPARE/RUNNING — beides gilt als angenommen.
   */
  starteDruck({ datei, platte, titel, filamente }) {
    const sequenz = Date.now() % 1_000_000;
    return new Promise((ok) => {
      const fertig = (erg) => { clearTimeout(t); this.lauscher.delete(l); ok(erg); };
      const l = (j) => {
        const p = j?.print;
        if (!p) return;
        if (p.command === "project_file") {
          const res = String(p.result ?? "").toLowerCase();
          if (res && res !== "success") fertig({ angenommen: false, grund: p.reason || p.result || "abgelehnt" });
          else fertig({ angenommen: true });
        } else if (p.gcode_state === "PREPARE" || p.gcode_state === "RUNNING" || p.gcode_state === "SLICING") {
          fertig({ angenommen: true });
        }
      };
      const t = setTimeout(() => fertig({ angenommen: null }), 20_000);
      this.lauscher.add(l);
      try { this.sende(druckBefehl({ datei, platte, titel, sequenz, filamente })); }
      catch (err) { fertig({ angenommen: false, grund: err.message }); }
    });
  }

  status() {
    return {
      bruecke:    { version: VERSION },
      verbindung: this.zustand.verbindung,
      fehler:     this.zustand.fehler,
      seit:       this.zustand.seit,
      letzterBericht: this.zustand.letzterBericht,
      drucker:    fasseStatus(this.roh.print),
    };
  }
}

// ── Kamera: Standbild aus dem Videostrom (Stufe 1, 30.09.2026) ─────────────────
//
// Der P2S sendet sein Kamerabild als H.264 über RTSPS (Port 322, 1080p, ~10
// Bilder/s, ~75 KB/s, Anmeldung per Digest mit bblp + Zugangscode). Port 6000
// (JPEG-Einzelbilder wie bei P1/A1) liefert beim P2S NICHTS — gemessen am
// 30.09.2026: 8 Byte Antwort, dann zu. Ein Browser kann RTSP nicht öffnen.
//
// Deshalb holt die Brücke Schnappschüsse: je Bild eine kurze Sitzung, nur das erste
// VOLLSTÄNDIGE Bild (Schlüsselbild, ~50–100 KB) — siehe KameraStrom. Lagernaut
// bekommt es roh, Chrome setzt es dort mit WebCodecs zusammen. Kein ffmpeg, keine
// Pakete. Die Kamera läuft NUR, solange Lagernaut meldet, dass jemand zuschaut
// (Gast-WLAN schonen; gemessen ~16 KB/s, ein Bild etwa alle 4–5 s).

const START_CODE = Buffer.from([0, 0, 0, 1]);
const md5 = (x) => crypto.createHash("md5").update(x).digest("hex");

/** Digest-Anmeldung (RFC 2617 ohne qop — so verlangt es LIVE555 im Drucker). */
export function digestAntwort({ benutzer, passwort, realm, nonce, methode, uri }) {
  return md5(`${md5(`${benutzer}:${realm}:${passwort}`)}:${nonce}:${md5(`${methode}:${uri}`)}`);
}

/** Aus der SDP: mitgelieferte SPS/PPS und die Spur-Adresse des Videos. */
export function leseSdp(text) {
  const video = text.slice(Math.max(0, text.search(/^m=video/m)));
  const sprop = /sprop-parameter-sets=([^;\s]+)/.exec(video)?.[1] ?? "";
  return {
    sprop:   sprop.split(",").filter(Boolean).map((b) => Buffer.from(b, "base64")),
    control: /^a=control:(\S+)/m.exec(video)?.[1] ?? null,
  };
}

/** „avc1.641029" aus der SPS (Profil, Einschränkungen, Stufe) — für den Decoder im Browser. */
export function codecAusSps(sps) {
  if (!sps || sps.length < 4) return null;
  return "avc1." + [sps[1], sps[2], sps[3]].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Setzt RTP-Pakete (H.264, RFC 6184: einzeln, STAP-A, FU-A) zu Bildern zusammen
 * und gibt NUR Schlüsselbilder heraus — als Annex-B mit SPS/PPS davor, damit
 * jedes Bild für sich decodierbar ist.
 */
export class H264Sammler {
  constructor(sprop = []) {
    this.sps = null; this.pps = null;
    for (const n of sprop) this.merke(n);
    this.au = []; this.ts = null; this.fu = null;
  }
  merke(n) {
    const t = n[0] & 0x1f;
    if (t === 7) this.sps = Buffer.from(n);
    if (t === 8) this.pps = Buffer.from(n);
  }
  nal(n) { if (n.length) { this.merke(n); this.au.push(Buffer.from(n)); } }
  /** Ein RTP-Paket. Liefert ein Schlüsselbild (Annex-B) oder null. */
  /** Ein RTP-Paket. Liefert ein Schlüsselbild (Annex-B) oder null — für Standbilder. */
  rtp(p) {
    const b = this.bild(p);
    return b && b.key ? b.daten : null;
  }
  /**
   * Ein RTP-Paket. Liefert JEDES fertige Bild als { daten, key, rtpTs } — für das
   * Video. Schlüsselbilder tragen SPS/PPS davor und sind für sich decodierbar;
   * die übrigen nur zusammen mit ihren Vorgängern ab dem letzten Schlüsselbild.
   */
  bild(p) {
    if (p.length < 13 || (p[0] >> 6) !== 2) return null;
    let o = 12 + (p[0] & 0x0f) * 4;
    if (p[0] & 0x10) { if (p.length < o + 4) return null; o += 4 + p.readUInt16BE(o + 2) * 4; }
    let ende = p.length;
    if (p[0] & 0x20) ende -= p[ende - 1];
    if (o >= ende) return null;
    const ts = p.readUInt32BE(4);
    // Neues Bild ohne Ende-Markierung des alten → Reste verwerfen, nie mischen.
    if (this.ts !== null && ts !== this.ts) { this.au = []; this.fu = null; }
    this.ts = ts;
    const n = p.subarray(o, ende);
    const typ = n[0] & 0x1f;
    if (typ >= 1 && typ <= 23) this.nal(n);
    else if (typ === 24) {
      for (let i = 1; i + 2 <= n.length;) { const l = n.readUInt16BE(i); i += 2; this.nal(n.subarray(i, i + l)); i += l; }
    } else if (typ === 28 && n.length > 2) {
      const fu = n[1];
      if (fu & 0x80) this.fu = [Buffer.from([(n[0] & 0xe0) | (fu & 0x1f)]), Buffer.from(n.subarray(2))];
      else if (this.fu) this.fu.push(Buffer.from(n.subarray(2)));
      if ((fu & 0x40) && this.fu) { this.nal(Buffer.concat(this.fu)); this.fu = null; }
    }
    if (!(p[1] & 0x80)) return null;
    const au = this.au; this.au = []; this.ts = null; this.fu = null;
    const inhalt = au.filter((x) => ![7, 8, 9].includes(x[0] & 0x1f));
    if (inhalt.length === 0) return null;
    const key = inhalt.some((x) => (x[0] & 0x1f) === 5);
    if (key && (!this.sps || !this.pps)) return null;      // ohne SPS/PPS nicht decodierbar
    const teile = key ? [this.sps, this.pps, ...inhalt] : inhalt;
    return { daten: Buffer.concat(teile.flatMap((x) => [START_CODE, x])), key, rtpTs: ts };
  }
}

/**
 * Eine RTSPS-Sitzung zum Drucker. Ruft beiBild({ daten, key, rtpTs }) für JEDES
 * fertige Bild und beiEnde(grund) genau einmal, wenn die Sitzung vorbei ist
 * (grund = null bei planmäßigem Ende oder „still", sonst Fehlertext).
 *
 * Gemessen am P2S (30.09.2026) — der Strom verhält sich je nach Zustand anders:
 *  - morgens (Leerlauf): wenige Bilder/s, Schlüsselbild alle 1–15 s, und nach
 *    ~30 s kommt NICHTS mehr (Verbindung bleibt offen). GET_PARAMETER hilft nicht,
 *    selbst gebaute RTCP-Berichte ließen ihn nach 14 s abbrechen.
 *  - mittags (Druck/fertig): 30 Bilder/s, jede Sekunde ein Schlüsselbild, ~200 KB/s,
 *    läuft ohne Abbruch. Vier Sitzungen gleichzeitig nimmt er an.
 * Verlässlich in beiden Fällen: Jede neue Sitzung beginnt nach ~1–3 s mit einem
 * vollständigen Bild. Darauf bauen Schnappschuss (KameraStrom) und Video (VideoStrom).
 */
export const KAMERA_AUFBAU_MS = 15_000;
export const KAMERA_STILL_MS = 4_000;

export class RtspSitzung {
  constructor(e, beiBild, beiEnde, stillMs = KAMERA_STILL_MS) {
    this.e = e; this.beiBild = beiBild; this.beiEnde = beiEnde; this.stillMs = stillMs;
    this.socket = null; this.ende = false;
    this.beginn = Date.now(); this.spieltSeit = 0; this.letzteDaten = 0;
    this.sammler = null;
  }
  /** Sitzung beenden, ohne beiEnde auszulösen (der Aufrufer weiß es ja). */
  stoppen() { this.schliessen(undefined); }
  schliessen(grund) {
    if (this.ende) return;
    this.ende = true;
    clearInterval(this.uhr);
    const s = this.socket;
    if (s && this.session && !s.destroyed) {
      try { s.write(`TEARDOWN rtsps://${this.e.druckerIp}:322/streaming/live/1 RTSP/1.0\r\nCSeq: 99\r\nSession: ${this.session}\r\n\r\n`); } catch { /* egal */ }
    }
    if (s) setTimeout(() => s.destroy(), 300);
    if (grund !== undefined) this.beiEnde(grund);
  }
  starten() {
    const url = `rtsps://${this.e.druckerIp}:322/streaming/live/1`;
    let realm = null, nonce = null, cseq = 1, stufe = "frage", basis = url + "/";
    let puffer = Buffer.alloc(0);
    const s = tls.connect({ host: this.e.druckerIp, port: 322, rejectUnauthorized: false, timeout: KAMERA_AUFBAU_MS });
    this.socket = s;
    const sende = (methode, uri, extra = "") => {
      const auth = realm
        ? `Authorization: Digest username="bblp", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${digestAntwort({ benutzer: "bblp", passwort: this.e.zugangscode, realm, nonce, methode, uri })}"\r\n`
        : "";
      s.write(`${methode} ${uri} RTSP/1.0\r\nCSeq: ${cseq++}\r\nUser-Agent: Lagernaut-Druckbruecke/${VERSION}\r\n${auth}${this.session ? `Session: ${this.session}\r\n` : ""}${extra}\r\n`);
    };
    this.uhr = setInterval(() => {
      const jetzt = Date.now();
      if (!this.spieltSeit) { if (jetzt - this.beginn > KAMERA_AUFBAU_MS) this.schliessen("Drucker startet die Kamera nicht"); }
      else if (jetzt - this.letzteDaten > this.stillMs) this.schliessen(null);   // Strom versiegt (Leerlauf)
    }, 500);
    s.on("secureConnect", () => {
      const zfehler = druckerZertifikatFehler(s, this.e);
      if (zfehler) return this.schliessen(zfehler);
      s.setTimeout(0);
      sende("DESCRIBE", url, "Accept: application/sdp\r\n");
    });
    s.on("timeout", () => this.schliessen("Drucker antwortet nicht (Port 322)"));
    s.on("error", (err) => this.schliessen(err.message));
    s.on("close", () => this.schliessen("Verbindung vom Drucker beendet"));
    s.on("data", (d) => {
      if (this.ende) return;
      this.letzteDaten = Date.now();
      puffer = puffer.length ? Buffer.concat([puffer, d]) : d;
      while (puffer.length && !this.ende) {
        if (puffer[0] === 0x24) {                 // „$" = eingebettetes RTP-Paket
          if (puffer.length < 4) return;
          const n = puffer.readUInt16BE(2);
          if (puffer.length < 4 + n) return;
          const kanal = puffer[1], paket = puffer.subarray(4, 4 + n);
          puffer = puffer.subarray(4 + n);
          if (kanal !== 0 || !this.sammler) continue;
          const bild = this.sammler.bild(paket);
          if (bild) this.beiBild(bild);
          continue;
        }
        const kopfEnde = puffer.indexOf("\r\n\r\n");
        if (kopfEnde < 0) { if (puffer.length > 65536) this.schliessen("unlesbare Antwort"); return; }
        const kopf = puffer.subarray(0, kopfEnde).toString("latin1");
        const laenge = Number(/Content-Length:\s*(\d+)/i.exec(kopf)?.[1] ?? 0);
        if (puffer.length < kopfEnde + 4 + laenge) return;
        const rumpf = puffer.subarray(kopfEnde + 4, kopfEnde + 4 + laenge).toString("latin1");
        puffer = puffer.subarray(kopfEnde + 4 + laenge);
        const code = Number(/^RTSP\/1\.0 (\d+)/.exec(kopf)?.[1] ?? 0);
        if (process.env.KAMERA_DEBUG) log("Kamera", stufe, kopf.split("\r\n")[0]);
        if (code === 401) {
          if (realm) return this.schliessen("Zugangscode abgelehnt");
          realm = /realm="([^"]+)"/.exec(kopf)?.[1] ?? null;
          nonce = /nonce="([^"]+)"/.exec(kopf)?.[1] ?? null;
          if (!realm || !nonce) return this.schliessen("keine Anmeldedaten vom Drucker");
          sende("DESCRIBE", url, "Accept: application/sdp\r\n");
          continue;
        }
        if (code !== 200) return this.schliessen(`Drucker antwortet ${code || "unverständlich"} (${stufe})`);
        if (stufe === "frage") {
          const sdp = leseSdp(rumpf);
          this.sammler = new H264Sammler(sdp.sprop);
          basis = /Content-Base:\s*(\S+)/i.exec(kopf)?.[1] ?? basis;
          const spur = !sdp.control || sdp.control === "*" ? url
            : /^rtsps?:\/\//.test(sdp.control) ? sdp.control
            : basis.replace(/\/?$/, "/") + sdp.control;
          stufe = "einrichten";
          sende("SETUP", spur, "Transport: RTP/AVP/TCP;unicast;interleaved=0-1\r\n");
        } else if (stufe === "einrichten") {
          this.session = /Session:\s*([^;\r\n]+)/i.exec(kopf)?.[1]?.trim() ?? null;
          stufe = "spielen";
          sende("PLAY", url, "Range: npt=0.000-\r\n");
        } else if (stufe === "spielen") {
          stufe = "laeuft";
          this.spieltSeit = this.letzteDaten = Date.now();
        }
      }
    });
  }
}

/**
 * Standbilder: je Bild EINE kurze Sitzung — erstes Schlüsselbild nehmen, abmelden,
 * nach KAMERA_BILD_ABSTAND_MS das nächste. Ruft beiBild(annexB, codec).
 * Kommt KAMERA_SITZUNG_MS lang kein Bild, wird still neu angesetzt; nach
 * mehreren leeren Sitzungen oder echten Fehlern KAMERA_FEHLER_PAUSE_MS Pause.
 */
export const KAMERA_BILD_ABSTAND_MS = 1_500;
export const KAMERA_SITZUNG_MS = 8_000;
const KAMERA_FEHLER_PAUSE_MS = 15_000;
const KAMERA_LEERE_SITZUNGEN = 3;

export class KameraStrom {
  constructor(e, beiBild) {
    this.e = e; this.beiBild = beiBild;
    this.aktiv = false; this.sitzung = null; this.neuVersuch = null; this.waechter = null;
    this.gemeldet = false; this.leer = 0;
  }
  get laeuft() { return this.aktiv; }
  starten() {
    if (this.aktiv) return;
    this.aktiv = true;
    this.verbinde();
  }
  stoppen() {
    this.aktiv = false; this.gemeldet = false; this.leer = 0;
    clearTimeout(this.neuVersuch); clearTimeout(this.waechter);
    this.sitzung?.stoppen(); this.sitzung = null;
  }
  weiter(pauseMs) {
    clearTimeout(this.neuVersuch); clearTimeout(this.waechter);
    if (!this.aktiv) return;
    this.neuVersuch = setTimeout(() => { this.neuVersuch = null; this.verbinde(); }, pauseMs);
  }
  verbinde() {
    if (!this.aktiv || this.sitzung) return;
    const sitzung = new RtspSitzung(this.e, (b) => {
      if (!b.key || this.sitzung !== sitzung || !this.aktiv) return;
      this.leer = 0;
      if (!this.gemeldet) { this.gemeldet = true; log(`✓ Kamera läuft (Standbild, ${Math.round(b.daten.length / 1024)} KB je Bild)`); }
      this.beiBild(b.daten, codecAusSps(sitzung.sammler?.sps) ?? "avc1.640029");
      this.sitzung = null; sitzung.stoppen();               // Schnappschuss genommen → abmelden
      this.weiter(KAMERA_BILD_ABSTAND_MS);
    }, (grund) => {
      if (this.sitzung !== sitzung) return;
      this.sitzung = null;
      if (grund) { log(`⚠ Kamera: ${grund}`); this.weiter(KAMERA_FEHLER_PAUSE_MS); }
      else this.weiter(0);
    });
    this.sitzung = sitzung;
    // Läuft die Sitzung, liefert aber kein Schlüsselbild: still neu, nach mehreren melden.
    this.waechter = setTimeout(() => {
      if (this.sitzung !== sitzung) return;
      this.sitzung = null; sitzung.stoppen();
      this.leer += 1;
      if (this.leer >= KAMERA_LEERE_SITZUNGEN) { this.leer = 0; log("⚠ Kamera: der Drucker schickt kein Bild"); this.weiter(KAMERA_FEHLER_PAUSE_MS); }
      else this.weiter(0);
    }, KAMERA_SITZUNG_MS + 3_000);
    sitzung.starten();
  }
}

/**
 * RTP-Zeitstempel (90 kHz, 32 Bit, läuft über) → Millisekunden seit einem Anker.
 * Liefert die neue Zeit und merkt sich den letzten Rohwert für den Überlauf.
 */
export function rtpZuMs(anker, rtpTs) {
  if (anker.letzterRtp === null) { anker.letzterRtp = rtpTs; anker.umlaeufe = 0; anker.erster = rtpTs; }
  if (rtpTs < anker.letzterRtp && anker.letzterRtp - rtpTs > 0x80000000) anker.umlaeufe += 1;
  anker.letzterRtp = rtpTs;
  const voll = anker.umlaeufe * 0x100000000 + rtpTs - anker.erster;
  return anker.startMs + voll / 90;
}

/**
 * Video: läuft durchgehend und gibt JEDES Bild weiter — beiBild({ daten, key, ts }),
 * ts = Anzeigezeit in ms (aus dem RTP-Takt, je Sitzung an die Wanduhr gehängt).
 * Jede Sitzung wird erst ab ihrem ersten Schlüsselbild weitergereicht.
 *
 * ⚠️ KEINE geplante Übergabe an eine zweite Sitzung. Erste Fassung öffnete nach
 * 25 s eine neue und meldete die alte ab, sobald die neue ihr erstes Schlüsselbild
 * hatte — gemessen am 30.09.2026 versiegte die NEUE daraufhin nach ~1,5 s (6 s
 * Loch). Der Drucker teilt die Quelle offenbar zwischen den Sitzungen, und das
 * Abmelden der einen stört die andere. Stattdessen: eine Sitzung, und versiegt sie
 * (Leerlauf, ~30 s), nach VIDEO_STILL_MS sofort neu verbinden — die neue beginnt
 * mit einem vollständigen Bild. Beim Drucken läuft eine Sitzung ohne Ende.
 */
export const VIDEO_STILL_MS = 2_500;
/**
 * Hängt das Video mehr als das hinter der Wirklichkeit her, wird neu verbunden.
 * Gemessen am 30.09.2026 BEIM DRUCKEN: Der P2S schafft dann nur ~20–80 KB/s statt
 * ~240 KB/s — die Bilder kommen langsamer an, als sie entstehen (Zeitlupe, der
 * Rückstand wächst, nach ~30 s gibt er auf). Eine neue Sitzung beginnt immer mit
 * dem AKTUELLEN Bild: lieber ruckelig und aktuell als flüssig und veraltet.
 */
export const VIDEO_MAX_VERZUG_MS = 2_000;   // 1.5.1: 3 → 2 s (Frank: „noch ein wenig aktueller")

export class VideoStrom {
  constructor(e, beiBild) {
    this.e = e; this.beiBild = beiBild;
    this.aktiv = false; this.aktuell = null;
    this.fehlerSerie = 0; this.neuVersuch = null; this.letzteTs = 0; this.gemeldet = false;
  }
  get laeuft() { return this.aktiv; }
  get codec() { return codecAusSps(this.aktuell?.sitzung.sammler?.sps) ?? "avc1.640029"; }
  starten() {
    if (this.aktiv) return;
    this.aktiv = true; this.fehlerSerie = 0;
    this.aktuell = this.neueSitzung();
  }
  stoppen() {
    this.aktiv = false; this.gemeldet = false;
    clearTimeout(this.neuVersuch);
    this.aktuell?.sitzung.stoppen();
    this.aktuell = null;
  }
  neueSitzung() {
    const eintrag = { sitzung: null, anker: null };
    eintrag.sitzung = new RtspSitzung(this.e, (b) => this.bild(eintrag, b), (grund) => this.ende(eintrag, grund), VIDEO_STILL_MS);
    eintrag.sitzung.starten();
    return eintrag;
  }
  bild(eintrag, b) {
    if (!this.aktiv || eintrag !== this.aktuell) return;
    if (!eintrag.anker) {
      if (!b.key) return;                                   // erst ab dem ersten Schlüsselbild
      // Jede Sitzung setzt ihre Zeit NEU an der Wanduhr an. Erste Fassung nahm
      // max(jetzt, letzte Zeit + 1) — weil die Druckerzeit minimal schneller läuft,
      // schob sich der Vorsprung von Sitzung zu Sitzung weiter (gemessen: >1 s in
      // Minuten), und die Verzugsprüfung unten wurde blind. Ein Rücksprung an der
      // Sitzungsgrenze ist gewollt: Der Abspieler verwirft dann die alten Bilder.
      eintrag.anker = { startMs: Date.now(), letzterRtp: null, umlaeufe: 0, erster: 0 };
      this.fehlerSerie = 0;
      if (!this.gemeldet) { this.gemeldet = true; log(`✓ Kamera läuft (Video, ${Math.round(b.daten.length / 1024)} KB je Schlüsselbild)`); }
    }
    const ts = rtpZuMs(eintrag.anker, b.rtpTs);
    this.letzteTs = ts;
    this.beiBild({ daten: b.daten, key: b.key, ts });
    // Zu weit hinter der Wirklichkeit (Drucker liefert langsamer als Echtzeit) → frisch ansetzen.
    if (Date.now() - ts > VIDEO_MAX_VERZUG_MS) {
      this.verzugNeu = (this.verzugNeu ?? 0) + 1;
      eintrag.sitzung.stoppen();
      this.ende(eintrag, null);
    }
  }
  ende(eintrag, grund) {
    if (!this.aktiv || eintrag !== this.aktuell) return;
    this.aktuell = null;
    if (grund) { this.fehlerSerie += 1; log(`⚠ Kamera: ${grund}`); }
    const pause = this.fehlerSerie >= 3 ? KAMERA_FEHLER_PAUSE_MS : 0;
    if (this.fehlerSerie >= 3) this.fehlerSerie = 0;
    clearTimeout(this.neuVersuch);
    this.neuVersuch = setTimeout(() => { if (this.aktiv && !this.aktuell) this.aktuell = this.neueSitzung(); }, pause);
  }
}

/**
 * Video-Paket für Lagernaut: [u32 Anzahl] und je Bild [u8 key][f64 ts][u32 Länge][Daten].
 * Dieselbe Form liest der Server (src/modules/druck/kamera.ts, entpackeVideo).
 */
export function packeVideo(bilder) {
  const teile = [Buffer.alloc(4)];
  teile[0].writeUInt32BE(bilder.length, 0);
  for (const b of bilder) {
    const kopf = Buffer.alloc(13);
    kopf.writeUInt8(b.key ? 1 : 0, 0);
    kopf.writeDoubleBE(b.ts, 1);
    kopf.writeUInt32BE(b.daten.length, 9);
    teile.push(kopf, b.daten);
  }
  return Buffer.concat(teile);
}

// ── Kleiner Webserver nur für diesen PC ───────────────────────────────────────

/** Darf diese Seite die Brücke fragen? Nur eingetragene Lagernaut-Adressen. */
export function herkunftErlaubt(origin, erlaubte) {
  return typeof origin === "string" && erlaubte.includes(origin.replace(/\/$/, ""));
}

// ── Druck ausführen: Datei → /cache → project_file ────────────────────────────
const log = (...a) => console.log(new Date().toLocaleTimeString("de-DE"), ...a);
let druckLaeuft = false;

/** Der eine Druckweg. Liefert { ok, bestaetigt?, fehler? } — wirft nie. */
export async function druckeInhalt(inhalt, { titel, vorlageId }, e, verbindung) {
  const st = verbindung.status();
  if (st.verbindung !== "verbunden") return { ok: false, fehler: "Keine Verbindung zum Drucker." };
  if (!st.drucker?.zustand || !STARTBEREIT.includes(st.drucker.zustand)) {
    return { ok: false, fehler: `Drucker ist nicht bereit (${st.drucker?.zustandText ?? "unbekannt"}).` };
  }
  const platten = findePlatten(inhalt);
  if (!platten) return { ok: false, fehler: "Keine gültige .gcode.3mf-Datei." };
  if (platten.length === 0) return { ok: false, fehler: "Die Datei ist nicht geslict (keine Platte darin)." };
  const datei = druckerDateiname(titel, vorlageId);
  const platte = platten[0].eintrag;
  const filamente = filamenteDerPlatte(inhalt, platten[0].nummer);
  let ftp = null;
  try {
    log(`Übertrage „${datei}" (${Math.round(inhalt.length / 1024)} KB, ${platte}, Filament ${filamente ? filamente.join("+") : "? → 1"}) …`);
    ftp = new FtpsSitzung(e);
    const sitzung = ftp;
    // Eine Frist für Anmelden + Übertragen: Hängt irgendwo etwas, wird aufgeräumt
    // und ehrlich gemeldet, statt dass die Brücke für immer „beschäftigt" bleibt.
    await mitFrist((async () => {
      await sitzung.oeffnen();
      await sitzung.hochladen(`/cache/${datei}`, inhalt);
    })(), DRUCK_FRIST_MS, "Übertragung zum Drucker dauert zu lange — abgebrochen", () => sitzung.s?.destroy());
    ftp.schliessen();
    ftp = null;
    log("Übertragen, starte Druck …");
    const erg = await verbindung.starteDruck({ datei, platte, titel, filamente });
    if (erg.angenommen === false) {
      log("⚠ Drucker hat abgelehnt:", erg.grund);
      return { ok: false, fehler: `Drucker hat abgelehnt: ${erg.grund}` };
    }
    log(erg.angenommen ? "✓ Druck gestartet" : "Befehl gesendet, Drucker hat noch nicht bestätigt");
    return { ok: true, bestaetigt: erg.angenommen === true };
  } catch (err) {
    log("⚠ Drucken fehlgeschlagen:", err.message);
    return { ok: false, fehler: err.message };
  } finally {
    ftp?.schliessen();
  }
}

// ── Lagernaut: melden und Aufträge abholen (nur ausgehend) ────────────────────
function starteLagernaut(e, verbindung) {
  if (!e.brueckenSchluessel) {
    log("Hinweis: Kein Brücken-Schlüssel eingetragen — Drucken über Lagernaut ist aus.");
    return;
  }
  const kopf = { Authorization: `Bearer ${e.brueckenSchluessel}` };
  let letzte = "(start)";
  const melde = (fehler) => {
    if (fehler === letzte) return;
    if (fehler) log(fehler);
    else log(letzte === "(start)" ? `✓ Mit Lagernaut verbunden (${e.lagernautUrl})` : "✓ Wieder mit Lagernaut verbunden");
    letzte = fehler;
  };

  // Kamera: nur solange Lagernaut meldet, dass jemand zuschaut — Standbild
  // (kamera: true) oder Video (video: true). Video hat Vorrang: Es liefert dem
  // Server auch die Standbilder mit, beides zugleich braucht es nie.
  let bildBis = 0, videoBis = 0;
  let hochladen = false;
  let letzterUpload = 0;
  const standbild = new KameraStrom(e, (bild, codec) => {
    if (hochladen || Date.now() - letzterUpload < KAMERA_UPLOAD_ABSTAND_MS) return;
    hochladen = true;
    letzterUpload = Date.now();
    fetch(`${e.lagernautUrl}/api/druck/bruecke/bild`, {
      method: "POST",
      headers: { ...kopf, "Content-Type": "application/octet-stream", "X-Codec": codec },
      body: bild, signal: AbortSignal.timeout(15_000),
    })
      .then(async (r) => { if (r.ok && (await r.json())?.weiter === false) bildBis = 0; })
      .catch(() => { /* nächstes Bild */ })
      .finally(() => { hochladen = false; });
  });

  // Video: Bilder sammeln und alle VIDEO_TAKT_MS als ein Paket schicken. Hinkt der
  // Upload hinterher (Gast-WLAN) oder geht ein Paket verloren, wird ab dem nächsten
  // Schlüsselbild weitergemacht — Bilder dazwischen wären ohne Vorgänger nicht
  // decodierbar. Beim Drucken kommt jede Sekunde eines.
  let videoPuffer = [], videoBytes = 0, videoUpload = false, videoLuecke = false;
  const video = new VideoStrom(e, (b) => {
    if (videoLuecke) { if (!b.key) return; videoLuecke = false; }
    videoPuffer.push(b);
    videoBytes += b.daten.length;
    if (videoBytes > VIDEO_RUECKSTAND_BYTES) {
      videoPuffer = []; videoBytes = 0; videoLuecke = true;
      log("⚠ Kamera: Upload zu langsam — Video springt zum nächsten vollständigen Bild");
    }
  });
  const sendeVideo = async () => {
    if (videoUpload || videoPuffer.length === 0) return;
    const paket = videoPuffer;
    videoPuffer = []; videoBytes = 0; videoUpload = true;
    try {
      const r = await fetch(`${e.lagernautUrl}/api/druck/bruecke/video`, {
        method: "POST",
        headers: { ...kopf, "Content-Type": "application/octet-stream", "X-Codec": video.codec },
        body: packeVideo(paket), signal: AbortSignal.timeout(10_000),
      });
      if (!r.ok) throw new Error(String(r.status));
      if ((await r.json())?.weiter === false) videoBis = 0;
    } catch {
      videoLuecke = true;                 // Paket verloren → erst ab dem nächsten Schlüsselbild weiter
    } finally {
      videoUpload = false;
    }
  };
  setInterval(() => void sendeVideo(), VIDEO_TAKT_MS);
  setInterval(() => {
    const jetzt = Date.now();
    if (video.laeuft && jetzt > videoBis) {
      video.stoppen(); videoPuffer = []; videoBytes = 0; videoLuecke = false;
      log("Kamera aus (niemand schaut zu)");
    }
    if (standbild.laeuft && (jetzt > bildBis || video.laeuft)) {
      standbild.stoppen();
      if (!video.laeuft) log("Kamera aus (niemand schaut zu)");
    }
  }, 2000);

  async function meldeErgebnis(a, erg) {
    // Ein paar Versuche, sonst räumt Lagernaut nach 5 min auf.
    for (let i = 0; i < 5; i++) {
      try {
        const r = await fetch(`${e.lagernautUrl}/api/druck/bruecke/ergebnis`, {
          method: "POST", headers: { ...kopf, "Content-Type": "application/json" },
          body: JSON.stringify({ auftragId: a.id, ok: erg.ok, bestaetigt: erg.bestaetigt, meldung: erg.fehler ?? null, beschaeftigt: erg.beschaeftigt === true }),
          signal: AbortSignal.timeout(10_000),
        });
        if (r.ok) return;
        if (r.status === 409) { log(`Hinweis: Lagernaut hatte Auftrag #${a.id} schon abgeschlossen.`); return; }
      } catch { /* gleich nochmal */ }
      await new Promise((ok) => setTimeout(ok, 3000));
    }
    log("⚠ Ergebnis konnte Lagernaut nicht gemeldet werden.");
  }

  async function fuehreAus(a) {
    druckLaeuft = true;
    log(`Auftrag #${a.id} „${a.titel}" aus Lagernaut …`);
    let erg;
    try {
      const r = await fetch(`${e.lagernautUrl}/api/druck/bruecke/datei/${a.id}`, { headers: kopf, signal: AbortSignal.timeout(120_000) });
      if (!r.ok) throw new Error(`Druckdatei nicht abrufbar (${r.status})`);
      const inhalt = Buffer.from(await r.arrayBuffer());
      if (inhalt.length > MAX_DRUCKDATEI) throw new Error("Druckdatei zu groß");
      erg = await druckeInhalt(inhalt, { titel: a.titel, vorlageId: a.vorlageId }, e, verbindung);
    } catch (err) {
      erg = { ok: false, fehler: err.message };
    } finally {
      druckLaeuft = false;
    }
    await meldeErgebnis(a, erg);
  }

  const runde = async () => {
    try {
      const r = await fetch(`${e.lagernautUrl}/api/druck/bruecke`, {
        method: "POST", headers: { ...kopf, "Content-Type": "application/json" },
        body: JSON.stringify(verbindung.status()), signal: AbortSignal.timeout(10_000),
      });
      if (r.status === 401) melde("⚠ Lagernaut kennt diesen Brücken-Schlüssel nicht — in Lagernaut neu koppeln und in der Einstellungsdatei eintragen.");
      else if (!r.ok) melde(`⚠ Lagernaut antwortet mit Fehler ${r.status}`);
      else {
        melde(null);
        const j = await r.json();
        // Nicht abwarten: Während der Übertragung meldet die Brücke weiter ihren Stand.
        if (j?.auftrag) {
          // Nie still verwerfen: Sonst steht der Auftrag 5 min auf „abgeholt" und
          // scheitert dann ohne erkennbaren Grund.
          if (druckLaeuft) void meldeErgebnis(j.auftrag, { ok: false, beschaeftigt: true, fehler: "Die Druckbrücke überträgt gerade noch einen anderen Auftrag." });
          else void fuehreAus(j.auftrag);
        }
        const verbunden = verbindung.status().verbindung === "verbunden";
        if (j?.video === true) {
          videoBis = Date.now() + KAMERA_NACHLAUF_MS;
          if (!video.laeuft && verbunden) { standbild.stoppen(); video.starten(); }
        } else if (j?.kamera === true) {
          bildBis = Date.now() + KAMERA_NACHLAUF_MS;
          if (!standbild.laeuft && !video.laeuft && verbunden) standbild.starten();
        }
      }
    } catch (err) {
      melde(`⚠ Lagernaut nicht erreichbar: ${err.message}`);
    }
    setTimeout(runde, MELDE_TAKT_MS);
  };
  void runde();
}

function starteServer(e, verbindung, bereit) {
  const server = http.createServer((req, res) => {
    // Schutz gegen DNS-Rebinding: nur echte Aufrufe an 127.0.0.1/localhost.
    const host = String(req.headers.host ?? "").replace(/:\d+$/, "");
    if (host !== "127.0.0.1" && host !== "localhost") { res.writeHead(403).end(); return; }

    const origin = req.headers.origin;
    const erlaubt = herkunftErlaubt(origin, e.erlaubteSeiten);
    if (origin && !erlaubt) { res.writeHead(403).end("Seite nicht freigegeben"); return; }
    if (erlaubt) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("Access-Control-Max-Age", "600");
      // Chrome: Anfragen einer Internetseite an den eigenen PC brauchen diese Freigabe.
      res.setHeader("Access-Control-Allow-Private-Network", "true");
      res.writeHead(204).end();
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/status") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" }).end(JSON.stringify(verbindung.status()));
      return;
    }
    // Nur zur Fehlersuche am PC selbst (ohne Origin, also nicht aus einer Webseite).
    if (req.method === "GET" && url.pathname === "/roh" && !origin) {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" }).end(JSON.stringify(verbindung.roh, null, 2));
      return;
    }
    res.writeHead(404).end();
  });
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`⚠ Port ${e.port} ist belegt — die Brücke läuft schon (anderes Fenster oder Autostart).`);
      process.exit(ENDE_LAEUFT_SCHON);
    }
    console.error(`⚠ Webserver: ${err.message}`);
    process.exit(1);
  });
  server.listen(e.port, "127.0.0.1", () => {
    console.log(`Lagernaut-Druckbrücke ${VERSION} — bereit auf http://127.0.0.1:${e.port}`);
    console.log(`Drucker ${e.druckerIp} · Seriennummer ${e.seriennummer}`);
    console.log("Fenster offen lassen, solange gedruckt wird. Beenden mit Strg+C.");
    bereit();
  });
}

// ── Start (nur wenn direkt aufgerufen, nicht beim Import durch die Tests) ────
const direkt = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direkt) {
  // Unerwartete Fehler sichtbar machen; laufen.cmd startet nach einem Absturz neu.
  process.on("unhandledRejection", (err) => console.error(new Date().toLocaleTimeString("de-DE"), "⚠ Unerwarteter Fehler:", err?.message ?? err));
  const e = leseEinstellungen();
  if (e.fehlt) {
    console.error(`⚠ ${e.fehlt}`);
    process.exit(ENDE_EINSTELLUNGEN);
  }
  const v = new DruckerVerbindung(e);
  // Erst wenn der Port sicher uns gehört, mit Drucker und Lagernaut verbinden —
  // eine versehentlich doppelt gestartete Brücke darf nie einen Auftrag abholen.
  starteServer(e, v, () => {
    v.starten();
    starteLagernaut(e, v);
  });
}
