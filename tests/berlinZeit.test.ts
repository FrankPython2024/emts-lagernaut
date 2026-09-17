/**
 * Tests für die Zeitrechnung in deutscher Zeit (src/lib/zeit/berlin.ts).
 *
 * Ausführen:  npx tsx tests/berlinZeit.test.ts   (oder: npm run test:zeit)
 *
 * Reine Logik, kein Netz, keine Datenbank. Die Tests setzen die Zeitpunkte als
 * UTC-Zeichenketten — der Rechner, auf dem sie laufen, darf also in jeder
 * Zeitzone stehen (das ist der Sinn der Sache).
 */

import {
  berlinTag, berlinStunde, berlinWochentag, berlinMonat,
  berlinMitternacht, berlinMonatsbeginn, zeitraum, isoKalenderwoche, addiereTage,
} from "../src/lib/zeit/berlin";

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

const utc = (s: string) => new Date(s);

console.log("\n── Stunde ──");
// Der Fehler, der auffiel: 05:30 UTC ist in Sömmerda 07:30.
check("Sommer: 05:30 UTC → 7 Uhr", berlinStunde(utc("2026-09-17T05:30:00Z")), 7);
check("Winter: 06:30 UTC → 7 Uhr", berlinStunde(utc("2026-01-15T06:30:00Z")), 7);
check("Mitternacht Ortszeit → 0", berlinStunde(utc("2026-09-16T22:00:00Z")), 0);

console.log("\n── Kalendertag ──");
check("22:30 UTC im Sommer ist schon der nächste Tag", berlinTag(utc("2026-09-16T22:30:00Z")), "2026-09-17");
check("21:59 UTC im Sommer ist noch derselbe Tag", berlinTag(utc("2026-09-16T21:59:00Z")), "2026-09-16");
check("23:30 UTC im Winter ist schon der nächste Tag", berlinTag(utc("2026-01-14T23:30:00Z")), "2026-01-15");
check("Silvester 23:30 UTC ist Neujahr", berlinTag(utc("2026-12-31T23:30:00Z")), "2027-01-01");

console.log("\n── Wochentag ──");
check("17.09.2026 ist Donnerstag (4)", berlinWochentag(utc("2026-09-17T10:00:00Z")), 4);
check("So 22:30 UTC ist schon Montag (1)", berlinWochentag(utc("2026-09-20T22:30:00Z")), 1);

console.log("\n── Monat ──");
check("30.09. 22:30 UTC gehört schon zum Oktober", berlinMonat(utc("2026-09-30T22:30:00Z")), { jahr: 2026, monat: 10 });
check("Monatsbeginn Oktober = 30.09. 22:00 UTC", berlinMonatsbeginn(2026, 10).toISOString(), "2026-09-30T22:00:00.000Z");
check("Monatsbeginn Januar = 31.12. 23:00 UTC", berlinMonatsbeginn(2027, 1).toISOString(), "2026-12-31T23:00:00.000Z");
check("Monat 13 = Januar des Folgejahrs", berlinMonatsbeginn(2026, 13).toISOString(), "2026-12-31T23:00:00.000Z");

console.log("\n── Mitternacht ──");
check("Sommertag beginnt 22:00 UTC", berlinMitternacht("2026-09-17").toISOString(), "2026-09-16T22:00:00.000Z");
check("Wintertag beginnt 23:00 UTC", berlinMitternacht("2026-01-15").toISOString(), "2026-01-14T23:00:00.000Z");
check("Tag der Umstellung auf Sommerzeit", berlinMitternacht("2026-03-29").toISOString(), "2026-03-28T23:00:00.000Z");
check("Tag der Umstellung auf Winterzeit", berlinMitternacht("2026-10-25").toISOString(), "2026-10-24T22:00:00.000Z");
check("Tag nach der Umstellung auf Winterzeit", berlinMitternacht("2026-10-26").toISOString(), "2026-10-25T23:00:00.000Z");
check("Schalttag", berlinMitternacht("2028-02-29").toISOString(), "2028-02-28T23:00:00.000Z");

console.log("\n── Tage verschieben ──");
check("über Monatsende", addiereTage("2026-09-30", 1), "2026-10-01");
check("rückwärts über Jahreswechsel", addiereTage("2027-01-02", -3), "2026-12-30");

console.log("\n── Zeitraum: letzte N Tage ──");
const JETZT = utc("2026-09-17T10:00:00Z"); // Donnerstag, 12:00 Ortszeit
const z7 = zeitraum(7, JETZT);
check("7 Tage = 7 Einträge", z7.tage.length, 7);
check("7 Tage enden HEUTE", z7.tage[6], "2026-09-17");
check("7 Tage beginnen am Freitag davor", z7.tage[0], "2026-09-11");
check("Beginn um 00:00 Ortszeit", z7.von.toISOString(), "2026-09-10T22:00:00.000Z");
check("1 Tag = nur heute", zeitraum(1, JETZT).tage, ["2026-09-17"]);
check("1 Tag beginnt heute 00:00 Ortszeit", zeitraum(1, JETZT).von.toISOString(), "2026-09-16T22:00:00.000Z");
// Kurz nach Mitternacht Ortszeit, aber noch „gestern" in UTC — der alte Fehler.
const NACHT = utc("2026-09-16T22:30:00Z"); // 17.09. 00:30 Ortszeit
check("kurz nach Mitternacht zählt schon der neue Tag", zeitraum(1, NACHT).tage, ["2026-09-17"]);
check("365 Tage = 365 Einträge", zeitraum(365, JETZT).tage.length, 365);
check("über die Zeitumstellung hinweg lückenlos", zeitraum(3, utc("2026-10-26T12:00:00Z")).tage, ["2026-10-24", "2026-10-25", "2026-10-26"]);

console.log("\n── ISO-Kalenderwoche ──");
check("17.09.2026 = KW 38", isoKalenderwoche("2026-09-17"), { jahr: 2026, kw: 38 });
check("01.01.2026 (Donnerstag) = KW 1/2026", isoKalenderwoche("2026-01-01"), { jahr: 2026, kw: 1 });
check("29.12.2025 (Montag) = KW 1/2026", isoKalenderwoche("2025-12-29"), { jahr: 2026, kw: 1 });
// Genau hier lag die alte Rechnung um eins daneben.
check("01.01.2027 (Freitag) = KW 53/2026", isoKalenderwoche("2027-01-01"), { jahr: 2026, kw: 53 });
check("04.01.2027 (Montag) = KW 1/2027", isoKalenderwoche("2027-01-04"), { jahr: 2027, kw: 1 });

// ── Ergebnis ────────────────────────────────────────────────────────────────
console.log(`\n${failed === 0 ? "✅" : "❌"}  ${passed} bestanden, ${failed} fehlgeschlagen\n`);
process.exit(failed === 0 ? 0 : 1);
