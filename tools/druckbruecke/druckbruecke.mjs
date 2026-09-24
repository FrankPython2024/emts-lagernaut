// ── Lagernaut-Druckbrücke (3D-Druck Paket 3: Status + Drucken) ─────────────
//
// Läuft auf dem PC beim Drucker (Bambu Lab P2S) und verbindet ihn mit der
// Lagernaut-Seite, die IN DEM BROWSER DIESES PCs geöffnet ist:
//
//     Lagernaut im Browser ──► http://127.0.0.1:17350 (diese Brücke) ──► Drucker im LAN
//
// Die Brücke spricht NIE mit dem Lagernaut-Server und nimmt nur Anfragen vom
// eigenen PC an (lauscht auf 127.0.0.1). Der Zugangscode des Druckers steht nur
// in der Einstellungsdatei auf diesem PC.
//
// Voraussetzung am Drucker: „Nur LAN" + „Entwicklermodus" (Einstellungen → WLAN).
// Protokoll: MQTT über TLS, Port 8883, Benutzer „bblp", Passwort = Zugangscode,
// Status unter device/<Seriennummer>/report.
//
// Bewusst OHNE Zusatzpakete (nur Node.js): eine Datei, überall startbar,
// später als .exe verpackbar. Das Nötigste an MQTT 3.1.1 steht deshalb unten
// selbst drin (Verbinden, Abonnieren, Senden, Ping).
//
// Drucken (Stufe 2): Die Lagernaut-Seite holt die geslicte Datei (.gcode.3mf)
// und schickt sie an POST /drucken. Die Brücke legt sie per FTPS (Port 990,
// implizites TLS, vsFTPd) in den internen Speicher /cache und startet sie per
// MQTT „project_file". Gemessen am P2S am 24.09.2026: Bambu Studio legt seine
// Druckdateien genau dort ab, und der Datenkanal verlangt DIESELBE TLS-Sitzung
// wie die Anmeldung (sonst ECONNRESET) — und die Verschlüsselung des
// Datenkanals beginnt erst NACH dem Befehl (LIST/STOR), nicht vorher.
//
// Starten:  node druckbruecke.mjs      (oder „Druckbruecke starten.cmd")
// Test:     npm run test:bruecke       (Paket-Kodierung + Statusauswertung)

import tls from "node:tls";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export const VERSION = "1.1.0";
/** Größte Druckdatei, die die Brücke annimmt. */
export const MAX_DRUCKDATEI = 60 * 1024 * 1024;
/** In diesen Zuständen darf ein neuer Druck starten. */
export const STARTBEREIT = ["IDLE", "FINISH", "FAILED"];
export const STANDARD_PORT = 17350;
// Für Tests über DRUCKBRUECKE_EINSTELLUNGEN auf eine andere Datei umlenkbar.
export const EINSTELLUNGEN = process.env.DRUCKBRUECKE_EINSTELLUNGEN || path.join(os.homedir(), ".lagernaut-druckbruecke.json");
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

/** Dateiname auf dem Drucker: nur sichere Zeichen, je Vorlage fest (überschreibt den letzten). */
export function druckerDateiname(name, vorlageId) {
  const ascii = String(name ?? "")
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/Ä/g, "Ae").replace(/Ö/g, "Oe").replace(/Ü/g, "Ue").replace(/ß/g, "ss")
    .replace(/\.gcode\.3mf$/i, "")
    .replace(/[^A-Za-z0-9 ._-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "druck";
  const id = Number.isInteger(vorlageId) && vorlageId > 0 ? `_L${vorlageId}` : "";
  return `${ascii}${id}.gcode.3mf`;
}

/** Der MQTT-Befehl, der eine Datei aus /cache startet (lokaler Druck: Ids immer 0). */
export function druckBefehl({ datei, platte, titel, sequenz }) {
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
      use_ams:        false, // kein AMS am P2S (ams_exist_bits 0) — Filament von der Spule
      ams_mapping:    "",
    },
  };
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
    const d = tls.connect({ host: this.e.druckerIp, port, rejectUnauthorized: false, session: this.sitzung ?? this.s.getSession() });
    const teile = [];
    d.on("data", (x) => teile.push(x));
    const verschluesselt = new Promise((ok) => d.once("secureConnect", ok));
    let datenFehler = null;
    d.on("error", (err) => { datenFehler = err; });
    const zu = new Promise((ok) => d.on("close", ok));
    const start = await this.befehl(zeile);
    if (!/^1\d\d$/.test(start.code)) { d.destroy(); throw new Error(`FTP: ${start.text.replace(/^\d{3} /, "")}`); }
    if (senden) {
      await verschluesselt;
      d.end(senden);
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
  return {
    druckerIp:      String(e.druckerIp).trim(),
    seriennummer:   String(e.seriennummer).trim(),
    zugangscode:    String(e.zugangscode).trim(),
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

    s.on("secureConnect", () => {
      s.setTimeout(0);
      s.write(baueConnect({
        clientId: `lagernaut-${crypto.randomBytes(3).toString("hex")}`,
        benutzer: "bblp",
        passwort: this.e.zugangscode,
      }));
    });
    s.on("timeout", () => s.destroy(new Error("Drucker antwortet nicht (Zeitüberschreitung)")));
    s.on("data", (d) => {
      puffer = Buffer.concat([puffer, d]);
      const { pakete, rest } = zerlegePakete(puffer);
      puffer = Buffer.from(rest);
      for (const p of pakete) this.verarbeite(p);
    });
    s.on("error", (err) => { this.zustand.fehler = err.message; });
    s.on("close", () => {
      clearInterval(this.ping);
      clearInterval(this.pushall);
      if (this.zustand.verbindung === "verbunden") this.log("Verbindung zum Drucker getrennt");
      this.zustand.verbindung = "getrennt";
      const w = this.wartezeit;
      this.wartezeit = Math.min(60_000, this.wartezeit * 2);
      setTimeout(() => this.starten(), w);
    });
  }

  verarbeite({ typ, flags, rumpf }) {
    if (typ === 2) { // CONNACK
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
      this.ping = setInterval(() => this.socket?.write(PINGREQ), 30_000);
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
  starteDruck({ datei, platte, titel }) {
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
      try { this.sende(druckBefehl({ datei, platte, titel, sequenz })); }
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

// ── Kleiner Webserver nur für diesen PC ───────────────────────────────────────

/** Darf diese Seite die Brücke fragen? Nur eingetragene Lagernaut-Adressen. */
export function herkunftErlaubt(origin, erlaubte) {
  return typeof origin === "string" && erlaubte.includes(origin.replace(/\/$/, ""));
}

function antworteJson(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }).end(JSON.stringify(obj));
}

function leseKoerper(req, max) {
  return new Promise((ok, fehler) => {
    const teile = [];
    let n = 0;
    req.on("data", (c) => {
      n += c.length;
      if (n > max) { fehler(new Error("Datei zu groß")); req.destroy(); return; }
      teile.push(c);
    });
    req.on("end", () => ok(Buffer.concat(teile)));
    req.on("error", fehler);
  });
}

let druckLaeuft = false;

async function drucke(req, res, url, e, verbindung) {
  if (url.searchParams.get("bestaetigt") !== "1") return antworteJson(res, 400, { fehler: "Bestätigung fehlt (Platte leer, Filament eingelegt)." });
  if (druckLaeuft) return antworteJson(res, 409, { fehler: "Es wird gerade schon ein Druck übertragen." });
  const st = verbindung.status();
  if (st.verbindung !== "verbunden") return antworteJson(res, 409, { fehler: "Keine Verbindung zum Drucker." });
  if (!st.drucker?.zustand || !STARTBEREIT.includes(st.drucker.zustand)) {
    return antworteJson(res, 409, { fehler: `Drucker ist nicht bereit (${st.drucker?.zustandText ?? "unbekannt"}).` });
  }
  druckLaeuft = true;
  const log = (...a) => console.log(new Date().toLocaleTimeString("de-DE"), ...a);
  let ftp = null;
  try {
    const inhalt = await leseKoerper(req, MAX_DRUCKDATEI);
    const platten = findePlatten(inhalt);
    if (!platten) return antworteJson(res, 400, { fehler: "Keine gültige .gcode.3mf-Datei." });
    if (platten.length === 0) return antworteJson(res, 400, { fehler: "Die Datei ist nicht geslict (keine Platte darin). Bitte in Bambu Studio „geslicte Platte exportieren“." });
    const vorlageId = Number(url.searchParams.get("vorlage"));
    const titel = String(url.searchParams.get("titel") ?? "Lagernaut").slice(0, 100);
    const datei = druckerDateiname(titel, vorlageId);
    const platte = platten[0].eintrag;
    log(`Übertrage „${datei}" (${Math.round(inhalt.length / 1024)} KB, ${platte}) …`);
    ftp = new FtpsSitzung(e);
    await ftp.oeffnen();
    await ftp.hochladen(`/cache/${datei}`, inhalt);
    ftp.schliessen();
    ftp = null;
    log("Übertragen, starte Druck …");
    const erg = await verbindung.starteDruck({ datei, platte, titel });
    if (erg.angenommen === false) {
      log("⚠ Drucker hat abgelehnt:", erg.grund);
      return antworteJson(res, 502, { fehler: `Drucker hat abgelehnt: ${erg.grund}`, datei });
    }
    log(erg.angenommen ? "✓ Druck gestartet" : "Befehl gesendet, Drucker hat noch nicht bestätigt");
    return antworteJson(res, 200, { ok: true, bestaetigt: erg.angenommen === true, datei, platte, weiterePlatten: platten.length - 1 });
  } catch (err) {
    log("⚠ Drucken fehlgeschlagen:", err.message);
    return antworteJson(res, 500, { fehler: err.message });
  } finally {
    ftp?.schliessen();
    druckLaeuft = false;
  }
}

function starteServer(e, verbindung) {
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
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
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
    if (req.method === "POST" && url.pathname === "/drucken") {
      // Nur aus Lagernaut: Ein Druck braucht die Bestätigung im Dialog dort.
      if (!erlaubt) { res.writeHead(403).end("Nur aus Lagernaut"); return; }
      void drucke(req, res, url, e, verbindung);
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
    console.error(err.code === "EADDRINUSE"
      ? `⚠ Port ${e.port} ist belegt — läuft die Brücke schon in einem anderen Fenster?`
      : `⚠ Webserver: ${err.message}`);
    process.exit(1);
  });
  server.listen(e.port, "127.0.0.1", () => {
    console.log(`Lagernaut-Druckbrücke ${VERSION} — bereit auf http://127.0.0.1:${e.port}`);
    console.log(`Drucker ${e.druckerIp} · Seriennummer ${e.seriennummer}`);
    console.log("Fenster offen lassen, solange gedruckt wird. Beenden mit Strg+C.");
  });
}

// ── Start (nur wenn direkt aufgerufen, nicht beim Import durch die Tests) ────
const direkt = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direkt) {
  const e = leseEinstellungen();
  if (e.fehlt) {
    console.error(`⚠ ${e.fehlt}`);
    process.exit(1);
  }
  const v = new DruckerVerbindung(e);
  starteServer(e, v);
  v.starten();
}
