/**
 * Tests für die Zerlegung des Gerätenamens fürs Karton-Schild
 * (src/lib/geraete/schildName.ts).
 *
 * Ausführen:  npx tsx tests/schildName.test.ts   (oder: npm run test:schild)
 *
 * Die Beispiele sind echte Namen: teils von den bestehenden Regalschildern
 * abgelesen, teils aus dem ReForm-Export vom 07.09.2026.
 *
 * Reine Logik, kein Netz, keine Datenbank.
 */

import { zerlegeGeraetename, istMaschinennummer, schildSchluessel } from "../src/lib/geraete/schildName";

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

function s(name: string, hersteller?: string | null) {
  const r = zerlegeGeraetename(name, hersteller);
  return [r.hersteller, r.serie, r.modell, r.zusatz];
}

// ── Maschinennummern erkennen ───────────────────────────────────────────────
console.log("\n── Maschinennummer erkennen ──");
check("Lenovo 20N5S1M000", istMaschinennummer("20N5S1M000"), true);
check("Lenovo 20QQS0KL00", istMaschinennummer("20QQS0KL00"), true);
check("Lenovo 20W5S2KSDE", istMaschinennummer("20W5S2KSDE"), true);
check("HP-Seriennummer 5CG0326GZ5", istMaschinennummer("5CG0326GZ5"), true);
check("Modellname T14s ist keine", istMaschinennummer("T14s"), false);
check("Generation G7 ist keine", istMaschinennummer("G7"), false);
check("Zahl 5570 ist keine (nur Ziffern)", istMaschinennummer("5570"), false);
check("Wort LATITUDE ist keine (nur Buchstaben)", istMaschinennummer("LATITUDE"), false);
check("kurz EB840G7 ist keine (unter 8)", istMaschinennummer("EB840G7"), false);

// ── Die Schilder von den Fotos ──────────────────────────────────────────────
console.log("\n── Vorhandene Regalschilder ──");
check("Dell Precision 5570",       s("Dell Precision 5570"),          ["Dell", "Precision", "5570", ""]);
check("Dell Latitude 7320 Detachable", s("Dell Latitude 7320 Detachable"), ["Dell", "Latitude", "7320", "Detachable"]);
check("Lenovo ThinkPad T480s",     s("Lenovo ThinkPad T480s"),        ["Lenovo", "ThinkPad", "T480s", ""]);
check("Lenovo ThinkPad T490s",     s("Lenovo ThinkPad T490s"),        ["Lenovo", "ThinkPad", "T490s", ""]);
check("Lenovo ThinkPad T495s",     s("Lenovo ThinkPad T495s"),        ["Lenovo", "ThinkPad", "T495s", ""]);

// ── Namen aus dem echten Export ─────────────────────────────────────────────
console.log("\n── Namen aus dem ReForm-Export ──");
check("ThinkPad T590 mit Maschinennr.", s("Lenovo ThinkPad T590 20N5S1M000"), ["Lenovo", "ThinkPad", "T590", ""]);
check("ThinkPad P53 mit Maschinennr.",  s("Lenovo ThinkPad P53 20QQS0KL00"),  ["Lenovo", "ThinkPad", "P53", ""]);
check("ThinkPad T15 Gen 2i",            s("Lenovo ThinkPad T15 Gen 2i 20W5S2KSDE"), ["Lenovo", "ThinkPad", "T15 Gen 2i", ""]);
check("ThinkPad L580",                  s("Lenovo ThinkPad L580 20LXS81J01"), ["Lenovo", "ThinkPad", "L580", ""]);
check("ThinkPad L15 Gen 1",             s("Lenovo ThinkPad L15 Gen 1 20U3000SGE"), ["Lenovo", "ThinkPad", "L15 Gen 1", ""]);
check("HP ZBook 15 G5",                 s("HP ZBook 15 G5"),                  ["HP", "ZBook", "15 G5", ""]);
check("HP EliteBook 840 G7",            s("HP EliteBook 840 G7"),             ["HP", "EliteBook", "840 G7", ""]);
check("Dell Precision 7530",            s("Dell Precision 7530"),             ["Dell", "Precision", "7530", ""]);

// ── Ohne Hersteller-Präfix (Artikel.bezeichnung) ────────────────────────────
console.log("\n── Ohne Hersteller im Namen ──");
check("EliteBook 840 G5 ohne Präfix", s("EliteBook 840 G5"),             [null, "EliteBook", "840 G5", ""]);
check("Hersteller separat übergeben", s("EliteBook 840 G5", "HP"),       ["HP", "EliteBook", "840 G5", ""]);
check("Hersteller separat, klein",    s("EliteBook 840 G5", "hp"),       ["HP", "EliteBook", "840 G5", ""]);
check("Präfix UND Parameter",         s("HP EliteBook 840 G5", "HP"),    ["HP", "EliteBook", "840 G5", ""]);

// ── Schreibweise wird vereinheitlicht ───────────────────────────────────────
console.log("\n── Schreibweise ──");
check("thinkpad klein → ThinkPad", s("lenovo thinkpad t480s"), ["Lenovo", "ThinkPad", "t480s", ""]);
check("LATITUDE groß → Latitude",  s("DELL LATITUDE 7320"),    ["Dell", "Latitude", "7320", ""]);
check("unbekannte Serie bleibt",   s("Dell Wunderbook 999"),   ["Dell", "Wunderbook", "999", ""]);

// ── Randfälle ───────────────────────────────────────────────────────────────
console.log("\n── Randfälle ──");
check("leerer Name", s(""), [null, "", "", ""]);
check("nur Leerzeichen", s("   "), [null, "", "", ""]);
check("nur Hersteller", s("Dell"), ["Dell", "", "", ""]);
check("ein Wort ohne Hersteller", s("Sonderteil"), [null, "", "Sonderteil", ""]);
check("mehrfache Leerzeichen", s("Dell   Precision   5570"), ["Dell", "Precision", "5570", ""]);
// Bleibt nach dem Streichen der Maschinennummer nur noch ein Begriff übrig,
// wird dieser zur großen Zeile. Die Nummer wäre am Regal wertlos — sie
// beschreibt eine Konfiguration, nicht das Modell.
check("nur Serie + Maschinennr. → Serie wird zur Modellzeile", s("Dell Precision 20N5S1M000"), ["Dell", "", "Precision", ""]);
check("Zusatz allein reisst Modell nicht weg", s("Dell Detachable"), ["Dell", "", "Detachable", ""]);

// ── Erkennungsschlüssel: „ist das dasselbe Schild?" ─────────────────────────
console.log("\n── Erkennungsschlüssel ──");
{
  const a = zerlegeGeraetename("Lenovo ThinkPad T480s");
  const b = zerlegeGeraetename("lenovo   thinkpad   t480s");
  const c = zerlegeGeraetename("Lenovo ThinkPad T480s 20L7S0EX00"); // mit Maschinennr.
  check("gleiches Modell, andere Schreibweise", schildSchluessel(a), schildSchluessel(b));
  check("Maschinennummer ändert nichts",        schildSchluessel(a), schildSchluessel(c));

  const d = zerlegeGeraetename("Lenovo ThinkPad T490s");
  check("anderes Modell → anderer Schlüssel", schildSchluessel(a) === schildSchluessel(d), false);

  const e = zerlegeGeraetename("Dell Latitude 7320");
  const f = zerlegeGeraetename("Dell Latitude 7320 Detachable");
  check("Zusatz macht ein eigenes Schild", schildSchluessel(e) === schildSchluessel(f), false);

  // Das Fach gehört bewusst NICHT in den Schlüssel — ein Umzug macht aus einem
  // Schild kein neues.
  check("Schlüssel ist nur Buchstaben und Ziffern", /^[a-z0-9]*$/.test(schildSchluessel(a)), true);
  check("konkreter Wert", schildSchluessel(a), "lenovothinkpadt480s");
  check("leeres Schild → leerer Schlüssel", schildSchluessel({ hersteller: null, serie: "", modell: "", zusatz: "" }), "");
}

// ── Ergebnis ────────────────────────────────────────────────────────────────
console.log("\n══════════════════════════════════════════");
console.log(`  📊 ${passed} passed  |  ${failed} failed`);
console.log("══════════════════════════════════════════\n");
if (failed > 0) process.exit(1);
