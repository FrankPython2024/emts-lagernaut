// ── Lagernaut-Druckbrücke (3D-Druck Paket 3, Stufe 1: nur Status lesen) ──────
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
// Starten:  node druckbruecke.mjs      (oder „Druckbruecke starten.cmd")
// Test:     npm run test:bruecke       (Paket-Kodierung + Statusauswertung)

import tls from "node:tls";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export const VERSION = "1.0.0";
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
      try {
        const j = JSON.parse(nutzlast);
        fuehreZusammen(this.roh, j);
        this.zustand.letzterBericht = new Date().toISOString();
      } catch { /* kein JSON — ignorieren */ }
    }
    // SUBACK (9) und PINGRESP (13) brauchen keine Antwort.
  }

  fordereKomplettAn() {
    this.socket?.write(bauePublish(`device/${this.e.seriennummer}/request`,
      JSON.stringify({ pushing: { sequence_id: String(Date.now() % 100000), command: "pushall" } })));
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
