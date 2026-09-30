/**
 * Tests für die 3D-Druck-Druckliste (src/lib/druck/druckliste.ts).
 *
 * Ausführen:  npx tsx tests/druck.test.ts   (oder: npm run test:druck)
 *
 * Reine Logik, kein Netz, keine Datenbank.
 */

import {
  planeDruckliste, dateiArt, teiltypenAus, teiltypenText, verteileBestand,
  type BedarfZeile, type VorlageKurz,
} from "../src/lib/druck/druckliste";
import { darfStarten, darfPlatteFreigeben, platteNachBericht, haengt, istDerAuftrag, materialPasst } from "../src/lib/druck/warteschlange";
import {
  KAMERA_NACHFRAGE_MS, codecGueltig, siehtAusWieH264, kameraAnfordern, kameraGewuenscht, kameraBildSpeichern, kameraBild,
} from "../src/modules/druck/kamera";
import { phaseVon, restText, fertigUm } from "../src/lib/druck/druckerPhase";
import { plattenAusZip, waehlePlatte, NUR_METADATEN } from "../src/modules/druck/vorschau";
import { leseZip, schreibeZip } from "../src/lib/zip/einfach";
import { herstellerVon, passtSuche, gruppiereNachHersteller } from "../src/lib/druck/vorlagenFilter";
import {
  grammFuerDruck, grammJeStueckSchaetzung, monateZwischen, werteAus, GRAMM_JE_STUECK_ERSATZ,
} from "../src/lib/druck/auswertung";

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

console.log("\n── Bestand verteilen: geteilte Artikel und Pool (Audit 30.09.2026) ──");
{
  const art = (id: number, bestand: number, poolPartnerId: number | null = null) => [id, { id, bestand, poolPartnerId }] as const;
  // E14 Gen 2 und Gen 3 teilen sich einen Artikel mit 79 Stück, je 60 Stück Bedarf.
  const e14 = verteileBestand(
    [{ zeile: "gen2", artikelId: 1 }, { zeile: "gen3", artikelId: 1 }],
    new Map([art(1, 79)]),
    () => 60,
  );
  check("geteilter Artikel: nicht zweimal 79", [e14.jeZeile.get("gen2"), e14.jeZeile.get("gen3")], [39, 39]);
  check("… abgerundet: zusammen nie mehr als der echte Bestand", (e14.jeZeile.get("gen2") ?? 0) + (e14.jeZeile.get("gen3") ?? 0) <= 79, true);
  const plan = planeDruckliste(
    [{ key: "gen2", teiltyp: "Füße vorne", name: "E14 Gen 2", anfragen: 20, stueck: 60, offenStueck: 60, bestand: e14.jeZeile.get("gen2")! },
     { key: "gen3", teiltyp: "Füße vorne", name: "E14 Gen 3", anfragen: 20, stueck: 60, offenStueck: 60, bestand: e14.jeZeile.get("gen3")! }],
    [{ id: 9, name: "E14", teiltypen: ["Füße vorne"], modellKeys: ["gen2", "gen3"], stueckProPlatte: 10 }],
    { tage: 90, vorratTage: 30, minAnfragenKonstruieren: 2 },
  );
  check("… damit erscheint die echte Lücke in der Druckliste", plan.drucken.map((z) => [z.key, z.fehlt]), [["gen2", 41], ["gen3", 41]]);

  // Nach Nachfrage: 90 Stück, Gen 2 hat dreimal so viel Bedarf wie Gen 3.
  const gewichtet = verteileBestand(
    [{ zeile: "a", artikelId: 1 }, { zeile: "b", artikelId: 1 }],
    new Map([art(1, 80)]),
    (z) => (z === "a" ? 30 : 10),
  );
  check("nach Nachfrage verteilt", [gewichtet.jeZeile.get("a"), gewichtet.jeZeile.get("b")], [60, 20]);

  // Pool: hinten 0 Stück, vorne 200 Stück desselben Teils.
  const pool = verteileBestand(
    [{ zeile: "hinten", artikelId: 2 }, { zeile: "vorne", artikelId: 3 }],
    new Map([art(2, 0, 3), art(3, 200, 2)]),
    (z) => (z === "hinten" ? 10 : 30),
  );
  check("Pool: hinten bekommt einen Anteil vom gemeinsamen Bestand", [pool.jeZeile.get("hinten"), pool.jeZeile.get("vorne")], [50, 150]);
  check("Pool: eine Gruppe mit 200", [...pool.gruppeBestand.values()], [200]);
  check("Pool: beide Zeilen hängen an derselben Gruppe", [pool.gruppenJeZeile.get("hinten"), pool.gruppenJeZeile.get("vorne")], [[2], [2]]);

  const ohne = verteileBestand([{ zeile: "x", artikelId: 5 }, { zeile: "y", artikelId: 5 }], new Map([art(5, 10)]), () => 0);
  check("ohne Nachfrage zu gleichen Teilen", [ohne.jeZeile.get("x"), ohne.jeZeile.get("y")], [5, 5]);
  const doppelt = verteileBestand([{ zeile: "x", artikelId: 6 }, { zeile: "x", artikelId: 6 }], new Map([art(6, 7)]), () => 1);
  check("zwei Kompatibilitäten desselben Artikels am selben Modell: einmal", doppelt.jeZeile.get("x"), 7);
  const partnerFehlt = verteileBestand([{ zeile: "x", artikelId: 7 }], new Map([art(7, 4, 99)]), () => 1);
  check("Pool-Partner nicht geladen (anderer Standort) → nur eigener Bestand", partnerFehlt.jeZeile.get("x"), 4);
}

console.log("\n── Dateiarten ──");
check(".gcode.3mf = Druckdatei", dateiArt("E14 Fuss vorne 40x.gcode.3mf"), "DRUCK");
check(".GCODE.3MF groß geschrieben", dateiArt("X.GCODE.3MF"), "DRUCK");
check(".gcode allein abgelehnt (Brücke braucht .gcode.3mf)", dateiArt("platte.gcode"), null);
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
check("Druck lief, während die Brücke aus war (FINISH, andere Datei) → belegt", platteNachBericht(true, "FINISH", "Fuss A", "Fuss B"), false);
check("FINISH mit derselben Datei (schon abgeräumt) → bleibt frei", platteNachBericht(true, "FINISH", "Fuss A", "Fuss A"), true);
check("IDLE mit anderer Datei (Neustart) → bleibt frei", platteNachBericht(true, "IDLE", "Fuss A", "Fuss B"), true);
check("ohne vorherige Datei nichts raten", platteNachBericht(true, "FINISH", null, "Fuss B"), true);
{
  const jetzt = new Date("2026-09-30T12:00:00Z");
  const basis = { zustand: "FINISH", uebertragungLaeuft: false, zuletztGestartetAm: null, jetzt };
  check("Platte freigeben: normal erlaubt", darfPlatteFreigeben(basis).ok, true);
  check("Platte freigeben: nicht während einer Übertragung", darfPlatteFreigeben({ ...basis, uebertragungLaeuft: true }).ok, false);
  check("Platte freigeben: nicht direkt nach einem Start", darfPlatteFreigeben({ ...basis, zuletztGestartetAm: new Date(jetzt.getTime() - 30_000) }).ok, false);
  check("Platte freigeben: 3 min nach dem Start wieder", darfPlatteFreigeben({ ...basis, zuletztGestartetAm: new Date(jetzt.getTime() - 180_000) }).ok, true);
  check("Platte freigeben: nicht während des Drucks", darfPlatteFreigeben({ ...basis, zustand: "RUNNING" }).ok, false);
}

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
  check("Restzeit", [restText(25), restText(65), restText(120), restText(0), restText(null)], ["25 min", "1 h 05 min", "2 h 00 min", null, null]);
  // 30.09.2026 10:00 Uhr deutsche Zeit = 08:00 UTC
  const jetzt = new Date("2026-09-30T08:00:00Z");
  check("fertig um: heute", fertigUm(112, jetzt), "11:52");
  check("fertig um: morgen", fertigUm(22 * 60, jetzt), "morgen 08:00");
  check("fertig um: später", fertigUm(3 * 24 * 60, jetzt), "03.10. 10:00");
}

console.log("\n── Druckdatei: nur Metadaten entpacken (Audit 30.09.2026) ──");
{
  const gross = Buffer.alloc(2_000_000, 0x47); // „G-Code" — soll nie entpackt werden
  const zip = schreibeZip([
    { name: "Metadata/plate_1.gcode", daten: gross },
    { name: "Metadata/plate_1.png", daten: Buffer.from("PNG") },
    { name: "Metadata/slice_info.config", daten: Buffer.from('<plate><metadata key="index" value="1"/><metadata key="weight" value="4.8"/></plate>') },
  ]);
  const e = leseZip(zip, { nurDaten: NUR_METADATEN, maxEintrag: 8 * 1024 * 1024 });
  check("G-Code bleibt ungepackt (leer), Name ist da", e.map((x) => [x.name, x.daten.length > 0]), [["Metadata/plate_1.gcode", false], ["Metadata/plate_1.png", true], ["Metadata/slice_info.config", true]]);
  const info = plattenAusZip(e);
  check("Platte trotzdem als gedruckt erkannt, Gewicht gelesen", [info.platten[0]!.gedruckt, info.platten[0]!.gramm], [true, 4.8]);
  let fehler = "";
  try { leseZip(zip, { maxEintrag: 1000 }); } catch (err) { fehler = (err as Error).message; }
  check("Eintrag über dem Deckel → Fehler statt Speicher voll", fehler.includes("zu groß"), true);
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

console.log("\n── Vorlagen-Liste: Hersteller, Suche, Gruppen ──");
{
  check("ausdrücklicher Name", herstellerVon(["HP EliteBook x360 830 G6"]), "HP");
  check("nur Serie (Vorlagenname)", [herstellerVon(["EliteBook 840 G5 Füße"]), herstellerVon(["ThinkPad L13 Gen 1"]), herstellerVon(["Latitude 7310"]), herstellerVon(["LifeBook U7411"]), herstellerVon(["Surface Laptop 4"])], ["HP", "Lenovo", "Dell", "Fujitsu", "Microsoft"]);
  check("Gerät schlägt Vorlagennamen", herstellerVon(["Dell Latitude 7310", "Füße vorne universal"]), "Dell");
  check("unbekannt → Sonstige", herstellerVon(["Kabelhalter", null]), "Sonstige");
  check("„SHPET“ ist kein HP (nur ganzes Wort)", herstellerVon(["SHPET Halter"]), "Sonstige");
  const v = (name: string, anzeige: string[], teiltypen = ["Füße vorne"]) => ({ name, teiltypen, modelle: anzeige.map((a) => ({ anzeige: a })) });
  const e830h = v("HP EliteBook x360 830 G6 Füße hinten", ["HP EliteBook x360 830 G6"], ["Füße hinten"]);
  check("Suche über mehrere Wörter", passtSuche(e830h, "830 hinten"), true);
  check("Suche: Wort fehlt", passtSuche(e830h, "830 vorne"), false);
  check("Suche: ß/ss und Groß/klein egal", [passtSuche(e830h, "FUESSE"), passtSuche(e830h, "füsse")], [false, true]);
  check("leere Suche passt immer", passtSuche(e830h, "  "), true);
  check("Suche im Gerätenamen", passtSuche(v("Dell Latitude 7310", ["Dell Latitude 7310"]), "latitude"), true);
  const gruppen = gruppiereNachHersteller([
    v("HP ProBook x360 435 G8 Füße vorne", ["HP ProBook x360 435 G8"]),
    v("Kabelhalter", []),
    v("Dell Latitude 7310", ["Dell Latitude 7310"]),
    v("HP EliteBook x360 830 G6 Füße hinten", ["HP EliteBook x360 830 G6"]),
  ]);
  check("Gruppen in fester Reihenfolge, Sonstige zuletzt", gruppen.map((g) => [g.hersteller, g.vorlagen.length]), [["Dell", 1], ["HP", 2], ["Sonstige", 1]]);
  check("innen nach Name", gruppen[1]!.vorlagen.map((x) => x.name), ["HP EliteBook x360 830 G6 Füße hinten", "HP ProBook x360 435 G8 Füße vorne"]);
}

console.log("\n── Auswertung: was bringt der Druck ein ──");
{
  check("Gramm: über Stück je Platte (verlässlicher als die Plattenzahl)", grammFuerDruck({ grammJePlatte: 4.84, stueckProPlatte: 5, platten: 1, stueck: 100 }), 96.8);
  check("Gramm: ohne Stück je Platte über die Plattenzahl", grammFuerDruck({ grammJePlatte: 10.64, stueckProPlatte: null, platten: 2, stueck: 10 }), 21.28);
  check("Gramm: Datei ohne Angabe → unbekannt", grammFuerDruck({ grammJePlatte: null, stueckProPlatte: 5, platten: 1, stueck: 5 }), null);
  check("Gramm: weder Platten noch Stück je Platte", grammFuerDruck({ grammJePlatte: 3, stueckProPlatte: null, platten: null, stueck: 5 }), null);

  // Echte Vorlagen 30.09.2026: 11,49 g/5, 4,84 g/5, 4,81 g/5, 1,73 g/1; Vorlage 3 ohne Stück je Platte.
  check("Schätzung = Ø der Vorlagen mit beiden Angaben", grammJeStueckSchaetzung([
    { grammJePlatte: 11.49, stueckProPlatte: 5 }, { grammJePlatte: 10.64, stueckProPlatte: null },
    { grammJePlatte: 4.84, stueckProPlatte: 5 }, { grammJePlatte: 4.81, stueckProPlatte: 5 }, { grammJePlatte: 1.73, stueckProPlatte: 1 },
  ]), 1.49);
  check("Schätzung ohne Vorlagen → Ersatzwert", grammJeStueckSchaetzung([]), GRAMM_JE_STUECK_ERSATZ);

  check("Monate lückenlos über den Jahreswechsel", monateZwischen("2026-11", "2027-02"), ["2026-11", "2026-12", "2027-01", "2027-02"]);
  check("Monate: ein Monat", monateZwischen("2026-09", "2026-09"), ["2026-09"]);

  let id = 0;
  const bw = (artikelId: number, tag: number, typ: "EINGANG" | "AUSGANG" | "DIREKT", menge: number, x: Partial<{ druck: boolean; gramm: number | null; nl: boolean; imZeitraum: boolean }> = {}) => ({
    id: ++id, artikelId, zeit: tag * 86_400_000, typ, menge, druck: x.druck ?? false, gramm: x.gramm ?? null,
    anNiederlassung: x.nl ?? false, monat: tag < 31 ? "2026-08" : "2026-09", imZeitraum: x.imZeitraum ?? true,
  });

  // Fall aus dem Audit: E14 — 370 ohne Kennzeichen, alle ausgegeben, DANACH 280 gedruckt.
  const e14 = werteAus({
    artikel: [{ id: 1, teiltyp: "Füße vorne", preis: 4, bestand: 280 }],
    bewegungen: [bw(1, 1, "EINGANG", 370), bw(1, 10, "AUSGANG", 370), bw(1, 40, "EINGANG", 280, { druck: true, gramm: 400 })],
    grammSchaetzung: 2, euroProKg: 20, bisMonat: "2026-09",
  });
  check("Ausgaben VOR dem ersten Druck haben keinen Druck-Anteil", e14.ausDruck.gesamt, { stueck: 0, wert: 0 });
  check("… und alle 280 liegen als gedruckt im Lager", e14.lagerAusDruck.stueck, 280);
  check("… Ergebnis = nur Material", e14.ergebnis, -8);

  // Gemischter Karton: 100 andere + 100 gedruckt, dann 50 raus → je 25.
  const misch = werteAus({
    artikel: [{ id: 2, teiltyp: "Füße hinten", preis: 4, bestand: 150 }],
    bewegungen: [bw(2, 1, "EINGANG", 100, { druck: false }), bw(2, 2, "EINGANG", 100, { druck: true, gramm: 200 }), bw(2, 35, "AUSGANG", 50)],
    grammSchaetzung: 2, euroProKg: 20, bisMonat: "2026-09",
  });
  check("gemischter Karton: halbe-halbe", misch.ausDruck.gesamt, { stueck: 25, wert: 100 });
  check("gemischter Karton: 75 gedruckte liegen noch", misch.lagerAusDruck, { stueck: 75, wert: 300 });

  const w = werteAus({
    artikel: [
      { id: 1, teiltyp: "Füße vorne", preis: 4, bestand: 150 },   // nur gedruckt
      { id: 2, teiltyp: "Füße vorne", preis: 4, bestand: 200 },   // nie gedruckt
      { id: 3, teiltyp: "Füße hinten", preis: 3, bestand: 80 },   // Spender + Druck, Einzelpreis 3 €
      { id: 4, teiltyp: "Füße hinten", preis: null, bestand: 0 }, // ohne Preis
    ],
    bewegungen: [
      bw(1, 5, "EINGANG", 200, { druck: true }),              // Gramm unbekannt → geschätzt
      bw(1, 35, "AUSGANG", 50),
      bw(1, 36, "DIREKT", 5),                                  // am Lager vorbei
      bw(2, 1, "EINGANG", 300),
      bw(2, 20, "AUSGANG", 100),
      bw(3, 2, "EINGANG", 50),
      bw(3, 32, "EINGANG", 50, { druck: true, gramm: 60 }),
      bw(3, 33, "AUSGANG", 20, { nl: true }),
      bw(4, 32, "EINGANG", 10, { druck: true, gramm: 20 }),
      bw(4, 34, "AUSGANG", 10),
    ],
    grammSchaetzung: 2, euroProKg: 20, bisMonat: "2026-10",
  });
  check("gedruckt: Stück", w.gedruckt.stueck, 260);
  check("gedruckt: Gramm (200×2 geschätzt + 60 + 20)", w.gedruckt.gramm, 480);
  check("gedruckt: Material 0,48 kg × 20 €", w.gedruckt.material, 9.6);
  check("gedruckt: geschätzte Stück", w.gedruckt.geschaetztStueck, 200);
  check("gedruckt: Wert (200×4 + 50×3, ohne Preis 0)", w.gedruckt.wert, 950);
  check("ausgegeben Technik: alle Füße, auch nie gedruckte und DIREKT", w.ausgegeben.technik, { stueck: 165, wert: 620 });
  check("ausgegeben Niederlassungen", w.ausgegeben.niederlassungen, { stueck: 20, wert: 60 });
  check("aus dem Druck Technik: 50 + 10 ohne Preis, DIREKT nie", w.ausDruck.technik, { stueck: 60, wert: 200 });
  check("aus dem Druck Niederlassungen: Hälfte von 20", w.ausDruck.niederlassungen, { stueck: 10, wert: 30 });
  check("Ergebnis = Nutzen aus Druck − Material", w.ergebnis, 220.4);
  check("Lager aus Druck: 150 + Hälfte von 80", w.lagerAusDruck, { stueck: 190, wert: 720 });
  check("ohne Preis gemeldet", w.ohnePreisStueck, 10);
  check("je Teiltyp", w.teiltypen.map((z) => [z.teiltyp, z.gedruckt, z.ausgegeben, z.ausDruck]), [["Füße hinten", 60, 30, 20], ["Füße vorne", 200, 155, 50]]);
  check("Verlauf lückenlos bis heute", w.monate.map((m) => [m.monat, m.gedruckt, m.ausgegeben, m.ausDruck]),
    [["2026-08", 200, 100, 0], ["2026-09", 60, 85, 70], ["2026-10", 0, 0, 0]]);

  // Zeitraum: Druck davor zählt nicht als Kosten, macht den Karton aber trotzdem „gedruckt".
  const zr = werteAus({
    artikel: [{ id: 5, teiltyp: "Füße vorne", preis: 4, bestand: 60 }],
    bewegungen: [bw(5, 1, "EINGANG", 100, { druck: true, gramm: 100, imZeitraum: false }), bw(5, 40, "AUSGANG", 40)],
    grammSchaetzung: 2, euroProKg: 20, vonMonat: "2026-09", bisMonat: "2026-09",
  });
  check("Zeitraum: Material nur für Drucke im Zeitraum", [zr.gedruckt.stueck, zr.gedruckt.material], [0, 0]);
  check("Zeitraum: Ausgabe aus älterem Druck zählt als aus dem Druck", zr.ausDruck.gesamt, { stueck: 40, wert: 160 });

  const leer = werteAus({ artikel: [], bewegungen: [], grammSchaetzung: 2, euroProKg: 20, vonMonat: "2026-09", bisMonat: "2026-09" });
  check("ohne Daten: alles 0, ein Monat", [leer.gedruckt.stueck, leer.ergebnis, leer.monate.length], [0, 0, 1]);
}

// ── Ergebnis ────────────────────────────────────────────────────────────────
console.log(`\n${failed === 0 ? "✅" : "❌"}  ${passed} bestanden, ${failed} fehlgeschlagen\n`);
process.exit(failed === 0 ? 0 : 1);
