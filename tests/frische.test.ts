/**
 * Tests für die Frische-Bewertung der Spender-Daten
 * (src/lib/teilespender/frische.ts).
 *
 * Ausführen:  npx tsx tests/frische.test.ts   (oder: npm run test:frische)
 *
 * Reine Logik, kein Netz, keine Datenbank.
 */

import {
  bewerteFrische,
  tageSeit,
  FRISCH_TAGE,
  ALT_TAGE,
} from "../src/lib/teilespender/frische";

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

/** Fester Bezugspunkt, damit die Tests nicht von der echten Uhr abhängen. */
const JETZT = new Date("2026-09-10T12:00:00");
const vorTagen = (n: number) => new Date(JETZT.getTime() - n * 86_400_000);

console.log("\n── Tage zählen ──");

check("heute = 0 Tage", tageSeit(JETZT, JETZT), 0);
check("gestern = 1 Tag", tageSeit(vorTagen(1), JETZT), 1);
check("angebrochener Tag zählt nicht mit", tageSeit(new Date("2026-09-09T18:00:00"), JETZT), 0);
// ⚠️ Ein Import in der Zukunft (Zeitzone, falsch gestellte Uhr) darf keine
// negative Zahl liefern — „vor -3 Tagen" wäre im UI schlicht kaputt.
check("Zukunft ergibt nie negativ", tageSeit(vorTagen(-5), JETZT), 0);

console.log("\n── Bewertung ──");

check("ohne Import", bewerteFrische(null, JETZT).stufe, "OHNE_DATEN");
check("ohne Import wird gewarnt", bewerteFrische(null, JETZT).warnen, true);
check("ohne Import kein Alter", bewerteFrische(null, JETZT).tage, null);

check("heute ist frisch", bewerteFrische(JETZT, JETZT).stufe, "FRISCH");
check("frisch warnt nicht", bewerteFrische(JETZT, JETZT).warnen, false);
check("Grenze frisch", bewerteFrische(vorTagen(FRISCH_TAGE), JETZT).stufe, "FRISCH");
check("einen Tag darüber", bewerteFrische(vorTagen(FRISCH_TAGE + 1), JETZT).stufe, "ALTERND");
check("alternd warnt", bewerteFrische(vorTagen(FRISCH_TAGE + 1), JETZT).warnen, true);
check("Grenze alternd", bewerteFrische(vorTagen(ALT_TAGE), JETZT).stufe, "ALTERND");
check("einen Tag darüber ist alt", bewerteFrische(vorTagen(ALT_TAGE + 1), JETZT).stufe, "ALT");

console.log("\n── Formulierung ──");

check("heute", bewerteFrische(JETZT, JETZT).text, "Daten vom Stand heute.");
check("gestern", bewerteFrische(vorTagen(1), JETZT).text, "Daten vom Stand gestern.");
check("mehrere Tage", bewerteFrische(vorTagen(3), JETZT).text, "Daten vom Stand vor 3 Tagen.");
// Der Warntext muss sagen, was zu tun ist — nicht nur, dass etwas ist.
check(
  "alter Text nennt die Handlung",
  bewerteFrische(vorTagen(40), JETZT).text.includes("neu einlesen"),
  true,
);
check("alter Text nennt die Zahl", bewerteFrische(vorTagen(40), JETZT).text.includes("40 Tage"), true);

// ── Ergebnis ────────────────────────────────────────────────────────────────
console.log(`\n${failed === 0 ? "✅" : "❌"}  ${passed} bestanden, ${failed} fehlgeschlagen\n`);
process.exit(failed === 0 ? 0 : 1);
