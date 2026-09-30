/**
 * Tests für die Druckbrücke (tools/druckbruecke/druckbruecke.mjs):
 * MQTT-Pakete bauen/zerlegen, Berichte zusammenführen, Status auswerten.
 *
 * Ausführen:  node tests/druckbruecke.test.mjs   (oder: npm run test:bruecke)
 * Reine Logik, kein Netz, kein Drucker.
 */

import {
  kodiereLaenge, baueConnect, baueSubscribe, bauePublish, zerlegePakete, lesePublish,
  fuehreZusammen, fasseStatus, herkunftErlaubt, findePlatten, druckerDateiname, druckBefehl,
  leseZipEintrag, filamenteDerPlatte, spulenZuordnung,
  H264Sammler, leseSdp, codecAusSps, digestAntwort,
} from "../tools/druckbruecke/druckbruecke.mjs";
import zlib from "node:zlib";

let passed = 0;
let failed = 0;
function check(label, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`  ✅ ${label}`); }
  else { failed++; console.error(`  ❌ ${label}\n     Erwartet: ${JSON.stringify(expected)}\n     Bekommen: ${JSON.stringify(actual)}`); }
}
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, "0")).join(" ");

console.log("\n── Restlänge (Varint) ──");
check("0", hex(kodiereLaenge(0)), "00");
check("127", hex(kodiereLaenge(127)), "7f");
check("128", hex(kodiereLaenge(128)), "80 01");
check("16383", hex(kodiereLaenge(16383)), "ff 7f");
check("16384", hex(kodiereLaenge(16384)), "80 80 01");

console.log("\n── CONNECT ──");
const c = baueConnect({ clientId: "a", benutzer: "bblp", passwort: "12345678", keepAlive: 60 });
// 10 Byte Kopf + (2+1) + (2+4) + (2+8) = 29
check("Typ + Länge", hex(c.subarray(0, 2)), "10 1d");
check("Protokoll MQTT 3.1.1, Flags c2, KeepAlive 60", hex(c.subarray(2, 12)), "00 04 4d 51 54 54 04 c2 00 3c");
check("Benutzer bblp", c.subarray(15, 21).toString("latin1"), "\u0000\u0004bblp");

console.log("\n── SUBSCRIBE / PUBLISH ──");
const s = baueSubscribe(1, "device/X/report");
check("SUBSCRIBE Kopf 82, Paket-Id 1, QoS 0 am Ende", [s[0], s.readUInt16BE(2), s[s.length - 1]], [0x82, 1, 0]);
const p = bauePublish("device/X/request", '{"a":1}');
const zp = zerlegePakete(p);
check("PUBLISH wieder lesbar", lesePublish(zp.pakete[0].flags, zp.pakete[0].rumpf), { thema: "device/X/request", nutzlast: '{"a":1}' });

console.log("\n── Zerlegen in Stücken ──");
const gross = bauePublish("device/X/report", JSON.stringify({ print: { x: "y".repeat(300) } }));
const zwei = Buffer.concat([Buffer.from([0x20, 0x02, 0x00, 0x00]), gross]);
const teil1 = zerlegePakete(zwei.subarray(0, 50));
check("unvollständig: nur CONNACK, Rest bleibt", [teil1.pakete.length, teil1.pakete[0].typ, teil1.rest.length], [1, 2, 46]);
const teil2 = zerlegePakete(Buffer.concat([teil1.rest, zwei.subarray(50)]));
check("Rest + Nachschub = PUBLISH mit Länge > 127", [teil2.pakete.length, teil2.pakete[0].typ, teil2.rest.length], [1, 3, 0]);
check("leerer Puffer", zerlegePakete(Buffer.alloc(0)).pakete.length, 0);
const qos1 = Buffer.from([0x32, 0x09, 0x00, 0x01, 0x74, 0x00, 0x07, 0x68, 0x61, 0x6c, 0x6c]);
const q = zerlegePakete(qos1).pakete[0];
check("PUBLISH QoS 1: Paket-Id wird übersprungen", lesePublish(q.flags, q.rumpf), { thema: "t", nutzlast: "hall" });

console.log("\n── Berichte zusammenführen ──");
const roh = {};
fuehreZusammen(roh, { print: { gcode_state: "RUNNING", mc_percent: 10, hms: [1, 2], nozzle_temper: 220 } });
fuehreZusammen(roh, { print: { mc_percent: 43, hms: [] } });
check("Änderung überschreibt, Rest bleibt, Listen werden ersetzt", roh.print, { gcode_state: "RUNNING", mc_percent: 43, hms: [], nozzle_temper: 220 });

console.log("\n── Status auswerten ──");
const st = fasseStatus({
  gcode_state: "RUNNING", mc_percent: 43, mc_remaining_time: 72, layer_num: 50, total_layer_num: 210,
  nozzle_temper: 219.8, nozzle_target_temper: 220, bed_temper: 65, bed_target_temper: 65,
  subtask_name: "L13 Fuss vorne 40x", print_error: 0, hms: [],
});
check("druckt, Fortschritt, Rest, Schicht", [st.zustandText, st.fortschritt, st.restMinuten, st.schicht, st.schichten], ["druckt", 43, 72, 50, 210]);
check("Datei und Temperaturen", [st.datei, st.duese, st.bett], ["L13 Fuss vorne 40x", 219.8, 65]);
check("print_error 0 → kein Fehler", st.fehlercode, null);
check("Zahlen als Text werden gelesen", fasseStatus({ mc_percent: "12" }).fortschritt, 12);
check("unbekannter Zustand bleibt lesbar", fasseStatus({ gcode_state: "offline" }).zustandText, "offline");
check("kein Bericht → null", fasseStatus(undefined), null);
check("externe Spule aus vir_slot (echter P2S-Bericht)", fasseStatus({ vir_slot: [{ id: "255", tray_type: "PLA", tray_color: "161616FF" }] }).spule, { typ: "PLA", farbe: "#161616" });
check("ohne vir_slot → keine Spule", fasseStatus({ gcode_state: "IDLE" }).spule, null);

console.log("\n── Freigegebene Seiten ──");
const erl = ["https://emts-lagernaut.duckdns.org"];
check("Lagernaut erlaubt", herkunftErlaubt("https://emts-lagernaut.duckdns.org", erl), true);
check("mit Schrägstrich am Ende erlaubt", herkunftErlaubt("https://emts-lagernaut.duckdns.org/", erl), true);
check("fremde Seite abgelehnt", herkunftErlaubt("https://boese.example", erl), false);
check("ähnliche Seite abgelehnt", herkunftErlaubt("https://emts-lagernaut.duckdns.org.boese.example", erl), false);
check("ohne Origin abgelehnt", herkunftErlaubt(undefined, erl), false);

console.log("\n── Platten in der Druckdatei (ZIP-Inhaltsverzeichnis) ──");
// Minimales ZIP ohne Inhalt: nur Zentralverzeichnis + Ende-Eintrag, wie es findePlatten liest.
function zip(namen) {
  const cd = Buffer.concat(namen.map((n) => {
    const name = Buffer.from(n, "utf8");
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0);
    h.writeUInt16LE(name.length, 28);
    return Buffer.concat([h, name]);
  }));
  const vorne = Buffer.from("PK-Dateiinhalt-egal");
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(namen.length, 8);
  eocd.writeUInt16LE(namen.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(vorne.length, 16);
  return Buffer.concat([vorne, cd, eocd]);
}
check("Platte 1", findePlatten(zip(["Metadata/plate_1.gcode", "Metadata/plate_1.png", "3D/3dmodel.model"])), [{ eintrag: "Metadata/plate_1.gcode", nummer: 1 }]);
check("nur Platte 2 exportiert (wie „P2S Full Set“ am Drucker)", findePlatten(zip(["Metadata/plate_2.gcode", "Metadata/plate_2.json"]))?.map((p) => p.nummer), [2]);
check("mehrere Platten sortiert", findePlatten(zip(["Metadata/plate_3.gcode", "Metadata/plate_1.gcode"]))?.map((p) => p.nummer), [1, 3]);
check("nicht geslict (Projekt ohne gcode) → leer", findePlatten(zip(["3D/3dmodel.model", "Metadata/model_settings.config"])), []);
check("kein ZIP → null", findePlatten(Buffer.from("das ist keine zip-datei, nur text ".repeat(3))), null);
check(".md5-Datei zählt nicht", findePlatten(zip(["Metadata/plate_1.gcode.md5"])), []);

console.log("\n── Dateiname auf dem Drucker ──");
check("Umlaute, ß, Vorlage-Nr.", druckerDateiname("Latitude 7310 Füße vorne", 3), "Latitude 7310 Fuesse vorne_L3.gcode.3mf");
check("Sonderzeichen raus, Endung nicht doppelt", druckerDateiname("E14/Gen4: Fuß*.gcode.3mf", 12), "E14 Gen4 Fuss_L12.gcode.3mf");
check("leerer Name", druckerDateiname("", 0), "druck.gcode.3mf");
check("höchstens 60 Zeichen Name", druckerDateiname("x".repeat(100), 1).length, 60 + "_L1.gcode.3mf".length);

console.log("\n── Druckbefehl ──");
const bef = druckBefehl({ datei: "A_L1.gcode.3mf", platte: "Metadata/plate_2.gcode", titel: "A", sequenz: 7 }).print;
check("project_file aus /cache", [bef.command, bef.url, bef.file, bef.param], ["project_file", "ftp:///cache/A_L1.gcode.3mf", "A_L1.gcode.3mf", "Metadata/plate_2.gcode"]);
check("lokaler Druck: Ids 0, ohne AMS, Sequenz als Text", [bef.project_id, bef.task_id, bef.use_ams, bef.sequence_id], ["0", "0", false, "7"]);

console.log("\n── Spulen-Zuordnung (P2S ohne AMS, 07FF-8012) ──");
check("Filament 1 → externe Spule", spulenZuordnung([1]), { ams_mapping: [-1], ams_mapping2: [{ ams_id: 255, slot_id: 0 }] });
check("nur Filament 4 (wie „P2S Full Set“) → Spule an Stelle 4, Rest ungültig", spulenZuordnung([4]).ams_mapping2,
  [{ ams_id: 255, slot_id: 255 }, { ams_id: 255, slot_id: 255 }, { ams_id: 255, slot_id: 255 }, { ams_id: 255, slot_id: 0 }]);
check("flaches ams_mapping immer -1 (rohe Platznummern lehnt die Firmware ab)", spulenZuordnung([2, 3]).ams_mapping, [-1, -1, -1]);
check("unbekannt → wie Filament 1", spulenZuordnung(null), spulenZuordnung([1]));
check("Befehl trägt die Zuordnung (nie mehr leer)", druckBefehl({ datei: "a", platte: "p", titel: "t", sequenz: 1, filamente: [1] }).print.ams_mapping2, [{ ams_id: 255, slot_id: 0 }]);

console.log("\n── Filamente aus slice_info.config (echtes ZIP mit deflate) ──");
function echtesZip(eintraege) {
  const lokal = [], zentral = [];
  let versatz = 0;
  for (const [name, text] of eintraege) {
    const n = Buffer.from(name, "utf8");
    const roh = Buffer.from(text, "utf8");
    const gepackt = zlib.deflateRawSync(roh);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(gepackt.length, 18); lh.writeUInt32LE(roh.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(gepackt.length, 20); ch.writeUInt32LE(roh.length, 24); ch.writeUInt16LE(n.length, 28);
    ch.writeUInt32LE(versatz, 42);
    lokal.push(lh, n, gepackt);
    zentral.push(ch, n);
    versatz += 30 + n.length + gepackt.length;
  }
  const cd = Buffer.concat(zentral);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(eintraege.length, 8); eocd.writeUInt16LE(eintraege.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(versatz, 16);
  return Buffer.concat([...lokal, cd, eocd]);
}
const slice = `<?xml version="1.0"?><config>
<plate><metadata key="index" value="1"/><filament id="1" type="PLA" used_g="8.67"/></plate>
<plate><metadata key="index" value="2"/><filament id="4" type="PETG"/><filament id="2" type="PLA"/></plate>
</config>`;
const z = echtesZip([["Metadata/plate_2.gcode", "G28"], ["Metadata/slice_info.config", slice]]);
check("Eintrag entpacken", leseZipEintrag(z, "Metadata/plate_2.gcode")?.toString(), "G28");
check("fehlender Eintrag → null", leseZipEintrag(z, "gibt/es/nicht"), null);
check("Platte 1 → Filament 1", filamenteDerPlatte(z, 1), [1]);
check("Platte 2 → Filamente 2 und 4, sortiert", filamenteDerPlatte(z, 2), [2, 4]);
check("ohne slice_info → null", filamenteDerPlatte(echtesZip([["Metadata/plate_1.gcode", "G28"]]), 1), null);

console.log("\n── Kamera: SDP, Codec, Anmeldung ──");
{
  // Echte SDP des P2S vom 30.09.2026 (gekürzt)
  const sdp = "v=0\r\na=control:*\r\nm=video 0 RTP/AVP 96\r\na=rtpmap:96 H264/90000\r\n" +
    "a=fmtp:96 packetization-mode=1;profile-level-id=641029;sprop-parameter-sets=Z2QQKawbGqB4AiflhAAAAwAEAAADAPI8IBCo,aO48sA==\r\na=control:track1\r\n";
  const x = leseSdp(sdp);
  check("Spur-Adresse aus dem Video-Teil, nicht das „*“ davor", x.control, "track1");
  check("SPS und PPS aus sprop", x.sprop.map((b) => b[0] & 0x1f), [7, 8]);
  check("Codec aus der SPS", codecAusSps(x.sprop[0]), "avc1.641029");
  check("zu kurze SPS → null", codecAusSps(Buffer.from([0x67])), null);
  check("ohne sprop → leer", leseSdp("m=video 0 RTP/AVP 96\r\na=control:track1").sprop, []);
  const d = { benutzer: "bblp", passwort: "12345678", realm: "LIVE555 Streaming Media", nonce: "abc", methode: "DESCRIBE", uri: "rtsps://1.2.3.4:322/streaming/live/1" };
  check("Digest ist 32 Hex-Zeichen", /^[0-9a-f]{32}$/.test(digestAntwort(d)), true);
  check("Digest hängt an der Methode", digestAntwort(d) !== digestAntwort({ ...d, methode: "SETUP" }), true);
}

console.log("\n── Kamera: Bilder aus RTP-Paketen ──");
{
  const SPS = Buffer.from("Z2QQKawbGqB4AiflhAAAAwAEAAADAPI8IBCo", "base64");
  const PPS = Buffer.from("aO48sA==", "base64");
  let seq = 0;
  const rtp = (nutz, { ts, marker = false, cc = 0, pad = 0 } = {}) => {
    const kopf = Buffer.alloc(12 + cc * 4);
    kopf[0] = 0x80 | (pad ? 0x20 : 0) | cc; kopf[1] = (marker ? 0x80 : 0) | 96;
    kopf.writeUInt16BE(seq++ & 0xffff, 2); kopf.writeUInt32BE(ts, 4);
    const auff = pad ? Buffer.concat([Buffer.alloc(pad - 1), Buffer.from([pad])]) : Buffer.alloc(0);
    return Buffer.concat([kopf, nutz, auff]);
  };
  const idr = Buffer.concat([Buffer.from([0x65]), Buffer.alloc(3000, 0xab)]);
  const fuA = (nal, stueck) => {
    const out = []; const rumpf = nal.subarray(1);
    for (let i = 0; i < rumpf.length; i += stueck) {
      const start = i === 0, ende = i + stueck >= rumpf.length;
      out.push(Buffer.concat([Buffer.from([(nal[0] & 0xe0) | 28, (start ? 0x80 : 0) | (ende ? 0x40 : 0) | (nal[0] & 0x1f)]), rumpf.subarray(i, i + stueck)]));
    }
    return out;
  };
  const annexB = (...nals) => Buffer.concat(nals.flatMap((n) => [Buffer.from([0, 0, 0, 1]), n]));

  const s1 = new H264Sammler([SPS, PPS]);
  const teile = fuA(idr, 1000);
  const erg = teile.map((t, i) => s1.rtp(rtp(t, { ts: 9000, marker: i === teile.length - 1 })));
  check("Zwischenpakete liefern nichts", erg.slice(0, -1).every((x) => x === null), true);
  check("IDR aus FU-A → Schlüsselbild mit SPS/PPS davor", erg.at(-1)?.equals(annexB(SPS, PPS, idr)), true);

  const pRahmen = Buffer.concat([Buffer.from([0x41]), Buffer.alloc(500, 1)]);
  check("P-Bild (kein Schlüsselbild) → null", s1.rtp(rtp(pRahmen, { ts: 12000, marker: true })), null);

  // STAP-A mit SPS+PPS, danach IDR als Einzelpaket; SPS/PPS erst im Strom
  const s2 = new H264Sammler();
  const stap = Buffer.concat([Buffer.from([24]), Buffer.from([0, SPS.length]), SPS, Buffer.from([0, PPS.length]), PPS]);
  check("STAP-A allein ist kein Bild", s2.rtp(rtp(stap, { ts: 100 })), null);
  const klein = Buffer.from([0x65, 1, 2, 3]);
  check("SPS/PPS aus STAP-A + IDR einzeln", s2.rtp(rtp(klein, { ts: 100, marker: true }))?.equals(annexB(SPS, PPS, klein)), true);

  const s3 = new H264Sammler();
  check("ohne SPS/PPS kein Bild (nicht decodierbar)", s3.rtp(rtp(klein, { ts: 5, marker: true })), null);

  // Neues Bild beginnt, ohne dass das alte fertig wurde → Reste nie mischen
  const s4 = new H264Sammler([SPS, PPS]);
  s4.rtp(rtp(fuA(idr, 1000)[0], { ts: 1 }));
  check("abgebrochenes Bild wird verworfen", s4.rtp(rtp(klein, { ts: 2, marker: true }))?.equals(annexB(SPS, PPS, klein)), true);

  // CSRC-Liste und Auffüllbytes im RTP-Kopf
  const s5 = new H264Sammler([SPS, PPS]);
  check("RTP mit CSRC und Auffüllung", s5.rtp(rtp(klein, { ts: 7, marker: true, cc: 2, pad: 4 }))?.equals(annexB(SPS, PPS, klein)), true);
  check("kein RTP (Version ≠ 2) → null", s5.rtp(Buffer.alloc(20)), null);
}

console.log(`\n${failed === 0 ? "✅" : "❌"}  ${passed} bestanden, ${failed} fehlgeschlagen\n`);
process.exit(failed === 0 ? 0 : 1);
