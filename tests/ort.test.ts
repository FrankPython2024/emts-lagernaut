/**
 * Tests für die Ortsauflösung aus zwei Quellen
 * (src/lib/teilespender/ort.ts).
 *
 * Ausführen:  npx tsx tests/ort.test.ts   (oder: npm run test:ort)
 *
 * Hintergrund: Verwertungs-Export und Lagerfuchs führen beide einen Ort je
 * Gerät, importiert in eigenem Rhythmus. Gemessen am 10.09.2026 wichen sie bei
 * 580 von 5.376 Geräten (10,8 %) voneinander ab — bei nur 2 Tagen Abstand.
 *
 * Reine Logik, kein Netz, keine Datenbank.
 */

import { besterOrt, gleicherOrt, ortText } from "../src/lib/teilespender/ort";

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

const ALT = new Date("2026-09-07T06:35:00");
const NEU = new Date("2026-09-09T15:58:00");

const a = (stellplatz: string | null, colli: string | null, standAm: Date) => ({
  stellplatz,
  colli,
  standAm,
});

console.log("\n── Gleichheit ──");

check("gleich", gleicherOrt(a("ETL-1-2-3", "3.186.244", ALT), a("ETL-1-2-3", "3.186.244", NEU)), true);
check("anderes Fach", gleicherOrt(a("ETL-1-2-3", "3.186.244", ALT), a("ETL-9-9-9", "3.186.244", NEU)), false);
check("anderer Karton", gleicherOrt(a("ETL-1-2-3", "3.186.244", ALT), a("ETL-1-2-3", "3.999.999", NEU)), false);
check("Groß-/Kleinschreibung egal", gleicherOrt(a("etl-1-2-3", "x", ALT), a("ETL-1-2-3", "X", NEU)), true);
check("Leerzeichen egal", gleicherOrt(a(" ETL-1-2-3 ", "x", ALT), a("ETL-1-2-3", "x", NEU)), true);

console.log("\n── Welche Quelle gilt? ──");

check("nur Verwertung", besterOrt(a("ETL-1", "111", NEU), null)?.quelle, "VERWERTUNG");
check("nur Lagerfuchs", besterOrt(null, a("HL-2", "222", ALT))?.quelle, "LAGERFUCHS");
check("gar nichts", besterOrt(null, null), null);

check("jüngere gewinnt (Verwertung)", besterOrt(a("ETL-1", "111", NEU), a("HL-2", "222", ALT))?.stellplatz, "ETL-1");
check("jüngere gewinnt (Lagerfuchs)", besterOrt(a("ETL-1", "111", ALT), a("HL-2", "222", NEU))?.stellplatz, "HL-2");
check(
  "jüngere gewinnt — Quelle stimmt",
  besterOrt(a("ETL-1", "111", ALT), a("HL-2", "222", NEU))?.quelle,
  "LAGERFUCHS",
);
// Gleichstand: der Verwertungs-Export ist die Quelle der Spenderliste.
check(
  "bei Gleichstand Verwertung",
  besterOrt(a("ETL-1", "111", NEU), a("HL-2", "222", NEU))?.quelle,
  "VERWERTUNG",
);

console.log("\n── Widerspruch sichtbar machen ──");

const streit = besterOrt(a("ETL-1", "111", NEU), a("HL-2", "222", ALT));
check("Abweichung wird gemeldet", streit?.abweichung?.stellplatz, "HL-2");
check("Abweichung nennt ihre Quelle", streit?.abweichung?.quelle, "LAGERFUCHS");
check(
  "Einigkeit meldet nichts",
  besterOrt(a("ETL-1", "111", NEU), a("ETL-1", "111", ALT))?.abweichung,
  null,
);
// ⚠️ Auch wenn nur EIN Feld abweicht, ist der Ort unsicher — ein Gerät wandert
// beim Umpacken meist samt Karton, aber eben nicht immer.
check(
  "nur Karton abweichend zählt auch",
  besterOrt(a("ETL-1", "111", NEU), a("ETL-1", "999", ALT))?.abweichung?.colli,
  "999",
);

console.log("\n── Leere Angaben ──");

// ⚠️ Ein frischer Import mit leerem Ortsfeld darf eine ältere, brauchbare
// Adresse NICHT verdrängen — sonst steht „—" statt eines Regals.
check(
  "leer verdrängt keine Adresse",
  besterOrt(a(null, null, NEU), a("HL-2", "222", ALT))?.stellplatz,
  "HL-2",
);
check(
  "leer meldet auch keinen Widerspruch",
  besterOrt(a(null, null, NEU), a("HL-2", "222", ALT))?.abweichung,
  null,
);
check("beide leer ergibt nichts", besterOrt(a(null, null, NEU), a("", "", ALT)), null);
// Halbe Angabe ist brauchbar — Colli allein reicht zum Finden.
check("nur Colli ist brauchbar", besterOrt(a(null, "111", NEU), null)?.colli, "111");

console.log("\n── Anzeige ──");

check("beides", ortText({ stellplatz: "ETL-1-2-3", colli: "3.186.244" }), "ETL-1-2-3 · Colli 3.186.244");
check("nur Fach", ortText({ stellplatz: "ETL-1-2-3", colli: null }), "ETL-1-2-3");
check("nur Karton", ortText({ stellplatz: null, colli: "3.186.244" }), "Colli 3.186.244");
check("nichts", ortText({ stellplatz: null, colli: null }), "—");
check("leere Zeichenkette zählt als nichts", ortText({ stellplatz: "  ", colli: "" }), "—");

// ── Ergebnis ────────────────────────────────────────────────────────────────
console.log(`\n${failed === 0 ? "✅" : "❌"}  ${passed} bestanden, ${failed} fehlgeschlagen\n`);
process.exit(failed === 0 ? 0 : 1);
