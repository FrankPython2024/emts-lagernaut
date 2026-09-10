/**
 * Tests für die Spender-Auswahl „wenigste Wege"
 * (src/lib/teilespender/auswahl.ts).
 *
 * Ausführen:  npx tsx tests/auswahl.test.ts   (oder: npm run test:auswahl)
 *
 * Die Funktion entscheidet, wie oft jemand ins Lager läuft. Zwei Eigenschaften
 * sind wichtiger als Optimalität:
 *   • Sie darf nie in eine Endlosschleife geraten, wenn ein Teil schlicht
 *     nirgends vorhanden ist.
 *   • Sie muss **stabil** sein — zweimal aufgerufen dasselbe Ergebnis, sonst
 *     springen bei jedem Neuladen der Liste die Häkchen.
 *
 * Reine Logik, kein Netz, keine Datenbank.
 */

import { waehleWenigsteWege, abgedeckteTeile, type Abdeckung } from "../src/lib/teilespender/auswahl";

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

console.log("\n── Auswahl treffen ──");

check("nichts gesucht → nichts holen", waehleWenigsteWege([], []), []);
check("nichts vorhanden → nichts holen", waehleWenigsteWege([], ["Tastatur"]), []);

// Der Regelfall: ein Gerät hat alles.
const einesReicht: Abdeckung[] = [
  { logId: "A", deckt: ["Tastatur", "Touchpad", "D Cover"] },
  { logId: "B", deckt: ["Tastatur"] },
];
check(
  "ein Gerät deckt alles → nur eines holen",
  waehleWenigsteWege(einesReicht, ["Tastatur", "Touchpad", "D Cover"]),
  ["A"],
);

// Zwei Wege sind nötig — und mehr auch nicht.
const zweiNoetig: Abdeckung[] = [
  { logId: "A", deckt: ["Tastatur", "Touchpad"] },
  { logId: "B", deckt: ["Tastatur"] },
  { logId: "C", deckt: ["D Cover"] },
];
check(
  "zwei Geräte reichen → kein drittes",
  waehleWenigsteWege(zweiNoetig, ["Tastatur", "Touchpad", "D Cover"]),
  ["A", "C"],
);

// ⚠️ Der gefährliche Fall: ein gesuchtes Teil gibt es nirgends. Ohne Abbruch
// liefe die Schleife ewig und der Browser stünde.
const luecke: Abdeckung[] = [{ logId: "A", deckt: ["Tastatur"] }];
check(
  "unerreichbares Teil bricht sauber ab",
  waehleWenigsteWege(luecke, ["Tastatur", "Mainboard"]),
  ["A"],
);
check(
  "gar nichts Passendes bricht sauber ab",
  waehleWenigsteWege(luecke, ["Mainboard"]),
  [],
);

console.log("\n── Stabilität und Reihenfolge ──");

// Gleichstand: die Reihenfolge der Eingabe entscheidet (sie ist nach Laufweg
// sortiert), damit dasselbe Ergebnis herauskommt wie beim letzten Mal.
const gleichstand: Abdeckung[] = [
  { logId: "vorne", deckt: ["Tastatur"] },
  { logId: "hinten", deckt: ["Tastatur"] },
];
check("bei Gleichstand gewinnt der erste", waehleWenigsteWege(gleichstand, ["Tastatur"]), ["vorne"]);
check(
  "zweiter Aufruf liefert dasselbe",
  waehleWenigsteWege(gleichstand, ["Tastatur"]),
  waehleWenigsteWege(gleichstand, ["Tastatur"]),
);

// Bei gleicher Abdeckung das Gerät ohne Gebrauchsspuren.
const spuren: Abdeckung[] = [
  { logId: "kratzig", deckt: ["D Cover"], mitSpuren: ["D Cover"] },
  { logId: "sauber", deckt: ["D Cover"], mitSpuren: [] },
];
check("weniger Gebrauchsspuren gewinnt", waehleWenigsteWege(spuren, ["D Cover"]), ["sauber"]);

// Aber Abdeckung schlägt Optik: lieber ein kratziges Gerät für zwei Teile als
// zwei Wege für je eines.
const mehrDeckung: Abdeckung[] = [
  { logId: "kratzig-zwei", deckt: ["Tastatur", "Touchpad"], mitSpuren: ["Tastatur", "Touchpad"] },
  { logId: "sauber-eins", deckt: ["Tastatur"], mitSpuren: [] },
];
check(
  "Abdeckung schlägt Gebrauchsspuren",
  waehleWenigsteWege(mehrDeckung, ["Tastatur", "Touchpad"]),
  ["kratzig-zwei"],
);

// Ein Gerät wird nie zweimal genommen.
const doppelt: Abdeckung[] = [{ logId: "A", deckt: ["Tastatur", "Touchpad"] }];
check("kein Gerät doppelt", waehleWenigsteWege(doppelt, ["Tastatur", "Touchpad"]), ["A"]);

// Doppelt genannte Suchbegriffe dürfen nichts durcheinanderbringen.
check(
  "doppelter Suchbegriff ändert nichts",
  waehleWenigsteWege(einesReicht, ["Tastatur", "Tastatur", "Touchpad"]),
  ["A"],
);

console.log("\n── Abdeckung berechnen ──");

check("Abdeckung einer Auswahl", [...abgedeckteTeile(zweiNoetig, ["A", "C"])].sort(), [
  "D Cover",
  "Tastatur",
  "Touchpad",
]);
check("leere Auswahl deckt nichts", [...abgedeckteTeile(zweiNoetig, [])], []);
check("unbekannte Kennung wird ignoriert", [...abgedeckteTeile(zweiNoetig, ["gibtsnicht"])], []);

// ── Ergebnis ────────────────────────────────────────────────────────────────
console.log(`\n${failed === 0 ? "✅" : "❌"}  ${passed} bestanden, ${failed} fehlgeschlagen\n`);
process.exit(failed === 0 ? 0 : 1);
