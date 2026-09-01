/**
 * Tests für die Kandidatenregel der Texterkennung (src/lib/ocr/tesseract.ts).
 *
 * Ausführen:  npx tsx tests/ocrKandidat.test.ts   (oder: npm run test:ocr)
 *
 * Alle Zeichenketten hier sind ECHTE Tesseract-Ausgaben vom 21.08.2026, gelesen
 * von vier Teilen aus dem Lager. Die Regel entscheidet, was dem Menschen als
 * Vorschlag angeboten wird — sie darf keine echte Nummer verlieren und keinen
 * Lesemüll durchlassen.
 *
 * Reine Logik, kein Netz, keine Datenbank, kein Tesseract nötig.
 */

import { istNummernKandidat } from "../src/lib/ocr/tesseract";

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

console.log("\n══ ECHTE NUMMERN MÜSSEN DURCH ══");

// Vom HP-Akku, gelesen aus einem 576x768-Vorschaubild.
check("SS03XL (HP-Akku)",           istNummernKandidat("SS03XL"), true);
// Von der Lenovo-Tastatur, zeichengenau gelesen.
check("SN20V43652 (Tastatur)",      istNummernKandidat("SN20V43652"), true);
check("5N20V43724 (FRU Tastatur)",  istNummernKandidat("5N20V43724"), true);
check("CMFNBL-84US (Modell)",       istNummernKandidat("CMFNBL-84US"), true);
// Die Nummern, die Tesseract NICHT las — sie müssen die Regel trotzdem
// bestehen, damit sie beim Abtippen oder über Gemini nicht hängenbleiben.
check("DA0X8JTB8D0 (USB-Board)",    istNummernKandidat("DA0X8JTB8D0"), true);
check("EAX3J004A1S (D-Cover)",      istNummernKandidat("EAX3J004A1S"), true);
check("L20M4P71 (Lenovo-Akku)",     istNummernKandidat("L20M4P71"), true);

console.log("\n══ GEMESSENER LESEMÜLL MUSS RAUS ══");

// ⚠️ Genau diese vier haben die lockere Scan-Regel (ab 5 Zeichen, eine Ziffer)
// bestanden. Hätten sie den Weg zum Menschen gefunden, stünde beim USB-Board
// ein sauber aussehender Vorschlag, hinter dem nichts steckt — und der Rückfall
// auf die Bilderkennung wäre unterblieben.
check("2S01L (USB-Board, zu kurz)",     istNummernKandidat("2S01L"), false);
check("22020 (D-Cover, nur Ziffern)",   istNummernKandidat("22020"), false);
check("383085 (D-Cover, nur Ziffern)",  istNummernKandidat("383085"), false);
check("3ICP6 (HP-Akku, zu kurz)",       istNummernKandidat("3ICP6"), false);
// Reine Ziffernfolgen sind fast nie suchbar — Datumscodes, Kabelaufdrucke.
check("2087510400 (nur Ziffern)",       istNummernKandidat("2087510400"), false);
check("932823 (nur Ziffern)",           istNummernKandidat("932823"), false);
// Wörter ohne Ziffern: der gesamte Rechts- und Werbetext auf Etiketten.
check("COMPUTERES (Wort)",              istNummernKandidat("COMPUTERES"), false);
check("Regulalon (Wort)",               istNummernKandidat("Regulalon"), false);

console.log("\n══ RANDFÄLLE ══");

check("Leerer Text",              istNummernKandidat(""), false);
check("Zu lang (über 20 Zeichen)", istNummernKandidat("8SSN20V43652C3DG1AK01XR"), false);
check("Trennzeichen stören nicht", istNummernKandidat("DA0-X8J-TB8D0"), true);

console.log(`\n══════════════════════════════════════════`);
console.log(`  📊 ${passed} passed  |  ${failed} failed`);
console.log(`══════════════════════════════════════════\n`);

if (failed > 0) process.exit(1);
