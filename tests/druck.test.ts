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

// ── Ergebnis ────────────────────────────────────────────────────────────────
console.log(`\n${failed === 0 ? "✅" : "❌"}  ${passed} bestanden, ${failed} fehlgeschlagen\n`);
process.exit(failed === 0 ? 0 : 1);
