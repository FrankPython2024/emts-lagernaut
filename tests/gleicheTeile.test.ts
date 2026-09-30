/**
 * Tests für das Bündeln gleicher Anfragen (src/lib/anfragen/gleicheTeile.ts).
 *
 * Ausführen:  npx tsx tests/gleicheTeile.test.ts   (oder: npm run test:gleicheteile)
 *
 * Anlass: sechs Akku-Anfragen für das Dell Latitude 7490 am 29.09.2026,
 * über fünf Stunden und drei Techniker verteilt.
 *
 * Reine Logik, kein Netz, keine Datenbank.
 */

import { buendele, sichtbareBuendel, teilSchluessel, type BuendelAnfrage } from "../src/lib/anfragen/gleicheTeile";
import { sortiereNachHaeufigkeit, teilNorm } from "../src/lib/anfragen/haeufigkeit";

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

function a(id: number, teil: string, schluessel: string, uhr: string, extra: Partial<BuendelAnfrage> = {}): BuendelAnfrage {
  return {
    id, teil, schluessel,
    status: "BEDARF", istSonderAnfrage: false, testModus: false,
    datum: new Date(`2026-09-29T${uhr}:00Z`),
    ...extra,
  };
}

// Der echte Stand vom 29.09.2026 (Auszug).
const E7490 = "delllatitude7490";
const E5500 = "delllatitude5500";
const E14   = "lenovothinkpade14gen4";
const X360  = "hpelitebookx360830g6";
const echt: BuendelAnfrage[] = [
  a(27775, "Displaymodul", X360, "12:00"),
  a(27774, "Akku", E5500, "11:55"),
  a(27766, "Füße hinten", X360, "10:03", { status: "IN_BEARBEITUNG" }),
  a(27765, "Tastatur", E7490, "10:01"),
  a(27764, "Akku", E7490, "10:01"),
  a(27763, "Akku", E7490, "09:56"),
  a(27762, "Touchpad", E7490, "09:53"),
  a(27761, "Akku", E5500, "08:58"),
  a(27760, "Akku", E7490, "08:54"),
  a(27754, "Akku", E7490, "07:59"),
  a(27753, "Akku", E7490, "07:45"),
  a(27751, "Akku", X360, "06:27"),
  a(27750, "Akku", E14, "06:22"),
  a(27749, "Akku", E14, "06:10"),
  a(27745, "Akku", E5500, "05:30"),
  a(27744, "Akku", E7490, "05:29"),
  a(27739, "Füße hinten", X360, "04:43", { status: "IN_BEARBEITUNG" }),
];

console.log("\n── Der echte Fall ──");
{
  const b = buendele(echt);
  check("vier Bündel", b.length, 4);
  check("7490-Akku zuerst, sechs Anfragen", [b[0]?.key, b[0]?.anfrageIds.length], [`${E7490}|akku`, 6]);
  check("älteste Anfrage zuerst", b[0]?.anfrageIds, [27744, 27753, 27754, 27760, 27763, 27764]);
  check("dann 5500-Akku (3)", [b[1]?.schluessel, b[1]?.anfrageIds.length], [E5500, 3]);
  check("Gleichstand 2:2 — wer länger wartet, zuerst (Füße 04:43 vor E14 06:10)",
    b.slice(2).map((x) => x.schluessel), [X360, E14]);
  check("Tastatur/Touchpad (je einmal) sind kein Bündel",
    b.some((x) => x.teil === "Tastatur" || x.teil === "Touchpad"), false);
  check("IN_BEARBEITUNG zählt als offen", b.find((x) => x.teil === "Füße hinten")?.anfrageIds, [27739, 27766]);
}

console.log("\n── Was nicht gebündelt wird ──");
{
  check("erledigte und stornierte fallen raus", buendele([
    a(1, "Akku", E7490, "05:00"),
    a(2, "Akku", E7490, "06:00", { status: "ABGESCHLOSSEN" }),
    a(3, "Akku", E7490, "07:00", { status: "STORNIERT" }),
    a(4, "Akku", E7490, "08:00", { status: "NICHT_VERFUEGBAR" }),
  ]), []);
  check("Sonderanfragen fallen raus (Freitext, nicht vergleichbar)", buendele([
    a(1, "Scharnier", E7490, "05:00", { istSonderAnfrage: true }),
    a(2, "Scharnier", E7490, "06:00", { istSonderAnfrage: true }),
  ]), []);
  check("Test-Anfragen fallen raus", buendele([
    a(1, "Akku", E7490, "05:00"),
    a(2, "Akku", E7490, "06:00", { testModus: true }),
  ]), []);
  check("unbekanntes Modell wird nie gebündelt", buendele([
    a(1, "Akku", "", "05:00"),
    a(2, "Akku", "", "06:00"),
  ]), []);
  check("anderes Modell, gleicher Teiltyp = zwei Einzelne", buendele([
    a(1, "Akku", E7490, "05:00"),
    a(2, "Akku", E5500, "06:00"),
  ]), []);
  check("gleiches Modell, anderer Teiltyp = zwei Einzelne", buendele([
    a(1, "Füße vorne", X360, "05:00"),
    a(2, "Füße hinten", X360, "06:00"),
  ]), []);
}

console.log("\n── Schreibweisen ──");
{
  check("teilSchluessel ignoriert Groß/klein und Leerzeichen", teilSchluessel("  Füße   Hinten "), "füße hinten");
  const b = buendele([
    a(1, "Füße hinten", X360, "05:00"),
    a(2, "füße  hinten", X360, "06:00"),
  ]);
  check("„Füße hinten“ und „füße  hinten“ = ein Bündel", b[0]?.anfrageIds, [1, 2]);
  check("Anzeige in der Schreibweise der ältesten", b[0]?.teil, "Füße hinten");
}

console.log("\n── Stabilität ──");
{
  const vor = buendele(echt).map((b) => b.key);
  const nach = buendele([...echt].reverse()).map((b) => b.key);
  check("Reihenfolge unabhängig von der Eingangsreihenfolge", nach, vor);
  check("gleiche Uhrzeit → nach Id", buendele([
    a(9, "Akku", E7490, "05:00"),
    a(3, "Akku", E7490, "05:00"),
  ])[0]?.anfrageIds, [3, 9]);
  check("Datum als Text funktioniert (superjson/JSON)", buendele([
    { ...a(1, "Akku", E7490, "05:00"), datum: "2026-09-29T06:00:00.000Z" },
    { ...a(2, "Akku", E7490, "05:00"), datum: "2026-09-29T05:00:00.000Z" },
  ])[0]?.anfrageIds, [2, 1]);
}

console.log("\n── Auf die sichtbare Liste zuschneiden ──");
{
  const b = buendele(echt);
  const nurAB2 = new Set([27765, 27764, 27763, 27762, 27754, 27751, 27766, 27739, 27775]);
  const s = sichtbareBuendel(b, nurAB2);
  check("Filter AB2: 7490-Akku mit drei Anfragen", s.find((x) => x.schluessel === E7490)?.anfrageIds, [27754, 27763, 27764]);
  check("Filter AB2: Füße hinten bleibt (beide AB2)", s.some((x) => x.teil === "Füße hinten"), true);
  check("Filter AB2: E14 (MG) verschwindet", s.some((x) => x.schluessel === E14), false);
  check("nur noch eine sichtbar → kein Bündel", sichtbareBuendel(b, new Set([27744])), []);
  check("nichts sichtbar → nichts", sichtbareBuendel(b, new Set()), []);
  check("Original bleibt unverändert", b[0]?.anfrageIds.length, 6);
}

console.log("\n── Techniker-Portal: häufigste Teile zuerst (30.09.2026) ──");
{
  // Gewohnte Reihenfolge (Teiltyp.sortierung) — gekürzt.
  const standard = ["Mainboard", "Display", "Displaymodul", "Touchpad", "Touchpad Buttons", "Tastatur", "Füße vorne", "Akku", "D-Cover"].map((teiltyp) => ({ teiltyp }));
  // Echte Zahlen Dell Latitude 7490, 30.09.2026
  const l7490 = [{ teil: "Akku", anzahl: 20 }, { teil: "Displaymodul", anzahl: 2 }, { teil: "Touchpad Buttons", anzahl: 1 }, { teil: "Touchpad", anzahl: 1 }, { teil: "Tastatur", anzahl: 1 }, { teil: "Füße vorne", anzahl: 1 }];
  const s7490 = sortiereNachHaeufigkeit(standard, l7490);
  check("7490: Akku zuerst, dann absteigend, Gleichstand in gewohnter Reihenfolge", s7490.map((t) => t.teiltyp),
    ["Akku", "Displaymodul", "Touchpad", "Touchpad Buttons", "Tastatur", "Füße vorne", "Mainboard", "Display", "D-Cover"]);
  check("7490: nur der Akku ist „oft angefragt“ (ab 3)", s7490.filter((t) => t.oft).map((t) => [t.teiltyp, t.anfragen]), [["Akku", 20]]);
  check("ohne Anfragen: alles wie immer, nichts markiert", sortiereNachHaeufigkeit(standard, []).map((t) => t.teiltyp), standard.map((t) => t.teiltyp));
  check("Abfrage fehlgeschlagen (undefined) → wie immer", sortiereNachHaeufigkeit(standard, undefined).map((t) => t.teiltyp)[0], "Mainboard");
  const viele = sortiereNachHaeufigkeit(standard, [
    { teil: "D Cover", anzahl: 18 }, { teil: "Tastatur", anzahl: 17 }, { teil: "Akku", anzahl: 14 }, { teil: "Displaymodul", anzahl: 14 },
  ]);
  check("5520: „D Cover“ trifft die Kachel „D-Cover“", viele[0]?.teiltyp, "D-Cover");
  check("höchstens 3 markiert", viele.filter((t) => t.oft).map((t) => t.teiltyp), ["D-Cover", "Tastatur", "Displaymodul"]);
  check("Teilnamen vergleichbar", [teilNorm("D-Cover"), teilNorm(" d  cover "), teilNorm("Füße_vorne")], ["d cover", "d cover", "füße vorne"]);
  check("zusätzliche Felder bleiben erhalten", sortiereNachHaeufigkeit([{ teiltyp: "Akku", bestand: 4 }], [{ teil: "Akku", anzahl: 5 }])[0], { teiltyp: "Akku", bestand: 4, anfragen: 5, oft: true });
}

console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen\n`);
if (failed > 0) process.exit(1);
