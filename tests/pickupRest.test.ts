/**
 * Tests für „Rest in neuen Auftrag übernehmen" (src/lib/pickup/restAuftrag.ts).
 *
 * Ausführen:  npx tsx tests/pickupRest.test.ts   (oder: npm run test:rest)
 *
 * Anlass: Nicht gefundene Geräte wurden als neuer Auftrag angelegt, der alte blieb
 * offen (114 LogIDs doppelt in #168 und #183), und die alten Orte stimmten oft
 * nicht mehr (27 % umgezogen, 34 % inzwischen ausgeschieden).
 *
 * Reine Logik, kein Netz, keine Datenbank.
 */

import { planeRest, restName, type LagerfuchsStand, type RestPosition } from "../src/lib/pickup/restAuftrag";

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

const ANGELEGT = new Date("2026-09-10T08:00:00Z");
const VORHER   = new Date("2026-09-07T06:35:00Z");
const NACHHER  = new Date("2026-09-20T06:35:00Z");

const pos = (logId: string, stellplatz = "HL-07-08-02", colli = "3.189.683"): RestPosition =>
  ({ logId, colli, stellplatz, bezeichnung: "EliteBook 850 G7" });
const stand = (s: Partial<LagerfuchsStand>): LagerfuchsStand =>
  ({ stellplatz: "HL-07-08-02", colli: "3.189.683", zuletztGesehen: NACHHER, ausgeschieden: false, ausgeschiedenAm: null, ...s });

const plan = (positionen: RestPosition[], m: [string, LagerfuchsStand][], ohne = true, ort = true) =>
  planeRest({ positionen, stand: new Map(m), auftragAngelegt: ANGELEGT, ohneAusgeschiedene: ohne, ortAktualisieren: ort });

console.log("\n── Unverändert ──");
const gleich = plan([pos("212000001")], [["212000001", stand({})]]);
check("gleicher Ort → übernommen, nicht umgezogen", [gleich.uebernehmen.length, gleich.umgezogen, gleich.uebernehmen[0]!.ortNeu], [1, 0, false]);
check("Schreibweise egal (Punkte, Groß/Klein)", plan([pos("212000001", "hl-07-08-02", "3189683")], [["212000001", stand({})]]).umgezogen, 0);

console.log("\n── Umgezogen ──");
const um = plan([pos("212000002")], [["212000002", stand({ stellplatz: "HL-06-12-02", colli: "3.200.001" })]]);
check("neuer Ort aus dem Lagerfuchs", [um.umgezogen, um.uebernehmen[0]!.stellplatz, um.uebernehmen[0]!.colli, um.uebernehmen[0]!.ortNeu], [1, "HL-06-12-02", "3.200.001", true]);
const umOhne = plan([pos("212000002")], [["212000002", stand({ stellplatz: "HL-06-12-02" })]], true, false);
check("ohne Ortsaktualisierung: gezählt, alter Ort bleibt", [umOhne.umgezogen, umOhne.uebernehmen[0]!.stellplatz], [1, "HL-07-08-02"]);
const nurColli = plan([pos("212000003")], [["212000003", stand({ colli: "3.999.999" })]]);
check("nur das Colli gewechselt zählt auch", [nurColli.umgezogen, nurColli.uebernehmen[0]!.colli], [1, "3.999.999"]);
const alt = plan([pos("212000004")], [["212000004", stand({ stellplatz: "HL-01-01-01", zuletztGesehen: VORHER })]]);
check("Lagerfuchs ÄLTER als der Auftrag → Auftrag gilt", [alt.umgezogen, alt.uebernehmen[0]!.stellplatz], [0, "HL-07-08-02"]);
const leer = plan([pos("212000005")], [["212000005", stand({ stellplatz: null, colli: null })]]);
check("Lagerfuchs ohne Ort → alter Ort bleibt", [leer.umgezogen, leer.uebernehmen[0]!.stellplatz], [0, "HL-07-08-02"]);

console.log("\n── Ausgeschieden ──");
const weg = plan([pos("212000006")], [["212000006", stand({ ausgeschieden: true, ausgeschiedenAm: NACHHER })]]);
check("nach dem Auftrag ausgeschieden → nicht übernommen", [weg.uebernehmen.length, weg.ausgeschieden.length], [0, 1]);
const wegMit = plan([pos("212000006")], [["212000006", stand({ ausgeschieden: true, ausgeschiedenAm: NACHHER })]], false);
check("auf Wunsch trotzdem übernommen", [wegMit.uebernehmen.length, wegMit.ausgeschieden.length], [1, 1]);
const wegVorher = plan([pos("212000007")], [["212000007", stand({ ausgeschieden: true, ausgeschiedenAm: VORHER, zuletztGesehen: VORHER })]]);
check("VOR dem Auftrag ausgeschieden zählt nicht (Auftrag ist frischer)", [wegVorher.uebernehmen.length, wegVorher.ausgeschieden.length], [1, 0]);
const wegOhneDatum = plan([pos("212000008")], [["212000008", stand({ ausgeschieden: true, ausgeschiedenAm: null, zuletztGesehen: NACHHER })]]);
check("ohne Abgangsdatum: zuletzt gesehen entscheidet", wegOhneDatum.ausgeschieden.length, 1);

console.log("\n── Unbekannt ──");
const unb = plan([pos("212000009")], []);
check("nicht im Lagerfuchs → übernommen, gezählt", [unb.uebernehmen.length, unb.unbekannt], [1, 1]);

console.log("\n── Gemischt ──");
const mix = plan(
  [pos("212000001"), pos("212000002"), pos("212000006"), pos("212000009")],
  [
    ["212000001", stand({})],
    ["212000002", stand({ stellplatz: "HL-06-12-02" })],
    ["212000006", stand({ ausgeschieden: true, ausgeschiedenAm: NACHHER })],
  ],
);
check("Zählung stimmt", [mix.uebernehmen.length, mix.umgezogen, mix.ausgeschieden.length, mix.unbekannt], [3, 1, 1, 1]);

console.log("\n── Name ──");
check("Rest-Name", restName("Richard 179"), "Richard 179 · Rest");
check("kein doppeltes · Rest", restName("Richard 179 · Rest"), "Richard 179 · Rest");
check("höchstens 200 Zeichen", restName("x".repeat(250)).length, 200);

// ── Ergebnis ────────────────────────────────────────────────────────────────
console.log(`\n${failed === 0 ? "✅" : "❌"}  ${passed} bestanden, ${failed} fehlgeschlagen\n`);
process.exit(failed === 0 ? 0 : 1);
