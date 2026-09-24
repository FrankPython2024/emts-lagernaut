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
} from "../tools/druckbruecke/druckbruecke.mjs";

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

console.log(`\n${failed === 0 ? "✅" : "❌"}  ${passed} bestanden, ${failed} fehlgeschlagen\n`);
process.exit(failed === 0 ? 0 : 1);
