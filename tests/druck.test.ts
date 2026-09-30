/**
 * Tests für die 3D-Druck-Druckliste (src/lib/druck/druckliste.ts).
 *
 * Ausführen:  npx tsx tests/druck.test.ts   (oder: npm run test:druck)
 *
 * Reine Logik, kein Netz, keine Datenbank.
 */

import {
  planeDruckliste, dateiArt, teiltypenAus, teiltypenText,
  type BedarfZeile, type VorlageKurz,
} from "../src/lib/druck/druckliste";
import { darfStarten, platteNachBericht, haengt, istDerAuftrag, materialPasst } from "../src/lib/druck/warteschlange";
import {
  KAMERA_NACHFRAGE_MS, codecGueltig, siehtAusWieH264, kameraAnfordern, kameraGewuenscht, kameraBildSpeichern, kameraBild,
} from "../src/modules/druck/kamera";
import {
  VIDEO_VERALTET_MS, leererPuffer, packeVideo, entpackeVideo, fuegeHinzu, bilderFuer, videoAnfordern, videoGewuenscht,
} from "../src/modules/druck/kameraVideo";
import { entpackeVideoPaket, waehleBild } from "../src/lib/druck/videoSpieler";
import { phaseVon, tempoText, wlanText, restText, fertigUm } from "../src/lib/druck/druckerPhase";
import { plattenAusZip, waehlePlatte } from "../src/modules/druck/vorschau";

let passed = 0;
let failed = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.error(`  ❌ ${label}`);
    console.error(`     Erwartet: ${JSON.stringify(expected)}`);
    console.error(`     Bekommen: ${JSON.stringify(actual)}`);
  }
}

const OPTS = { tage: 90, vorratTage: 30, minAnfragenKonstruieren: 2 };
const b = (key: string, teiltyp: string, x: Partial<BedarfZeile> = {}): BedarfZeile =>
  ({ key, teiltyp, name: key, anfragen: 0, stueck: 0, offenStueck: 0, bestand: 0, ...x });
const v = (id: number, keys: string[], teiltypen = ["Füße vorne"], stueckProPlatte: number | null = 40): VorlageKurz =>
  ({ id, name: `Vorlage ${id}`, teiltypen, modellKeys: keys, stueckProPlatte });

console.log("\n── Jetzt drucken ──");
// 90 Stück in 90 Tagen = 1/Tag → 30 Vorrat; 2 offen; 10 Bestand → 22 fehlen
const e = planeDruckliste([b("e14", "Füße vorne", { anfragen: 60, stueck: 90, offenStueck: 2, bestand: 10 })], [v(1, ["e14"])], OPTS);
check("fehlt = Vorrat + offen − Bestand", e.drucken[0]?.fehlt, 22);
check("Platten aufgerundet (40 je Platte)", e.drucken[0]?.platten, 1);
check("Reichweite 10 Tage", e.drucken[0]?.reichweiteTage, 10);
check("Vorlage genannt", [e.drucken[0]?.vorlageId, e.drucken[0]?.vorlageName], [1, "Vorlage 1"]);

const genug = planeDruckliste([b("l13", "Füße vorne", { anfragen: 5, stueck: 9, bestand: 209 })], [v(1, ["l13"])], OPTS);
check("Bestand reicht → versorgt, nicht in der Liste", [genug.drucken.length, genug.versorgt], [0, 1]);

const ohnePlatte = planeDruckliste([b("x", "Füße vorne", { anfragen: 1, stueck: 1, offenStueck: 1 })], [v(2, ["x"], ["Füße vorne"], null)], OPTS);
check("ohne Stück je Platte → keine Plattenzahl", ohnePlatte.drucken[0]?.platten, null);

const nurOffen = planeDruckliste([b("y", "Füße vorne", { anfragen: 1, stueck: 0, offenStueck: 2 })], [v(3, ["y"])], OPTS);
check("kein Verbrauch, aber offen → fehlt 2, Reichweite null", [nurOffen.drucken[0]?.fehlt, nurOffen.drucken[0]?.reichweiteTage], [2, null]);

console.log("\n── Teiltyp muss passen ──");
const hinten = planeDruckliste([b("e14", "Füße hinten", { anfragen: 3, stueck: 3 })], [v(1, ["e14"], ["Füße vorne"])], OPTS);
check("Vorlage nur für vorne deckt hinten nicht", [hinten.drucken.length, hinten.konstruieren.length], [0, 1]);
const beide = planeDruckliste([b("e14", "Füße hinten", { anfragen: 3, stueck: 3 })], [v(1, ["e14"], ["Füße vorne", "Füße hinten"])], OPTS);
check("Vorlage für vorne + hinten deckt hinten", beide.drucken.length, 1);

console.log("\n── Konstruieren lohnt sich ──");
const k = planeDruckliste([
  b("u7411", "Füße vorne", { anfragen: 14, stueck: 20 }),
  b("e14", "Füße vorne", { anfragen: 49, stueck: 60 }),
  b("einzel", "Füße vorne", { anfragen: 1, stueck: 1 }),
], [], OPTS);
check("nach Stück sortiert, Einzelfälle raus", k.konstruieren.map((x) => x.key), ["e14", "u7411"]);
const gedeckt = planeDruckliste([
  b("u7411h", "Füße hinten", { anfragen: 7, stueck: 7, bestand: 230 }),
  b("t14s", "Füße hinten", { anfragen: 6, stueck: 10 }),
], [], OPTS);
check("ungedeckt vor gedeckt (U7411 mit 230 Bestand nach hinten)", gedeckt.konstruieren.map((x) => x.key), ["t14s", "u7411h"]);
check("gedeckt: fehlt 0, Reichweite berechnet", [gedeckt.konstruieren[1]?.fehlt, gedeckt.konstruieren[1]?.reichweiteTage], [0, 2957]);

console.log("\n── Sortierung ──");
const s = planeDruckliste([
  b("a", "Füße vorne", { anfragen: 1, stueck: 0, offenStueck: 3 }),
  b("c", "Füße vorne", { anfragen: 1, stueck: 0, offenStueck: 9 }),
], [v(1, ["a", "c"])], OPTS);
check("größte Lücke zuerst", s.drucken.map((x) => x.key), ["c", "a"]);

console.log("\n── Dateiarten ──");
check(".gcode.3mf = Druckdatei", dateiArt("E14 Fuss vorne 40x.gcode.3mf"), "DRUCK");
check(".GCODE.3MF groß geschrieben", dateiArt("X.GCODE.3MF"), "DRUCK");
check(".gcode = Druckdatei", dateiArt("platte.gcode"), "DRUCK");
check(".3mf = Projekt", dateiArt("E14 Fuss.3mf"), "PROJEKT");
check(".step = Konstruktion", dateiArt("fuss.step"), "QUELLE");
check(".stl = Konstruktion", dateiArt("fuss.STL"), "QUELLE");
check(".exe abgelehnt", dateiArt("tool.exe"), null);
check(".zip abgelehnt", dateiArt("alles.zip"), null);

console.log("\n── Teiltypen-Text ──");
check("zerlegen", teiltypenAus("Füße vorne|Füße hinten"), ["Füße vorne", "Füße hinten"]);
check("leer", teiltypenAus(null), []);
check("zusammensetzen ohne Doppelte", teiltypenText(["Füße vorne", " Füße vorne ", "Füße hinten", ""]), "Füße vorne|Füße hinten");

console.log("\n── Warteschlange: darf gestartet werden? ──");
const JETZT = new Date("2026-09-24T14:00:00Z");
const lage = (x: Partial<Parameters<typeof darfStarten>[0]> = {}) =>
  darfStarten({ gemeldetAm: new Date(JETZT.getTime() - 3000), verbindung: "verbunden", zustand: "IDLE", platteFrei: true, jetzt: JETZT, ...x });
check("alles bereit → ok", lage().ok, true);
check("nach FINISH mit freier Platte → ok", lage({ zustand: "FINISH" }).ok, true);
check("Platte belegt → wartet", lage({ platteFrei: false }), { ok: false, grund: "Platte noch belegt — am Drucker „Platte ist leer“ drücken" });
check("druckt → wartet", lage({ zustand: "RUNNING" }), { ok: false, grund: "Drucker druckt gerade" });
check("Pause (z. B. 07FF-8012) → wartet", lage({ zustand: "PAUSE" }).ok, false);
check("Brücke 31 s still → aus", lage({ gemeldetAm: new Date(JETZT.getTime() - 31_000) }), { ok: false, grund: "Druckbrücke am Laptop ist aus" });
check("nie gemeldet → aus", lage({ gemeldetAm: null }).ok, false);
check("Brücke ohne Drucker → wartet", lage({ verbindung: "getrennt" }), { ok: false, grund: "Brücke hat keine Verbindung zum Drucker" });
check("unbekannter Zustand → wartet", lage({ zustand: null }), { ok: false, grund: "Drucker ist nicht bereit" });

console.log("\n── Platte: nur der Knopf macht frei ──");
check("Druck läuft → belegt", platteNachBericht(true, "RUNNING"), false);
check("Druck vom Drucker selbst gestartet → auch belegt", platteNachBericht(true, "PREPARE"), false);
check("fertig → bleibt, wie es war (belegt)", platteNachBericht(false, "FINISH"), false);
check("fertig macht NICHT frei", platteNachBericht(false, "IDLE"), false);
check("frei bleibt frei, solange nichts druckt", platteNachBericht(true, "IDLE"), true);

console.log("\n── Hängende Aufträge, fertiger Druck, Material ──");
check("abgeholt vor 6 min → hängt", haengt(new Date(JETZT.getTime() - 6 * 60_000), JETZT), true);
check("abgeholt vor 1 min → läuft noch", haengt(new Date(JETZT.getTime() - 60_000), JETZT), false);
check("fertiger Druck = unser Titel", istDerAuftrag("Dell Latitude 7310", "x.gcode.3mf", "Dell Latitude 7310"), true);
check("fertiger Druck = Dateiname ohne Endung", istDerAuftrag("T", "7310-fuß-vorne.gcode.3mf", "7310-fuß-vorne"), true);
check("anderer Druck (aus Bambu Studio)", istDerAuftrag("Dell Latitude 7310", "a.gcode.3mf", "3DBenchy"), false);
check("PETG vs. PLA → passt nicht", materialPasst("PETG", "PLA"), false);
check("„TPU schwarz“ vs. TPU → passt", materialPasst("TPU schwarz", "TPU"), true);
check("Vorlage ohne Material → keine Aussage", materialPasst("", "PLA"), null);

// ── Kamerabild (Ablage auf dem Server) ─────────────────────────────────────
console.log("\n── Kamera: Nachfrage und letztes Bild ──");
{
  const T = 1_000_000_000_000;
  check("ohne Abruf schaut niemand zu", kameraGewuenscht(T), false);
  kameraAnfordern(T);
  check("nach einem Abruf: Brücke soll liefern", kameraGewuenscht(T + 1000), true);
  check("kurz vor Ablauf noch gewünscht", kameraGewuenscht(T + KAMERA_NACHFRAGE_MS - 1), true);
  check("nach Ablauf nicht mehr (Kamera geht aus)", kameraGewuenscht(T + KAMERA_NACHFRAGE_MS), false);
  const b = Buffer.from([0, 0, 0, 1, 0x67, 1, 2, 3, 4]);
  const n1 = kameraBildSpeichern(b, "avc1.641029", T);
  const n2 = kameraBildSpeichern(b, "avc1.641029", T + 2000);
  check("jedes Bild bekommt eine neue Nummer", n2, n1 + 1);
  check("gespeichert ist nur das letzte", [kameraBild()?.nr, kameraBild()?.am], [n2, T + 2000]);
  check("Codec-Kennung wie aus der SPS", codecGueltig("avc1.641029"), true);
  check("Codec-Kennung: Unsinn abgelehnt", [codecGueltig("vp09.00"), codecGueltig("avc1.64"), codecGueltig(undefined)], [false, false, false]);
  check("H.264 mit 4-Byte-Startcode", siehtAusWieH264(b), true);
  check("H.264 mit 3-Byte-Startcode", siehtAusWieH264(Buffer.from([0, 0, 1, 0x67, 1, 2, 3, 4, 5])), true);
  check("JPEG ist kein H.264", siehtAusWieH264(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0])), false);
}

// ── Kamera-Video (Stufe 2) ─────────────────────────────────────────────────
console.log("\n── Video: Paketform ──");
{
  const h = (n: number) => Buffer.from([0, 0, 0, 1, 0x65, n]);
  const bilder = [{ key: true, ts: 1_790_000_000_123.5, daten: h(1) }, { key: false, ts: 1_790_000_000_156.8, daten: Buffer.from([0, 0, 0, 1, 0x41, 2, 3]) }];
  const paket = packeVideo(bilder);
  const zurueck = entpackeVideo(paket);
  check("packen → entpacken (Server) gleich", zurueck?.map((b) => [b.key, b.ts, [...b.daten]]), bilder.map((b) => [b.key, b.ts, [...b.daten]]));
  const ab = new Uint8Array(paket).buffer;
  check("entpacken im Browser gleich", entpackeVideoPaket(ab)?.map((b) => [b.key, b.ts, [...b.daten]]), bilder.map((b) => [b.key, b.ts, [...b.daten]]));
  check("abgeschnittenes Paket → null (Server)", entpackeVideo(paket.subarray(0, paket.length - 1)), null);
  check("abgeschnittenes Paket → null (Browser)", entpackeVideoPaket(new Uint8Array(paket.subarray(0, paket.length - 1)).buffer), null);
  check("Müll hinten dran → null", entpackeVideo(Buffer.concat([paket, Buffer.from([1])])), null);
  check("leeres Paket", entpackeVideo(packeVideo([])), []);
}

console.log("\n── Video: Puffer ──");
{
  const T = 1_790_000_000_000;
  const b = (key: boolean, ts: number) => ({ key, ts, daten: Buffer.from([0, 0, 0, 1, key ? 0x65 : 0x41, 0]) });
  // Zwei Schlüsselbild-Abstände à 3 Bilder: K d d K d d K d
  const p = leererPuffer();
  fuegeHinzu(p, [b(true, 0), b(false, 33), b(false, 66)], "avc1.641029", T);
  fuegeHinzu(p, [b(true, 100), b(false, 133), b(false, 166)], "avc1.641029", T + 400);
  fuegeHinzu(p, [b(true, 200), b(false, 233)], "avc1.641029", T + 800);
  check("Nummern laufen durch", p.seq, 8);
  check("behalten ab dem VORLETZTEN Schlüsselbild", p.bilder.map((x) => x.seq), [4, 5, 6, 7, 8]);
  check("neuer Zuschauer beginnt beim LETZTEN Schlüsselbild", bilderFuer(p, 0).map((x) => x.seq), [7, 8]);
  check("Zuschauer mit Stand 5 bekommt 6, 7, 8", bilderFuer(p, 5).map((x) => x.seq), [6, 7, 8]);
  check("Zuschauer mit Lücke (Stand 2) → ab Schlüsselbild", bilderFuer(p, 2).map((x) => x.seq), [7, 8]);
  check("Zuschauer ist aktuell → nichts", bilderFuer(p, 8), []);
  check("Zuschauer kennt mehr als der Server (Neustart) → ab Schlüsselbild", bilderFuer(p, 99).map((x) => x.seq), [7, 8]);
  // Lange nichts gekommen → frischer Puffer, sonst spränge der Abspieler über Minuten
  fuegeHinzu(p, [b(true, 90_000)], "avc1.641029", T + 800 + VIDEO_VERALTET_MS + 1);
  check("nach langer Pause nur das Neue", p.bilder.map((x) => x.seq), [9]);
  const leer = leererPuffer();
  fuegeHinzu(leer, [b(false, 1), b(false, 2)], "avc1.641029", T);
  check("ohne Schlüsselbild bekommt niemand etwas", bilderFuer(leer, 0), []);
  check("Video-Nachfrage läuft ab", (() => { videoAnfordern(T); return [videoGewuenscht(T + 1000), videoGewuenscht(T + 31_000)]; })(), [true, false]);
}

console.log("\n── Druckerkarte: Phase und Klartexte ──");
{
  // Echte Meldung vom P2S am 30.09.2026 (Füße-Druck)
  const geplant = [29, 2, 13, 11, 4, 8, 14, 3, 54, 1, 51];
  check("Bett heizt auf = Schritt 2 von 11", phaseVon("PREPARE", "bereitet vor", 2, geplant), { text: "Druckbett heizt auf", schritt: { nr: 2, von: 11 }, druckt: false, pause: false });
  check("druckt (Schritt 0)", phaseVon("RUNNING", "druckt", 0, geplant), { text: "Druckt", schritt: null, druckt: true, pause: false });
  check("unbekannter Schritt wird nicht geraten", phaseVon("RUNNING", "druckt", 99, [99]).text, "Vorbereitung (Schritt 99)");
  check("Leerlauf (255) → Zustandstext", phaseVon("IDLE", "bereit", 255, []).text, "bereit");
  check("fertig → Zustandstext", phaseVon("FINISH", "fertig", 0, geplant), { text: "fertig", schritt: null, druckt: false, pause: false });
  check("Pause beim Drucken → Angehalten", phaseVon("PAUSE", "pausiert", 0, geplant), { text: "Angehalten", schritt: null, druckt: false, pause: true });
  check("Filament leer ist eine Pause", phaseVon("PAUSE", "pausiert", 6, []).pause, true);
  check("Tempo", [tempoText(1), tempoText(2), tempoText(3), tempoText(4), tempoText(7), tempoText(null)], ["Leise", "Standard", "Sport", "Turbo", null, null]);
  check("WLAN -64 dBm = gut (gemessen)", wlanText(-64), "gut");
  check("WLAN Stufen", [wlanText(-50), wlanText(-70), wlanText(-80), wlanText(null)], ["sehr gut", "mäßig", "schwach", null]);
  check("Restzeit", [restText(25), restText(65), restText(120), restText(0), restText(null)], ["25 min", "1 h 05 min", "2 h 00 min", null, null]);
  // 30.09.2026 10:00 Uhr deutsche Zeit = 08:00 UTC
  const jetzt = new Date("2026-09-30T08:00:00Z");
  check("fertig um: heute", fertigUm(112, jetzt), "11:52");
  check("fertig um: morgen", fertigUm(22 * 60, jetzt), "morgen 08:00");
  check("fertig um: später", fertigUm(3 * 24 * 60, jetzt), "03.10. 10:00");
}

console.log("\n── Druckerkarte: Vorschau aus der Druckdatei ──");
{
  const b = (s: string) => Buffer.from(s);
  // Wie Vorlage 4 am 30.09.2026: Platte 2 exportiert, dazu nur das Bild von Platte 1
  const eintraege = [
    { name: "Metadata/plate_1.png", daten: b("P1") },
    { name: "Metadata/top_1.png", daten: b("T1") },
    { name: "Metadata/plate_2.png", daten: b("P2") },
    { name: "Metadata/top_2.png", daten: b("T2") },
    { name: "Metadata/plate_2.gcode", daten: b("G28") },
    { name: "Metadata/slice_info.config", daten: b(`<config><plate><metadata key="index" value="2"/><metadata key="prediction" value="2100"/><metadata key="weight" value="4.84"/></plate></config>`) },
  ];
  const info = plattenAusZip(eintraege);
  check("zwei Platten erkannt", info.platten.map((p) => [p.nr, p.gedruckt]), [[1, false], [2, true]]);
  check("Eckdaten der gedruckten Platte", [info.platten[1]!.gramm, info.platten[1]!.minuten], [4.84, 35]);
  check("Drucker meldet Platte 2 → Platte 2", waehlePlatte(info, 2)?.nr, 2);
  check("ohne Meldung → die mit G-Code, nicht die erste", waehlePlatte(info, null)?.nr, 2);
  check("gemeldete Platte fehlt → die mit G-Code", waehlePlatte(info, 7)?.nr, 2);
  const ohneGewicht = plattenAusZip([{ name: "Metadata/plate_1.gcode", daten: b("x") }, { name: "Metadata/slice_info.config", daten: b(`<plate><metadata key="index" value="1"/><filament id="1" used_g="1.5"/><filament id="2" used_g="0.23"/></plate>`) }]);
  check("ohne weight: Summe der Filamente", ohneGewicht.platten[0]!.gramm, 1.73);
  check("leere Datei → keine Platten", plattenAusZip([]).platten, []);
}

console.log("\n── Video: Bildwahl beim Abspielen ──");
{
  const ts = [1000, 1033, 1066, 1100];
  check("zur Zeit 1050 ist 1033 dran", waehleBild(ts, 1050), 1);
  check("genau auf dem Zeitstempel", waehleBild(ts, 1066), 2);
  check("noch vor dem ersten → keins", waehleBild(ts, 999), -1);
  check("hinter dem letzten → das letzte", waehleBild(ts, 5000), 3);
  check("leere Liste", waehleBild([], 1000), -1);
}

// ── Ergebnis ────────────────────────────────────────────────────────────────
console.log(`\n${failed === 0 ? "✅" : "❌"}  ${passed} bestanden, ${failed} fehlgeschlagen\n`);
process.exit(failed === 0 ? 0 : 1);
