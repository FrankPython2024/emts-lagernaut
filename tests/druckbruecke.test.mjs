/**
 * Tests für die Druckbrücke (tools/druckbruecke/druckbruecke.mjs):
 * MQTT-Pakete bauen/zerlegen, Berichte zusammenführen, Status auswerten.
 *
 * Ausführen:  node tests/druckbruecke.test.mjs   (oder: npm run test:bruecke)
 * Reine Logik, kein Netz, kein Drucker.
 */

import {
  kodiereLaenge, baueConnect, baueSubscribe, bauePublish, zerlegePakete, lesePublish,
  fuehreZusammen, fasseStatus, herkunftErlaubt,
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

console.log(`\n${failed === 0 ? "✅" : "❌"}  ${passed} bestanden, ${failed} fehlgeschlagen\n`);
process.exit(failed === 0 ? 0 : 1);
