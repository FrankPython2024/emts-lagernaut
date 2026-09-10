/**
 * Tests für die Engpass-Rechnung
 * (src/lib/teilespender/bedarf.ts).
 *
 * Ausführen:  npx tsx tests/bedarf.test.ts   (oder: npm run test:bedarf)
 *
 * Anlass: Zwei Anfragen für ein ThinkPad P17 Gen 1 brauchten beide einen Akku,
 * und beide Zeilen meldeten „1 Verwertungsgerät mit diesem Teil" — dasselbe.
 *
 * Reine Logik, kein Netz, keine Datenbank.
 */

import { bewerteDeckung, warntDeckung, verteileSpender } from "../src/lib/teilespender/bedarf";

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

console.log("\n── Der Normalfall schweigt ──");

// Eine Anfrage, ein Gerät — daran ist nichts zu melden.
check("1 Gerät für 1 Anfrage", warntDeckung(bewerteDeckung(1, 1)), false);
check("viele Geräte für 1 Anfrage", warntDeckung(bewerteDeckung(28, 1)), false);
check("Reserve vorhanden", warntDeckung(bewerteDeckung(5, 2)), false);
// Kein Gerät und nur eine Anfrage: Die Zeile erscheint ohnehin nicht.
check("nichts da, eine Anfrage", warntDeckung(bewerteDeckung(0, 1)), false);

console.log("\n── Der gemeldete Fall ──");

const p17 = bewerteDeckung(1, 2);
check("reicht nicht", p17.reicht, false);
check("wird gemeldet", warntDeckung(p17), true);
check(
  "Text nennt beide Zahlen",
  p17.text,
  "Nur 1 Gerät für 2 offene Anfragen — reicht nicht für alle.",
);
check("Mehrzahl bei mehreren Geräten", bewerteDeckung(2, 5).text, "Nur 2 Geräte für 5 offene Anfragen — reicht nicht für alle.");
check("gar kein Gerät", bewerteDeckung(0, 3).text, "3 offene Anfragen brauchen dieses Teil — kein Gerät gefunden.");

console.log("\n── Geht genau auf ──");

const knapp = bewerteDeckung(2, 2);
check("reicht", knapp.reicht, true);
check("aber knapp", knapp.knapp, true);
check("wird trotzdem gemeldet", warntDeckung(knapp), true);
check("Text", knapp.text, "2 Geräte für 2 offene Anfragen — genau ausreichend, keine Reserve.");
// ⚠️ Bei genau EINER Anfrage ist ein einziges Gerät der Normalfall — sonst
// stünde an fast jeder Zeile eine Warnung und niemand liest sie mehr.
check("ein Gerät für eine Anfrage ist nicht knapp", bewerteDeckung(1, 1).knapp, false);

console.log("\n── Robustheit ──");

check("negative Zahlen werden abgefangen", bewerteDeckung(-3, -1).spender, 0);
check("Kommazahlen werden abgeschnitten", bewerteDeckung(2.9, 1.2).spender, 2);
check("kein Bedarf, keine Meldung", warntDeckung(bewerteDeckung(4, 0)), false);
check("alles null", warntDeckung(bewerteDeckung(0, 0)), false);

console.log("\n── Zuteilung bei Knappheit ──");

check("nichts zu verteilen", [...verteileSpender([], ["A"]).entries()], []);
check("keine Geraete", [...verteileSpender([1, 2], []).values()], [[], []]);

// Genug fuer alle → jeder sieht alles. Wer auswaehlt, greift ohnehin zu
// verschiedenen; eine Zuteilung wuerde hier nur Auswahl wegnehmen.
check(
  "Ueberfluss: jeder sieht alle",
  [...verteileSpender([1, 2], ["A", "B", "C"]).values()],
  [["A", "B", "C"], ["A", "B", "C"]],
);
check(
  "genau aufgehend: jeder sieht alle",
  [...verteileSpender([1, 2], ["A", "B"]).values()],
  [["A", "B"], ["A", "B"]],
);

// ⚠️ Der gemeldete Fall: 3 Anfragen, 1 Geraet.
check(
  "Knappheit: nur die aelteste bekommt es",
  [...verteileSpender([27172, 27173, 27174], ["A"]).values()],
  [["A"], [], []],
);
check(
  "Knappheit: zwei Geraete auf drei Anfragen",
  [...verteileSpender([1, 2, 3], ["A", "B"]).values()],
  [["A"], ["B"], []],
);
// Stabilitaet: zweimal aufgerufen dasselbe — sonst springt die Zuteilung bei
// jedem Neuladen der Liste.
check(
  "zweiter Aufruf liefert dasselbe",
  [...verteileSpender([1, 2, 3], ["A"]).values()],
  [...verteileSpender([1, 2, 3], ["A"]).values()],
);

// ── Ergebnis ────────────────────────────────────────────────────────────────
console.log(`\n${failed === 0 ? "✅" : "❌"}  ${passed} bestanden, ${failed} fehlgeschlagen\n`);
process.exit(failed === 0 ? 0 : 1);
