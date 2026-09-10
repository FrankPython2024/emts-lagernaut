/**
 * Tests für die Defekt-Zuordnung des Verwertungs-Exports
 * (src/lib/teilespender/defekte.ts).
 *
 * Ausführen:  npx tsx tests/defekte.test.ts   (oder: npm run test:defekte)
 *
 * Alle Beispiele sind echte Werte aus dem ReForm-Export vom 09.09.2026
 * (7.357 Geräte, 53 verschiedene Begriffe im Feld `Defekte`).
 *
 * Der wichtigste Test steht ganz unten: **jeder Teiltyp-Name muss es wirklich
 * geben.** Ein Tippfehler dort wirft keine Fehlermeldung — er macht die Suche
 * still leer, und niemand merkt, dass 97 Tastaturen im Haus liegen.
 *
 * Reine Logik, kein Netz, keine Datenbank.
 */

import {
  DEFEKT_REGELN,
  zerlegeDefekte,
  bewerte,
  istTotalschaden,
  zustandFuerTeiltyp,
  harteDefektTeiltypen,
} from "../src/lib/teilespender/defekte";
import { STANDARD_TEILNAMEN } from "../src/lib/constants/teiltypen";

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

// ── Zerlegen ────────────────────────────────────────────────────────────────
console.log("\n── Feld `Defekte` zerlegen ──");

check("leer", zerlegeDefekte(""), []);
check("null", zerlegeDefekte(null), []);
check("einzeln", zerlegeDefekte("Akku defekt"), ["Akku defekt"]);
check("zwei Begriffe", zerlegeDefekte("Akku defekt, Tastatur fehlt"), [
  "Akku defekt",
  "Tastatur fehlt",
]);
check(
  "echter Datensatz mit Klammer",
  zerlegeDefekte("Gehäuse beschädigt (Kratzer/Dellen), Bios PW, RAM nicht vorhanden"),
  ["Gehäuse beschädigt (Kratzer/Dellen)", "Bios PW", "RAM nicht vorhanden"],
);
check("Komma-Rest ohne Inhalt fällt weg", zerlegeDefekte("Akku defekt,  ,Bios PW"), [
  "Akku defekt",
  "Bios PW",
]);

// ── Einzelbegriffe bewerten ─────────────────────────────────────────────────
console.log("\n── Begriffe bewerten ──");

check("Akku defekt → Akku", bewerte("Akku defekt").teiltypen, ["Akku"]);
check("Akku defekt → hart", bewerte("Akku defekt").schwere, "HART");
check("Bios PW betrifft kein Bauteil", bewerte("Bios PW").schwere, "KEIN_TEIL");
check("Bios PW ist bekannt", bewerte("Bios PW").unbekannt, false);
check("Groß/Kleinschreibung egal", bewerte("AKKU DEFEKT").teiltypen, ["Akku"]);
check("Mehrfach-Leerzeichen egal", bewerte("Akku   defekt").teiltypen, ["Akku"]);

// Unbekanntes wird NICHT still verschluckt — ReForm kann die Auswahlliste
// erweitern, und ein neuer Begriff darf kein Teil fälschlich freisprechen.
check("neuer Begriff gilt als unbekannt", bewerte("Fingerabdruckleser defekt").unbekannt, true);
check("neuer Begriff ordnet nichts zu", bewerte("Fingerabdruckleser defekt").teiltypen, []);

// ── Totalschaden ────────────────────────────────────────────────────────────
console.log("\n── Totalschaden ──");

check("Totalschaden erkannt", istTotalschaden(["Keine Funktion / Totalschaden"]), true);
check("ausgeschlachtet erkannt", istTotalschaden(["Gerät ist ausgeschlachtet / Totalschaden"]), true);
check("fehlende Komponenten zählen mit", istTotalschaden(["Fehlende Komponenten"]), true);
check("normaler Defekt ist keiner", istTotalschaden(["Akku defekt"]), false);
check("leer ist keiner", istTotalschaden([]), false);

// ── Zustand je Teiltyp — das Herzstück ──────────────────────────────────────
console.log("\n── Zustand eines Teils im Spendergerät ──");

const d1 = zerlegeDefekte("Akku defekt, Gehäuse beschädigt (Kratzer/Dellen), Bios PW");
check("Akku ist hin", zustandFuerTeiltyp(d1, "Akku"), "DEFEKT");
check("Tastatur unauffällig", zustandFuerTeiltyp(d1, "Tastatur"), "FREI");
check("D Cover nur kosmetisch", zustandFuerTeiltyp(d1, "D Cover"), "KOSMETISCH");
check("Bios PW stört das Mainboard nicht", zustandFuerTeiltyp(d1, "Mainboard"), "FREI");

// Häufigster Fall des Exports: 2.600× Gebrauchsspuren.
check(
  "Gebrauchsspuren = kosmetisch, kein Ausschluss",
  zustandFuerTeiltyp(
    zerlegeDefekte("Überdurchschnittliche Gebrauchsspuren/nicht entfernbar"),
    "D Cover",
  ),
  "KOSMETISCH",
);

// Hart schlägt kosmetisch, unabhängig von der Reihenfolge im Text.
check(
  "Riss schlägt Kratzer",
  zustandFuerTeiltyp(
    zerlegeDefekte("Gehäuse beschädigt (Kratzer/Dellen), Gehäuse beschädigt (Risse/Brüche)"),
    "D Cover",
  ),
  "DEFEKT",
);
check(
  "Kratzer nach Riss ändert nichts",
  zustandFuerTeiltyp(
    zerlegeDefekte("Gehäuse beschädigt (Risse/Brüche), Gehäuse beschädigt (Kratzer/Dellen)"),
    "D Cover",
  ),
  "DEFEKT",
);

// Totalschaden schlägt alles — auch ein sonst unauffälliges Teil.
check(
  "Totalschaden übersteuert",
  zustandFuerTeiltyp(zerlegeDefekte("Keine Funktion / Totalschaden"), "Tastatur"),
  "TOTAL",
);

// Display und Displaymodul hängen zusammen, sind aber nicht dasselbe.
const dDisp = zerlegeDefekte("Volldefekt des Displays/Display fehlt");
check("Display defekt", zustandFuerTeiltyp(dDisp, "Display"), "DEFEKT");
check("Displaymodul ebenfalls", zustandFuerTeiltyp(dDisp, "Displaymodul"), "DEFEKT");
const dSch = zerlegeDefekte("Scharnier defekt");
check("Scharnier trifft nur das Modul", zustandFuerTeiltyp(dSch, "Displaymodul"), "DEFEKT");
check("das nackte Panel bleibt frei", zustandFuerTeiltyp(dSch, "Display"), "FREI");

// Ein Begriff, zwei Teiltypen.
const dLuft = zerlegeDefekte("CPU Kühler/Lüfter fehlt/defekt");
check("Thermalmodul betroffen", zustandFuerTeiltyp(dLuft, "Thermalmodul"), "DEFEKT");
check("CPU Lüfter betroffen", zustandFuerTeiltyp(dLuft, "CPU Lüfter"), "DEFEKT");
check("Tastatur nicht betroffen", zustandFuerTeiltyp(dLuft, "Tastatur"), "FREI");

// Schnittstelle deckt beide Anschluss-Platinen ab.
const dSchnitt = zerlegeDefekte("Schnittstelle defekt");
check("USB Board betroffen", zustandFuerTeiltyp(dSchnitt, "USB Board"), "DEFEKT");
check("LAN Board betroffen", zustandFuerTeiltyp(dSchnitt, "LAN Board"), "DEFEKT");

// Datenträger/RAM sind Kategorien, keine Teiltypen — sie dürfen nichts sperren.
check(
  "fehlender Datenträger sperrt kein Teil",
  zustandFuerTeiltyp(zerlegeDefekte("kein Datenträger vorhanden"), "Mainboard"),
  "FREI",
);

// Ein unbekannter Begriff darf kein Teil sperren, aber auch keins freisprechen —
// er landet sichtbar in der Trefferliste, damit ein Mensch entscheidet.
check(
  "unbekannter Begriff lässt Teil frei",
  zustandFuerTeiltyp(zerlegeDefekte("Irgendwas ganz Neues"), "Tastatur"),
  "FREI",
);

// ── harte Defekte sammeln (für den Import) ──────────────────────────────────
console.log("\n── harte Defekte je Gerät ──");

check(
  "zwei harte Defekte, sortiert",
  harteDefektTeiltypen(zerlegeDefekte("Tastatur defekt, Akku fehlt, Bios PW")),
  ["Akku", "Tastatur"],
);
check(
  "kosmetisch zählt nicht",
  harteDefektTeiltypen(zerlegeDefekte("Gehäuse beschädigt (Kratzer/Dellen)")),
  [],
);
check("keine Dubletten", harteDefektTeiltypen(zerlegeDefekte("Akku defekt, Akku fehlt")), ["Akku"]);

// ── Die Tabelle selbst ──────────────────────────────────────────────────────
console.log("\n── Tabelle prüfen ──");

// ⚠️ Der wichtigste Test der Datei. Ein erfundener Teiltyp-Name (etwa „Webcam"
// oder „D-Cover" mit Bindestrich) wirft keinen Fehler — er findet nur nie etwas.
const ECHTE_TEILTYPEN = new Set<string>([
  ...STANDARD_TEILNAMEN,
  // Eigene Teiltypen, gemessen in der Produktion am 09.09.2026:
  "Thermalmodul",
  "Eingabestift",
]);
const erfunden = [
  ...new Set(DEFEKT_REGELN.flatMap((r) => r.teiltypen).filter((t) => !ECHTE_TEILTYPEN.has(t))),
];
check("alle Teiltyp-Namen existieren wirklich", erfunden, []);

// Doppelte Begriffe würden sich gegenseitig überschreiben, ohne dass es auffällt.
const doppelt = DEFEKT_REGELN.map((r) => r.begriff.toLowerCase()).filter(
  (b, i, a) => a.indexOf(b) !== i,
);
check("keine doppelten Begriffe", doppelt, []);

// Wer Teiltypen zuordnet, muss eine Schwere angeben, die auch etwas bewirkt.
const stumm = DEFEKT_REGELN.filter(
  (r) => r.teiltypen.length > 0 && (r.schwere === "KEIN_TEIL" || r.schwere === "TOTAL"),
).map((r) => r.begriff);
check("keine wirkungslose Zuordnung", stumm, []);

check("Tabelle hat alle 53 Begriffe", DEFEKT_REGELN.length, 53);

// ── Ergebnis ────────────────────────────────────────────────────────────────
console.log(`\n${failed === 0 ? "✅" : "❌"}  ${passed} bestanden, ${failed} fehlgeschlagen\n`);
process.exit(failed === 0 ? 0 : 1);
