/**
 * Tests für bereinigeBezeichnung() und normalisiereHersteller().
 *
 * Ausführen: docker compose exec app npx tsx tests/bezeichnungBereinigen.test.ts
 * Alle Tests müssen grün sein bevor reprocess / import gestartet wird.
 */

import { bereinigeBezeichnung } from "@/lib/geraete/bezeichnungBereinigen";
import { normalisiereHersteller } from "@/lib/geraete/herstellerFilter";

// ── Typ-Definitionen ──────────────────────────────────────────────────────────

type BezTest = [hersteller: string, input: string, expected: string];
type HerTest = [input: string, expected: string | null];

// ── Test-Cases ────────────────────────────────────────────────────────────────

const BEZ_TESTS: BezTest[] = [
  // ───── DELL: Modell-Nummern müssen erhalten bleiben! ─────
  ["Dell", "Precision 7530",               "Precision 7530"],
  ["Dell", "Precision 5480",               "Precision 5480"],
  ["Dell", "Precision M3800",              "Precision M3800"],
  ["Dell", "Latitude 5490",                "Latitude 5490"],
  ["Dell", "Latitude 7490",                "Latitude 7490"],
  ["Dell", "Latitude 5290 2-in-1",         "Latitude 5290 2-in-1"],
  ["Dell", "Inspiron 7506 2in1",           "Inspiron 7506 2in1"],
  ["Dell", "Inspiron 3501",                "Inspiron 3501"],
  ["Dell", "5490",                         "5490"],

  // ───── LENOVO ─────
  ["Lenovo", "ThinkPad T14 Gen 2",         "ThinkPad T14 Gen 2"],
  ["Lenovo", "ThinkPad T14s Gen 1",        "ThinkPad T14s Gen 1"],
  ["Lenovo", "ThinkPad X1 Carbon Gen 9",   "ThinkPad X1 Carbon Gen 9"],
  ["Lenovo", "ThinkPad T14 Gen 2 20W1S06V00", "ThinkPad T14 Gen 2"],

  // ───── HP ─────
  ["HP", "EliteBook 840 G6",               "EliteBook 840 G6"],
  ["HP", "ProBook 650 G4",                 "ProBook 650 G4"],
  ["HP", "ProBook 650 G4 und G5",          "ProBook 650 G4"],

  // ───── PRÄFIXE ENTFERNEN ─────
  ["Dell", "Business-NB Latitude 7490",         "Latitude 7490"],
  ["Dell", "Business-Convertible Latitude 5300", "Latitude 5300"],
  ["Dell", "Business-Laptop Latitude 5400",      "Latitude 5400"],

  // ───── HERSTELLER-DOPPELUNG ENTFERNEN ─────
  ["Dell",   "Dell Precision M3800",       "Precision M3800"],
  ["Lenovo", "Lenovo ThinkPad T14s Gen 1", "ThinkPad T14s Gen 1"],
  ["HP",     "HP EliteBook 840 G6",        "EliteBook 840 G6"],

  // ───── MARKETING-TEXTE ─────
  ["Dell",
    "Business-NB Latitude 7490 (F) - 14\"-FullHD-Displ., matt - Intel Core i7",
    "Latitude 7490"],
  ["Dell",
    "Business-NB Latitude 5500 - Bildschirm 15.6\"-HD-Displ., matt - CPU Intel",
    "Latitude 5500"],

  // ───── KLAMMERN ─────
  ["Dell", "Latitude 7490 (F)",            "Latitude 7490"],
  ["HP",   "EliteBook 840 G6 (A)",         "EliteBook 840 G6"],
];

const HER_TESTS: HerTest[] = [
  ["HP",                              "HP"],
  ["hp",                              "HP"],
  ["HP Compaq",                       "HP"],
  ["HPö",                             "HP"],
  ["HPE (Hewlett Packard Enterprise)", null],
  ["Hewlett Packard Enterprise",       null],
  ["hpe",                              null],
  ["Lenovo",                           "Lenovo"],
  ["LENOVO",                           "Lenovo"],
  ["IBM Lenovo",                       "Lenovo"],
  ["Dell",                             "Dell"],
  ["dell",                             "Dell"],
  ["Fujitsu",                          "Fujitsu"],
  ["FUJITSU",                          "Fujitsu"],
  ["Fujjtsu",                          "Fujitsu"],
  ["Fujitsu Siemens Computers",        "Fujitsu"],
  ["FSC",                              "Fujitsu"],
  ["Apple",                            null],
  ["ASUS",                             null],
  ["Acer",                             null],
  ["MSI",                              null],
  ["Toshiba",                          null],
  ["Samsung",                          null],
  ["",                                 null],
];

// ── Test-Runner ───────────────────────────────────────────────────────────────

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

console.log("\n══════════════════════════════════════════");
console.log("  BEZEICHNUNG-TESTS");
console.log("══════════════════════════════════════════");
for (const [hersteller, input, expected] of BEZ_TESTS) {
  const actual = bereinigeBezeichnung(hersteller, input);
  check(`bereinigeBezeichnung("${hersteller}", "${input}")`, actual, expected);
}

console.log("\n══════════════════════════════════════════");
console.log("  HERSTELLER-TESTS");
console.log("══════════════════════════════════════════");
for (const [input, expected] of HER_TESTS) {
  const actual = normalisiereHersteller(input);
  check(`normalisiereHersteller("${input}")`, actual, expected);
}

console.log("\n══════════════════════════════════════════");
console.log(`  📊 ${passed} passed  |  ${failed} failed`);
console.log("══════════════════════════════════════════\n");

if (failed > 0) process.exit(1);
