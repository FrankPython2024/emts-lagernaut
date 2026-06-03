/**
 * Verifikation für Import-Sandbox Schritt A (verhaltenserhaltendes Refactoring).
 *
 * Prüft per assert, dass bereinigeBezeichnung() weiterhin exakt die erwarteten
 * Modell-Namen liefert, dass der Trace dasselbe `result` ergibt und dass das
 * Sicherheitsnetz greift. Zusätzlich: regel-Feld von checkHersteller.
 *
 * Ausführen: npx tsx scripts/verifyImportSandboxA.ts
 */

import assert from "node:assert/strict";
import {
  bereinigeBezeichnung,
  bereinigeBezeichnungTrace,
} from "@/lib/geraete/bezeichnungBereinigen";
import { checkHersteller } from "@/lib/geraete/herstellerFilter";

let geprueft = 0;

function eq(label: string, actual: unknown, expected: unknown): void {
  assert.deepStrictEqual(actual, expected, `${label} → erwartet ${JSON.stringify(expected)}, bekam ${JSON.stringify(actual)}`);
  geprueft++;
  console.log(`  ✅ ${label} = ${JSON.stringify(actual)}`);
}

console.log("\n══════════════════════════════════════════");
console.log("  IMPORT-SANDBOX A — VERIFIKATION");
console.log("══════════════════════════════════════════\n");

// ── Bereinigung: erwartete Ergebnisse ──────────────────────────────────────
const FAELLE: [hersteller: string, input: string, erwartet: string][] = [
  ["Dell",   "7530",                               "7530"],           // Modell-Nr bleibt
  ["Lenovo", "T14s",                               "T14s"],           // bleibt
  ["Dell",   "M3800",                              "M3800"],          // bleibt (NICHT entfernt)
  ["Lenovo", "ThinkPad T14 Gen 2i 20W1S06V00",     "ThinkPad T14 Gen 2i"],
  ["Dell",   'Latitude 7490 (F) - 14"-FullHD-Displ.', "Latitude 7490"],
  ["HP",     "ProBook 650 G4 und G5",              "ProBook 650 G4"],
  ["Dell",   "Dell Precision M3800",               "Precision M3800"],
  ["HP",     "Notebook Pc HP EliteBook 840 G5",    "EliteBook 840 G5"],
  ["HP",     "",                                    ""],              // leer → leer
];

console.log("• bereinigeBezeichnung()");
for (const [h, input, erwartet] of FAELLE) {
  eq(`bereinigeBezeichnung("${h}", "${input}")`, bereinigeBezeichnung(h, input), erwartet);
  // Trace liefert dasselbe result (Single Source of Truth)
  assert.strictEqual(
    bereinigeBezeichnungTrace(h, input).result,
    bereinigeBezeichnung(h, input),
    `Trace-result weicht ab für "${h}"/"${input}"`,
  );
}

// ── Sicherheitsnetz greift bei zu kurzem Ergebnis ───────────────────────────
console.log("\n• Sicherheitsnetz (zu kurz → Original)");
{
  const trace = bereinigeBezeichnungTrace("HP", "HP X"); // → "X" (1 Zeichen) → Netz greift
  eq('bereinigeBezeichnung("HP", "HP X")', bereinigeBezeichnung("HP", "HP X"), "HP X");
  eq("sicherheitsnetzGegriffen", trace.sicherheitsnetzGegriffen, true);
  // 8 Schritte werden immer protokolliert (inkl. "Führende Sonderzeichen entfernen")
  eq("schritte.length", trace.schritte.length, 8);
}

// ── checkHersteller: additives regel-Feld (Verhalten unverändert) ───────────
console.log("\n• checkHersteller().regel (additiv)");
eq('checkHersteller("").regel',          checkHersteller("").regel,                 "leer");
eq('checkHersteller("Dell").regel',      checkHersteller("Dell").regel,             "whitelist");
eq('checkHersteller("FSC").regel',       checkHersteller("FSC").regel,              "typo");
eq('checkHersteller("Apple").regel',     checkHersteller("Apple").regel,            "blocklist");
eq('checkHersteller("Samsung").regel',   checkHersteller("Samsung").regel,          "unbekannt");
eq('Apple-Indikator regel',              checkHersteller("Dell", "MacBook Pro").regel, "apple");
// erlaubt/kanonisch bleiben unverändert
eq('checkHersteller("Dell").kanonisch',  checkHersteller("Dell").kanonisch,         "Dell");
eq('checkHersteller("Apple").erlaubt',   checkHersteller("Apple").erlaubt,          false);

console.log("\n══════════════════════════════════════════");
console.log(`  📊 ${geprueft} Prüfungen — ALLE bestanden ✅`);
console.log("══════════════════════════════════════════\n");
