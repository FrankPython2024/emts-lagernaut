/**
 * Tests für Engpass-Rechnung und Zuteilung
 * (src/lib/teilespender/bedarf.ts).
 *
 * Ausführen:  npx tsx tests/bedarf.test.ts   (oder: npm run test:bedarf)
 *
 * Anlass: Drei Anfragen für einen ThinkPad-P17-Akku, ein einziges Spendergerät —
 * und alle drei Zeilen priesen dasselbe Gerät an.
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

check("1 Gerät für 1 Anfrage", warntDeckung(bewerteDeckung(1, 1)), false);
check("viele Geräte für 1 Anfrage", warntDeckung(bewerteDeckung(28, 1)), false);
check("Reserve vorhanden", warntDeckung(bewerteDeckung(5, 2)), false);
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
check(
  "Mehrzahl bei mehreren Geräten",
  bewerteDeckung(2, 5).text,
  "Nur 2 Geräte für 5 offene Anfragen — reicht nicht für alle.",
);
check(
  "gar kein Gerät",
  bewerteDeckung(0, 3).text,
  "3 offene Anfragen brauchen dieses Teil — kein Gerät gefunden.",
);

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

// ── Zuteilung ───────────────────────────────────────────────────────────────
console.log("\n── Zuteilung bei Knappheit ──");

/** Kurzschreibweise: Anfrage-Id mit ihren eigenen Kandidaten. */
const b = (id: number, ...kandidaten: string[]) => ({ id, kandidaten });
const idOf = (k: string) => k;

check("nichts zu verteilen", [...verteileSpender([], idOf).entries()], []);
check("keine Geräte", [...verteileSpender([b(1), b(2)], idOf).values()], [[], []]);

// Genug für alle → jede Anfrage behält ihre Liste. Wer auswählt, greift ohnehin
// zu verschiedenen; eine Zuteilung würde hier nur Auswahl wegnehmen.
check(
  "Überfluss: jede behält ihre Liste",
  [...verteileSpender([b(1, "A", "B", "C"), b(2, "A", "B", "C")], idOf).values()],
  [["A", "B", "C"], ["A", "B", "C"]],
);
// ⚠️ Genau aufgehend ist NICHT dasselbe wie Überschuss: Wer hier beiden alles
// zeigt, riskiert, dass der eine dem anderen das letzte Gerät wegnimmt.
check(
  "genau aufgehend: wird zugeteilt",
  [...verteileSpender([b(1, "A", "B"), b(2, "A", "B")], idOf).values()],
  [["A"], ["B"]],
);

// ⚠️ Der gemeldete Fall: 3 Anfragen, 1 Gerät.
check(
  "Knappheit: nur die älteste bekommt es",
  [...verteileSpender([b(27172, "A"), b(27173, "A"), b(27174, "A")], idOf).values()],
  [["A"], [], []],
);
check(
  "Knappheit: zwei Geräte auf drei Anfragen",
  [...verteileSpender([b(1, "A", "B"), b(2, "A", "B"), b(3, "A", "B")], idOf).values()],
  [["A"], ["B"], []],
);

// ⚠️ Der Fehler, der die Umstellung ausgelöst hat: Steht das Zielgerät einer
// Anfrage selbst im Spenderbestand, fehlt es in DEREN Liste und ist für die
// andere trotzdem da. Wer je Anfrage gegen die eigene Liste rechnet, kommt zu
// zwei Ergebnissen, die dasselbe Gerät zusagen.
const zut = verteileSpender([b(1, "D2"), b(2, "D1", "D2")], idOf);
check("A bekommt D2", zut.get(1), ["D2"]);
check("B bekommt NICHT auch D2", zut.get(2), ["D1"]);

// Allgemein: kein Gerät darf zweimal vergeben werden.
const doppelt = verteileSpender([b(1, "A", "B"), b(2, "A"), b(3, "A", "B")], idOf);
const vergeben = [...doppelt.values()].flat();
check("ein Gerät nie doppelt vergeben", vergeben.length, new Set(vergeben).size);

// Wer nur ein bereits vergebenes Gerät hätte, geht leer aus — nicht doppelt.
check(
  "leer statt Doppelvergabe",
  [...verteileSpender([b(1, "A"), b(2, "A"), b(3, "B")], idOf).values()],
  [["A"], [], ["B"]],
);

// Stabilität: zweimal aufgerufen dasselbe — sonst springt die Zuteilung bei
// jedem Neuladen der Liste.
check(
  "zweiter Aufruf liefert dasselbe",
  [...verteileSpender([b(1, "A"), b(2, "A"), b(3, "A")], idOf).values()],
  [...verteileSpender([b(1, "A"), b(2, "A"), b(3, "A")], idOf).values()],
);

// ── Ergebnis ────────────────────────────────────────────────────────────────
console.log(`\n${failed === 0 ? "✅" : "❌"}  ${passed} bestanden, ${failed} fehlgeschlagen\n`);
process.exit(failed === 0 ? 0 : 1);
