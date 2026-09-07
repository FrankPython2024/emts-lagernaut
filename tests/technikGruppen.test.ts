/**
 * Tests für die Aufteilung der Technik-Rückläufer (src/lib/pickup/technikGruppen.ts).
 *
 * Ausführen:  npx tsx tests/technikGruppen.test.ts   (oder: npm run test:technik)
 *
 * Die Verteilung unten ist ECHT: der ReForm-Export vom 07.09.2026, 62 Geräte.
 * Sie ist als Prüfstein hier drin, weil an genau dieser Aufteilung die erste
 * Beschreibung gescheitert wäre — drei unabhängige Filter hätten 107 Positionen
 * für 62 Geräte ergeben, jedes Gerät im Schnitt auf 1,7 Abhollisten.
 *
 * Reine Logik, kein Netz, keine Datenbank, keine Datei.
 */

import {
  leseGeneration,
  istZustandH,
  teileAuf,
  zaehleZustaende,
  GENERATIONS_GRENZE,
  type TechnikZeile,
} from "../src/lib/pickup/technikGruppen";

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

function zeile(logId: string, zustand: string | null, generation: string | null): TechnikZeile {
  return { logId, colli: null, stellplatz: null, bezeichnung: null, zustand, generation };
}

// ── Generation lesen ────────────────────────────────────────────────────────
console.log("\n── Generation lesen ──");
check("ganze Zahl", leseGeneration("11"), 11);
check("mit Leerzeichen", leseGeneration("  8 "), 8);
check("deutsches Komma", leseGeneration("10,0"), 10);
check("leer → null", leseGeneration(""), null);
check("null → null", leseGeneration(null), null);
check("Text → null (kein Rückfall auf 0)", leseGeneration("unbekannt"), null);
check("Nur-Leerzeichen → null", leseGeneration("   "), null);

// ── Zustand H ───────────────────────────────────────────────────────────────
console.log("\n── Zustand H ──");
check("H trifft", istZustandH("H"), true);
check("klein geschrieben trifft", istZustandH("h"), true);
check("mit Leerzeichen trifft", istZustandH(" H "), true);
check("R-B trifft nicht", istZustandH("R-B"), false);
check("R-A trifft nicht", istZustandH("R-A"), false);
check("leer trifft nicht", istZustandH(""), false);
check("null trifft nicht", istZustandH(null), false);

// ── Vorrang: H schlägt die Generation ───────────────────────────────────────
console.log("\n── Vorrang von H ──");
{
  const a = teileAuf([
    zeile("111", "H", "8"),    // H mit alter Generation
    zeile("222", "H", "11"),   // H mit neuer Generation
  ]);
  check("H mit Gen 8 landet im H-Auftrag", a.gruppen[0]!.zeilen.map((z) => z.logId), ["111", "222"]);
  check("und NICHT im Alt-Auftrag", a.gruppen[1]!.zeilen.length, 0);
  check("und NICHT im Neu-Auftrag", a.gruppen[2]!.zeilen.length, 0);
}

// ── Grenze: 9 gehört zu „alt", 10 zu „neu" ──────────────────────────────────
console.log("\n── Grenze bei 9 ──");
{
  const a = teileAuf([
    zeile("g8",  "R-B", "8"),
    zeile("g9",  "R-B", "9"),
    zeile("g10", "R-B", "10"),
    zeile("g11", "R-B", "11"),
  ]);
  check("Grenzwert ist 9", GENERATIONS_GRENZE, 9);
  check("8 und 9 sind alt", a.gruppen[1]!.zeilen.map((z) => z.logId), ["g8", "g9"]);
  check("10 und 11 sind neu", a.gruppen[2]!.zeilen.map((z) => z.logId), ["g10", "g11"]);
}

// ── Fehlende Generation wird sichtbar, nicht einsortiert ────────────────────
console.log("\n── Fehlende Generation ──");
{
  const a = teileAuf([
    zeile("ohne", "R-B", ""),
    zeile("null", "R-A", null),
    zeile("wirr", "R-B", "k.A."),
  ]);
  check("landet in ohneZuordnung", a.ohneZuordnung.map((z) => z.logId), ["ohne", "null", "wirr"]);
  check("nicht heimlich bei alt", a.gruppen[1]!.zeilen.length, 0);
  check("nicht heimlich bei neu", a.gruppen[2]!.zeilen.length, 0);
}
{
  // H ohne Generation bleibt trotzdem ein H-Gerät.
  const a = teileAuf([zeile("hOhneGen", "H", null)]);
  check("H ohne Generation bleibt im H-Auftrag", a.gruppen[0]!.zeilen.map((z) => z.logId), ["hOhneGen"]);
  check("und nicht in ohneZuordnung", a.ohneZuordnung.length, 0);
}

// ── Überschneidungsfreiheit ─────────────────────────────────────────────────
console.log("\n── Kein Gerät auf zwei Listen ──");
{
  const eingabe = [
    zeile("a", "H",   "8"),
    zeile("b", "R-B", "8"),
    zeile("c", "R-B", "11"),
    zeile("d", "R-A", "10"),
    zeile("e", "R-B", ""),
  ];
  const a = teileAuf(eingabe);
  const alle = a.gruppen.flatMap((g) => g.zeilen.map((z) => z.logId)).concat(a.ohneZuordnung.map((z) => z.logId));
  check("jede Zeile genau einmal", alle.length, new Set(alle).size);
  check("nichts geht verloren", alle.length, eingabe.length);
}

// ── Der echte Export vom 07.09.2026 ─────────────────────────────────────────
// 62 Geräte. Verteilung Zustand × Generation, wie in der Datei gemessen:
//        Gen8  Gen9  Gen10  Gen11
//   H       1     2      6      4   = 13
//   R-A     0     0      3      1   =  4
//   R-B    12     6      7     20   = 45
console.log("\n── Echter Export 07.09.2026 (62 Geräte) ──");
{
  const echt: TechnikZeile[] = [];
  let n = 0;
  const bau = (zustand: string, gen: string, anzahl: number) => {
    for (let i = 0; i < anzahl; i++) echt.push(zeile(`log${n++}`, zustand, gen));
  };
  bau("H", "8", 1);   bau("H", "9", 2);   bau("H", "10", 6);   bau("H", "11", 4);
  bau("R-A", "8", 0); bau("R-A", "9", 0); bau("R-A", "10", 3); bau("R-A", "11", 1);
  bau("R-B", "8", 12); bau("R-B", "9", 6); bau("R-B", "10", 7); bau("R-B", "11", 20);

  check("Eingabemenge", echt.length, 62);

  const a = teileAuf(echt);
  check("Auftrag 1 · Zustand H", a.gruppen[0]!.zeilen.length, 13);
  check("Auftrag 2 · Generation bis 9", a.gruppen[1]!.zeilen.length, 18);
  check("Auftrag 3 · Generation ab 10", a.gruppen[2]!.zeilen.length, 31);
  check("nichts unzugeordnet", a.ohneZuordnung.length, 0);
  check(
    "Summe deckt den Export ab",
    a.gruppen.reduce((s, g) => s + g.zeilen.length, 0) + a.ohneZuordnung.length,
    62,
  );

  // Der Fehler, den die erste Beschreibung erzeugt hätte: drei unabhängige
  // Filter über die ganze Datei.
  const rb   = echt.filter((z) => z.zustand === "R-B").length;
  const alt  = echt.filter((z) => Number(z.generation) <= 9).length;
  const neu  = echt.filter((z) => Number(z.generation) > 9).length;
  check("Gegenprobe: unabhängige Filter ergäben 107 Positionen", rb + alt + neu, 107);

  check("Zustandszählung", zaehleZustaende(echt), [
    { wert: "R-B", anzahl: 45 },
    { wert: "H",   anzahl: 13 },
    { wert: "R-A", anzahl: 4  },
  ]);
}

// ── Ergebnis ────────────────────────────────────────────────────────────────
console.log("\n══════════════════════════════════════════");
console.log(`  📊 ${passed} passed  |  ${failed} failed`);
console.log("══════════════════════════════════════════\n");
if (failed > 0) process.exit(1);
